// Контроллер приложения: связывает хранилище, подключение и окно. От Electron не зависит —
// всё, что нужно от системы, приходит через интерфейс Host (в тестах там заглушка).
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseInput } from '../core'
import type { VpnApi, ToastMessage } from '../shared/api'
import { DEFAULT_SETTINGS } from '../shared/defaults'
import type { AddResult, AppState, ConnState, ExitInfo, RunningApp, Settings, StatsSample, SystemInfo } from '../shared/types'
import { ConnectionManager, initialConnState, type ConnectionEvent } from './engine/connection'
import { NoopSystemProxy, WindowsSystemProxy, type SystemProxy } from './platform/systemProxy'
import { KillSwitch } from './platform/killswitch'
import { fetchExitInfo } from './services/ipcheck'
import { killStaleEngine } from './engine/stale'
import { AppLog } from './services/logger'
import { RuleSets } from './services/rules'
import { httpGetWithFallback } from './services/http'
import { DataStore, SecureStorageError, newId, type Sealer } from './store'
import { cleanApps, findShortcuts, listRunning, startMenuDirs, toRunningApp, type RawApp } from './apps'
import { basename } from 'node:path'

export interface Host {
  platform: NodeJS.Platform
  appVersion: string
  readClipboard(): Promise<string>
  notify(title: string, body: string): void
  windowAction(action: 'minimize' | 'close' | 'hide-to-tray'): void
  quit(): void
  isAdmin(): Promise<boolean>
  /** Путь к исполняемому файлу программы (для запуска с правами администратора). */
  exePath: string
  /** Права администратора: задача планировщика «запускать с наивысшими правами». */
  elevation: {
    taskExists(): Promise<boolean>
    createTask(exePath: string, args: string): Promise<{ ok: boolean; cancelled: boolean }>
    deleteTask(): Promise<boolean>
    runTask(): Promise<boolean>
  }
  /** Освободить «замок единственной копии», чтобы новая копия (с правами) могла стать главной. */
  releaseControl(): void
  /** Иконка программы как картинка (data URL). */
  fileIcon(path: string): Promise<string | null>
  /** Цель ярлыка .lnk (куда он ведёт) или null. */
  readShortcut(path: string): string | null
}

export interface ControllerPaths {
  /** Данные пользователя: настройки, списки, журнал. */
  userDir: string
  engineExe: string
  bundledRulesDir: string
}

type Listener<T> = (v: T) => void

export class AppController implements Omit<VpnApi, 'onState' | 'onStats' | 'onToast' | 'onNavigate'> {
  readonly store: DataStore
  readonly log: AppLog
  readonly conn: ConnectionManager
  readonly rules: RuleSets
  private systemProxy!: SystemProxy
  private killSwitch!: KillSwitch
  private exit: ExitInfo = { checking: false, countryCode: null, countryName: null, ip: null, error: null }
  private engineVersion: string | null = null
  private admin = false
  private elevationReady = false
  private iconCache = new Map<string, string | null>()
  private rulesTimer: NodeJS.Timeout | null = null
  private pushTimer: NodeJS.Timeout | null = null
  private restarting = false
  private restartTimer: NodeJS.Timeout | null = null
  private quiet = false

  private stateListeners: Array<Listener<AppState>> = []
  private statsListeners: Array<Listener<StatsSample>> = []
  private toastListeners: Array<Listener<ToastMessage>> = []
  private navListeners: Array<Listener<string>> = []

  constructor(readonly host: Host, readonly paths: ControllerPaths, sealer: Sealer, overrides: { systemProxy?: SystemProxy; fetchExit?: typeof fetchExitInfo; ruleFetch?: (url: string) => Promise<Buffer> } = {}) {
    this.log = new AppLog(join(paths.userDir, 'logs', 'app.log'))
    this.store = new DataStore(join(paths.userDir, 'data.json'), sealer)
    this.rules = new RuleSets({
      userDir: join(paths.userDir, 'rules'),
      bundledDir: paths.bundledRulesDir,
      fetch: overrides.ruleFetch ?? (async (url) => (await httpGetWithFallback(url, { timeoutMs: 20000, maxBytes: 4 * 1024 * 1024 }, this.conn?.isRunning ? this.conn.proxyPort : null)).body),
      getUpdatedAt: () => this.store.rulesUpdatedAt,
      setUpdatedAt: (t) => (this.store.rulesUpdatedAt = t),
      log: (l) => this.log.add(l)
    })
    this.rules.seed()

    const systemProxy: SystemProxy =
      overrides.systemProxy ??
      (host.platform === 'win32'
        ? new WindowsSystemProxy({ load: () => this.store.runtimeGet('prevProxy'), save: (p) => this.store.runtimeSet('prevProxy', p) })
        : new NoopSystemProxy())
    this.systemProxy = systemProxy
    const killSwitch = new KillSwitch({
      load: () => this.store.runtimeGet('killSwitch') ?? { active: false, previous: null },
      save: (s) => this.store.runtimeSet('killSwitch', s.active ? s : null)
    }, undefined, host.platform)

    this.killSwitch = killSwitch
    const fetchExit = overrides.fetchExit ?? fetchExitInfo
    this.conn = new ConnectionManager({
      engineExe: paths.engineExe,
      workDir: join(paths.userDir, 'runtime'),
      getSettings: () => this.store.settings,
      getServerName: (id) => this.store.server(id)?.name ?? null,
      getSecret: (id) => this.store.getSecret(id),
      ruleSets: () => this.rules.files(),
      systemProxy,
      killSwitch,
      isAdmin: () => host.isAdmin(),
      platform: host.platform,
      fetchExit: async (port) => {
        const r = await fetchExit(port)
        return { countryCode: r.countryCode, countryName: r.countryName, ip: r.ip, error: r.error }
      },
      log: (l) => this.log.add(l),
      recordEngine: (pid) => this.store.runtimeSet('enginePid', pid),
      onEvent: (e) => this.onConnectionEvent(e)
    })
    this.conn.onState = (s) => this.onConnState(s)
    this.conn.onStats = (s) => this.statsListeners.forEach((l) => l(s))
    this.conn.onExit = (e) => {
      this.exit = { ...this.exit, ...e }
      this.pushState()
    }
    this.conn.onEngineLine = (l) => this.log.add(l, 'engine')
    if (this.store.loadNote) this.log.add(this.store.loadNote)
  }

  /** Вызывается один раз при запуске приложения. */
  async init(): Promise<void> {
    await this.recoverFromCrash()
    this.admin = await this.host.isAdmin()
    this.elevationReady = await this.host.elevation.taskExists()
    void this.readEngineVersion()
    this.pushState()
    // списки правил обновляются сами: при запуске (если устарели) и затем раз в несколько часов
    const maybeUpdate = (): void => { if (this.rules.needsUpdate()) void this.updateRules(true) }
    setTimeout(maybeUpdate, 25_000)
    this.rulesTimer = setInterval(maybeUpdate, 6 * 3600_000)
  }

  // ---------------------------------------------------------------- после аварийного завершения

  /**
   * Если прошлый запуск закончился аварийно, после него могут остаться: забытый процесс движка и включённый
   * «в никуда» системный прокси (тогда у человека пропал бы интернет). Здесь всё это аккуратно убирается.
   */
  async recoverFromCrash(): Promise<void> {
    const pid = this.store.runtimeGet<number>('enginePid')
    if (pid) {
      if (await killStaleEngine(pid, this.host.platform, this.paths.engineExe)) this.log.add(`Остановил забытый движок от прошлого запуска (pid ${pid})`)
      this.store.runtimeSet('enginePid', null)
    }
    if (this.store.runtimeGet('prevProxy') !== null) {
      this.log.add('Прошлый запуск закончился аварийно: возвращаю настройки системного прокси')
      try { await this.systemProxy.clear() } catch { /* ничего */ }
    }
    if (this.store.runtimeGet<{ active: boolean }>('killSwitch')?.active) {
      this.log.add('Прошлый запуск закончился аварийно: возвращаю обычные правила сети')
      try { await this.killSwitch.disarm() } catch { /* ничего */ }
    }
  }

  // ---------------------------------------------------------------- подписки на события

  onState(cb: Listener<AppState>): () => void { this.stateListeners.push(cb); return () => this.off(this.stateListeners, cb) }
  onStats(cb: Listener<StatsSample>): () => void { this.statsListeners.push(cb); return () => this.off(this.statsListeners, cb) }
  onToast(cb: Listener<ToastMessage>): () => void { this.toastListeners.push(cb); return () => this.off(this.toastListeners, cb) }
  onNavigate(cb: Listener<string>): () => void { this.navListeners.push(cb); return () => this.off(this.navListeners, cb) }
  private off<T>(arr: Array<Listener<T>>, cb: Listener<T>): void {
    const i = arr.indexOf(cb)
    if (i !== -1) arr.splice(i, 1)
  }

  toast(kind: ToastMessage['kind'], text: string): void {
    const t: ToastMessage = { id: newId(), kind, text }
    this.toastListeners.forEach((l) => l(t))
  }

  navigate(page: string): void {
    this.navListeners.forEach((l) => l(page))
  }

  // ---------------------------------------------------------------- состояние

  private async readEngineVersion(): Promise<void> {
    if (!existsSync(this.paths.engineExe)) return
    await new Promise<void>((resolve) => {
      try {
        const p = spawn(this.paths.engineExe, ['version'], { windowsHide: true })
        let out = ''
        p.stdout.on('data', (d) => (out += d))
        p.on('error', () => resolve())
        p.on('exit', () => {
          const m = /sing-box version (\S+)/.exec(out)
          this.engineVersion = m ? m[1]! : null
          this.pushState()
          resolve()
        })
      } catch { resolve() }
    })
  }

  system(): SystemInfo {
    return {
      platform: this.host.platform as SystemInfo['platform'],
      appVersion: this.host.appVersion,
      isAdmin: this.admin,
      elevationReady: this.elevationReady,
      singbox: { found: existsSync(this.paths.engineExe), version: this.engineVersion, path: this.paths.engineExe },
      secureStorage: this.store.secureAvailable,
      rules: this.rules.status(),
      startedHidden: false,
      killSwitchActive: false
    }
  }

  getStateSync(): AppState {
    return {
      conn: this.conn.state,
      exit: this.exit,
      servers: this.store.views(),
      subscriptions: [],
      settings: this.store.settings,
      system: this.system()
    }
  }

  async getState(): Promise<AppState> {
    return this.getStateSync()
  }

  /** Отправка состояния окну — не чаще раза в 40 мс, чтобы не засыпать его частыми мелкими обновлениями. */
  pushState(): void {
    if (this.pushTimer) return
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      const s = this.getStateSync()
      this.stateListeners.forEach((l) => l(s))
    }, 40)
  }

  private onConnState(s: ConnState): void {
    if (s.status === 'off' || s.status === 'error') this.exit = { checking: false, countryCode: null, countryName: null, ip: null, error: null }
    if (s.status === 'connecting') this.exit = { checking: false, countryCode: null, countryName: null, ip: null, error: null }
    this.pushState()
  }

  private onConnectionEvent(e: ConnectionEvent): void {
    this.log.add(`Событие: ${e.type}`)
    if (this.quiet || !this.store.settings.notifications) return
    switch (e.type) {
      case 'connected': this.host.notify('Подключено', `Работает через «${e.serverName}»`); break
      case 'disconnected': this.host.notify('Отключено', 'Вы снова в интернете напрямую'); break
      case 'lost': this.host.notify('Связь оборвалась', 'Пробую подключиться снова…'); break
      case 'reconnected': this.host.notify('Подключение восстановлено', `Снова через «${e.serverName}»`); break
      case 'failed': this.host.notify(e.error.title, e.error.text); break
      case 'degraded': this.host.notify('Сервер перестал отвечать', 'Интернет через VPN сейчас может не работать'); break
      case 'recovered': this.host.notify('Связь с сервером вернулась', 'Всё снова работает'); break
    }
  }

  // ---------------------------------------------------------------- ключи и серверы

  async pasteKey(): Promise<AddResult> {
    return this.addKeyText(await this.host.readClipboard())
  }

  async addKeyText(text: string): Promise<AddResult> {
    const outcome = parseInput(text)
    const fail = (message: string): AddResult => ({ ok: false, added: 0, kind: 'error', message, skipped: [], firstId: null })
    if (outcome.kind === 'error') return fail(outcome.error.message)
    if (outcome.kind === 'subscription-url') {
      return fail('Это ссылка на подписку. Подписки появятся в одном из следующих обновлений.')
    }
    try {
      const { added, duplicates } = this.store.addServers(outcome.servers)
      const skipped = outcome.failures.map((f) => `${f.hint}: ${f.error.message}`)
      if (added.length === 0) {
        return { ok: false, added: 0, kind: 'error', message: duplicates > 0 ? 'Такой ключ уже есть в списке.' : 'Не удалось добавить ключ.', skipped, firstId: null }
      }
      if (!this.store.settings.selectedServerId) this.store.updateSettings({ selectedServerId: added[0]!.id })
      const message = added.length === 1 ? `Ключ добавлен: ${added[0]!.name}` : `Добавлено серверов: ${added.length}`
      this.log.add(`Добавлено серверов: ${added.length}`)
      this.pushState()
      return { ok: true, added: added.length, kind: 'servers', message: skipped.length ? `${message}. Не удалось прочитать: ${skipped.length}` : message, skipped, firstId: added[0]!.id }
    } catch (e) {
      if (e instanceof SecureStorageError) {
        return fail('Не удалось защитить ключ средствами Windows, поэтому он не сохранён. Попробуйте перезапустить программу.')
      }
      throw e
    }
  }

  async selectServer(id: string): Promise<void> {
    if (!this.store.server(id)) return
    const changed = this.store.settings.selectedServerId !== id
    this.store.updateSettings({ selectedServerId: id })
    this.pushState()
    if (changed && (this.conn.state.status === 'on' || this.conn.state.status === 'connecting')) this.scheduleRestart('Сервер переключён')
  }

  async renameServer(id: string, name: string): Promise<void> {
    this.store.rename(id, name)
    this.pushState()
  }

  async removeServer(id: string): Promise<void> {
    const wasActive = this.conn.state.serverId === id && this.conn.state.status !== 'off'
    if (wasActive) await this.disconnect()
    this.store.removeServer(id)
    this.pushState()
  }

  async toggleFavorite(id: string): Promise<void> {
    this.store.toggleFavorite(id)
    this.pushState()
  }

  // ---------------------------------------------------------------- подключение

  async connect(serverId?: string): Promise<void> {
    const id = serverId ?? this.store.settings.selectedServerId
    if (id && id !== this.store.settings.selectedServerId) this.store.updateSettings({ selectedServerId: id })
    await this.conn.connect(id ?? null)
  }

  async disconnect(): Promise<void> {
    await this.conn.disconnect()
  }

  /** Перезапуск подключения с новыми настройками — без лишних уведомлений. */
  private scheduleRestart(reason: string): void {
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = setTimeout(() => void this.restartNow(reason), 700)
  }

  async restartNow(reason: string): Promise<void> {
    if (this.restarting) return
    const st = this.conn.state.status
    if (st !== 'on' && st !== 'connecting') return
    this.restarting = true
    this.quiet = true
    try {
      const id = this.conn.state.serverId ?? this.store.settings.selectedServerId
      this.log.add(`Перезапуск подключения: ${reason}`)
      await this.conn.disconnect()
      await this.conn.connect(id)
      if (this.conn.state.status === 'on') this.toast('success', 'Настройки применены')
    } finally {
      this.quiet = false
      this.restarting = false
    }
  }

  // ---------------------------------------------------------------- режим «весь компьютер»

  /** Нужно ли перезапуститься с правами администратора (вызывается при запуске программы). */
  get needsElevatedRelaunch(): boolean {
    return this.host.platform === 'win32' && this.store.settings.mode === 'tun' && !this.admin && this.elevationReady
  }

  async relaunchElevated(): Promise<boolean> {
    this.host.releaseControl()
    return this.host.elevation.runTask()
  }

  async requestTunMode(): Promise<{ ok: boolean; message: string; relaunching: boolean }> {
    const done = (ok: boolean, message: string, relaunching = false): { ok: boolean; message: string; relaunching: boolean } => ({ ok, message, relaunching })
    if (this.admin) {
      await this.updateSettings({ mode: 'tun' })
      return done(true, 'Режим «Весь компьютер» включён.')
    }
    if (this.host.platform !== 'win32') {
      return done(false, 'Режим «Весь компьютер» работает только в Windows (на других системах — только с правами администратора).')
    }
    if (!(await this.host.elevation.taskExists())) {
      this.log.add('Прошу у Windows разрешение запускаться с правами администратора')
      const r = await this.host.elevation.createTask(this.host.exePath, '--elevated')
      if (!r.ok) {
        this.log.add(r.cancelled ? 'Разрешение не получено (отказ в окне Windows)' : 'Не удалось создать разрешение')
        return done(false, r.cancelled
          ? 'Разрешение не получено, поэтому режим «Весь компьютер» не включён. Ничего страшного — можно работать в режиме «Браузер и программы». Попробовать снова можно в любой момент.'
          : 'Не удалось сохранить разрешение. Попробуйте ещё раз или запустите программу от имени администратора.')
      }
      this.elevationReady = true
    }
    // запоминаем выбор: новая копия, уже с правами, сама включится в нужном режиме
    this.store.updateSettings({ mode: 'tun' })
    this.store.flush()
    await this.conn.shutdown()
    if (!(await this.relaunchElevated())) {
      this.pushState()
      return done(false, 'Разрешение сохранено, но запустить программу с правами не получилось. Закройте программу и откройте её снова.')
    }
    setTimeout(() => this.host.quit(), 400)
    return done(true, 'Перезапускаю программу с правами администратора…', true)
  }

  async revokeElevation(): Promise<{ ok: boolean; message: string }> {
    if (this.host.platform !== 'win32') return { ok: false, message: 'Разрешение администратора есть только в Windows.' }
    const ok = await this.host.elevation.deleteTask()
    this.elevationReady = !ok ? await this.host.elevation.taskExists() : false
    if (ok && this.store.settings.mode === 'tun' && !this.admin) await this.updateSettings({ mode: 'proxy' })
    this.pushState()
    return ok
      ? { ok: true, message: 'Разрешение отозвано. Режим «Весь компьютер» снова будет просить его при включении.' }
      : { ok: false, message: 'Не удалось отозвать разрешение (возможно, вы отказались в окне Windows).' }
  }

  // ---------------------------------------------------------------- программы и списки

  private async iconFor(path: string | null): Promise<string | null> {
    if (!path) return null
    if (this.iconCache.has(path)) return this.iconCache.get(path)!
    let icon: string | null = null
    try { icon = await this.host.fileIcon(path) } catch { icon = null }
    this.iconCache.set(path, icon)
    return icon
  }

  private async withIcons(list: RawApp[]): Promise<RunningApp[]> {
    const capped = list.slice(0, 300)
    const icons = await Promise.all(capped.map((a) => this.iconFor(a.path)))
    return capped.map((a, i) => toRunningApp(a, icons[i] ?? null))
  }

  async listRunningApps(): Promise<RunningApp[]> {
    const raw = cleanApps(await listRunning(this.host.platform), { selfExe: this.host.exePath, platform: this.host.platform })
    return this.withIcons(raw)
  }

  async listInstalledApps(): Promise<RunningApp[]> {
    if (this.host.platform !== 'win32') return []
    const found: RawApp[] = []
    for (const dir of startMenuDirs()) {
      for (const lnk of findShortcuts(dir)) {
        const target = this.host.readShortcut(lnk)
        if (target && /\.exe$/i.test(target)) found.push({ name: basename(lnk).replace(/\.lnk$/i, ''), path: target })
      }
    }
    return this.withIcons(cleanApps(found, { selfExe: this.host.exePath, platform: this.host.platform }))
  }

  async updateRules(silent = false): Promise<{ ok: boolean; message: string }> {
    this.pushState()
    const r = await this.rules.update()
    this.pushState()
    if (r.updated === 0 && r.failed > 0) {
      const message = 'Не удалось обновить списки: нет связи с GitHub. Работают прежние списки. Попробуйте позже или при включённом VPN.'
      if (!silent) this.toast('warn', message)
      return { ok: false, message }
    }
    const message = r.failed ? `Списки обновлены частично (${r.updated} из ${r.updated + r.failed}). Применятся при следующем подключении.` : 'Списки обновлены. Применятся при следующем подключении.'
    if (!silent) this.toast('success', message)
    return { ok: true, message }
  }

  // ---------------------------------------------------------------- настройки

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    const before = this.store.settings
    const after = this.store.updateSettings(patch)
    const routingKeys: Array<keyof Settings> = ['mode', 'bypassRu', 'bypassGames', 'bypassApps', 'alwaysVpn', 'alwaysDirect', 'killSwitch', 'dnsLeakProtection']
    const needsRestart = routingKeys.some((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    this.pushState()
    if (needsRestart && (this.conn.state.status === 'on' || this.conn.state.status === 'connecting')) this.scheduleRestart('Изменены настройки')
  }

  async updateAdvanced(patch: Partial<Settings['advanced']>): Promise<void> {
    const before = JSON.stringify(this.store.settings.advanced)
    this.store.updateAdvanced(patch)
    this.pushState()
    if (before !== JSON.stringify(this.store.settings.advanced) && (this.conn.state.status === 'on' || this.conn.state.status === 'connecting')) {
      this.scheduleRestart('Изменены расширенные настройки')
    }
  }

  // ---------------------------------------------------------------- окно

  async windowAction(action: 'minimize' | 'close' | 'hide-to-tray'): Promise<void> {
    this.host.windowAction(action)
  }

  async quit(): Promise<void> {
    await this.shutdown()
    this.host.quit()
  }

  async shutdown(): Promise<void> {
    if (this.restartTimer) clearTimeout(this.restartTimer)
    if (this.rulesTimer) clearInterval(this.rulesTimer)
    await this.conn.shutdown()
    this.store.flush()
  }
}

export { DEFAULT_SETTINGS, initialConnState }
