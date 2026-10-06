// Контроллер приложения: связывает хранилище, подключение и окно. От Electron не зависит —
// всё, что нужно от системы, приходит через интерфейс Host (в тестах там заглушка).
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseInput } from '../core'
import type { VpnApi, ToastMessage } from '../shared/api'
import { DEFAULT_SETTINGS } from '../shared/defaults'
import type { AddResult, AppState, CheckReport, ConnState, ExitInfo, QrResult, RunningApp, Settings, StatsSample, SystemInfo } from '../shared/types'
import { ConnectionManager, initialConnState, type ConnectionEvent } from './engine/connection'
import { NoopSystemProxy, WindowsSystemProxy, type SystemProxy } from './platform/systemProxy'
import { KillSwitch } from './platform/killswitch'
import { countryOfIp, fetchExitInfo } from './services/ipcheck'
import { newReport, runSelfCheck } from './services/selfcheck'
import { probeRoute } from './engine/route'
import { killStaleEngine } from './engine/stale'
import { ERR_BAD_KEY, ERR_ENGINE, measureLatencies, type LatencyTarget } from './engine/latency'
import { AppLog } from './services/logger'
import { RuleSets } from './services/rules'
import { fetchSubscription as realFetchSubscription, subscriptionDue, type SubscriptionFetch } from './services/subscriptions'
import QRCode from 'qrcode'
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
  private probeUrls: string[] | undefined
  private pingAborts = new Set<AbortController>()
  private pinging = new Set<string>()
  private fetchSub: (url: string, proxyPort: number | null) => Promise<SubscriptionFetch>
  private refreshingSubs = new Set<string>()
  private lastSubTry = new Map<string, number>()
  private subTimer: NodeJS.Timeout | null = null
  private check: CheckReport | null = null
  private checkToken = 0
  private runningCheck = 0
  private fetchExitFn: typeof fetchExitInfo
  private countryOfFn: typeof countryOfIp
  private ruCheckUrl: string

  private stateListeners: Array<Listener<AppState>> = []
  private statsListeners: Array<Listener<StatsSample>> = []
  private toastListeners: Array<Listener<ToastMessage>> = []
  private navListeners: Array<Listener<string>> = []

  constructor(readonly host: Host, readonly paths: ControllerPaths, sealer: Sealer, overrides: { systemProxy?: SystemProxy; fetchExit?: typeof fetchExitInfo; ruleFetch?: (url: string) => Promise<Buffer>; probeUrls?: string[]; fetchSubscription?: (url: string, proxyPort: number | null) => Promise<SubscriptionFetch>; countryOf?: typeof countryOfIp; ruCheckUrl?: string; configTransform?: (config: Record<string, unknown>) => Record<string, unknown> } = {}) {
    this.probeUrls = overrides.probeUrls
    this.fetchSub = overrides.fetchSubscription ?? realFetchSubscription
    this.countryOfFn = overrides.countryOf ?? countryOfIp
    this.ruCheckUrl = overrides.ruCheckUrl ?? 'http://ya.ru/'
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
    this.fetchExitFn = fetchExit
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
      probeUrls: overrides.probeUrls,
      configTransform: overrides.configTransform,
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
    // подписки обновляются сами по сроку, который задал поставщик (обычно раз в 12 часов); без шума, если всё хорошо
    setTimeout(() => void this.refreshDueSubscriptions(), 15_000)
    this.subTimer = setInterval(() => void this.refreshDueSubscriptions(), 10 * 60_000)
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
      subscriptions: this.store.subscriptionViews(this.refreshingSubs),
      settings: this.store.settings,
      system: this.system(),
      check: this.check
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
    // результат проверки относится к конкретному подключению: оно закончилось — результат уже ни о чём
    if (s.status !== 'on' && this.check) { this.check = null; this.checkToken++ }
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
    if (outcome.kind === 'subscription-url') return this.addSubscriptionUrl(outcome.url)
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

  /** Проверка задержки: все серверы, если ids не заданы. Результаты появляются в списке по мере готовности. */
  async pingServers(ids?: string[]): Promise<void> {
    const wanted = (ids && ids.length ? ids : this.store.servers.map((s) => s.id)).filter((id) => this.store.server(id) && !this.pinging.has(id))
    const targets: LatencyTarget[] = []
    for (const id of wanted) {
      const secret = this.store.getSecret(id)
      if (secret) targets.push({ id, outbound: secret.outbound })
      else this.store.setLatency(id, { error: ERR_BAD_KEY })
    }
    if (targets.length === 0) { this.pushState(); return }
    if (!existsSync(this.paths.engineExe)) {
      for (const t of targets) this.store.setLatency(t.id, { error: ERR_ENGINE })
      this.pushState()
      this.toast('error', 'Не найден движок (sing-box), проверить серверы не получится.')
      return
    }
    for (const t of targets) { this.store.setLatency(t.id, 'testing'); this.pinging.add(t.id) }
    this.pushState()
    this.log.add(`Проверка задержки: серверов ${targets.length}`)
    const ac = new AbortController()
    this.pingAborts.add(ac)
    try {
      await measureLatencies(targets, {
        engineExe: this.paths.engineExe,
        workDir: join(this.paths.userDir, 'runtime'),
        probeUrls: this.probeUrls,
        signal: ac.signal,
        log: (l) => this.log.add(l),
        onResult: (id, r) => {
          this.store.setLatency(id, r)
          this.pinging.delete(id)
          this.pushState()
        }
      })
    } catch (e) {
      this.log.add(`Проверка задержки не удалась: ${(e as Error).message}`)
    } finally {
      this.pingAborts.delete(ac)
      // тех, до кого очередь не дошла (прервали или сбой), возвращаем в «не проверен»
      for (const t of targets) {
        if (this.pinging.delete(t.id)) this.store.setLatency(t.id, null)
      }
      this.pushState()
    }
  }

  // ---------------------------------------------------------------- подписки

  /** Порт нашего локального прокси, если VPN сейчас работает: через него можно достать сайт подписки, заблокированный у провайдера. */
  private activeProxyPort(): number | null {
    return this.conn.state.status === 'on' && this.conn.isRunning ? this.conn.proxyPort : null
  }

  private async addSubscriptionUrl(url: string): Promise<AddResult> {
    const fail = (message: string): AddResult => ({ ok: false, added: 0, kind: 'error', message, skipped: [], firstId: null })
    if (!this.store.secureAvailable) return fail('Не удалось защитить ссылку средствами Windows, поэтому подписка не сохранена. Попробуйте перезапустить программу.')
    const existing = this.store.subscriptions.find((s) => this.store.openUrl(s) === url)
    if (existing) {
      const r = await this.doRefresh(existing.id, false)
      return { ok: r.ok, added: 0, kind: 'subscription', message: r.ok ? 'Такая подписка уже есть — список серверов обновлён.' : r.message, skipped: [], firstId: null }
    }
    this.log.add('Загружаю подписку')
    const f = await this.fetchSub(url, this.activeProxyPort())
    if (f.outcome.kind !== 'servers') return fail(f.outcome.kind === 'error' ? f.outcome.error.message : 'Подписка пустая.')
    try {
      const sub = this.store.addSubscription(url, f.title ?? '')
      const r = this.store.reconcileSubscription(sub.id, f.outcome.servers)
      this.store.setSubscriptionResult(sub.id, { error: null, info: f.info, title: f.title, intervalHours: f.intervalHours })
      const first = this.store.servers.find((s) => s.subscriptionId === sub.id) ?? null
      if (first && !this.store.settings.selectedServerId) this.store.updateSettings({ selectedServerId: first.id })
      const skipped = f.outcome.failures.map((x) => `${x.hint}: ${x.error.message}`)
      this.log.add(`Подписка добавлена, серверов: ${r.added}`)
      this.pushState()
      const name = this.store.subscription(sub.id)?.name ?? 'Подписка'
      const base = `Подписка «${name}» добавлена: серверов ${r.added}`
      return { ok: true, added: r.added, kind: 'subscription', message: skipped.length ? `${base}. Не удалось прочитать: ${skipped.length}` : base, skipped, firstId: first?.id ?? null }
    } catch (e) {
      if (e instanceof SecureStorageError) return fail('Не удалось защитить ключи средствами Windows, поэтому подписка не сохранена. Попробуйте перезапустить программу.')
      throw e
    }
  }

  private async doRefresh(id: string, silent: boolean): Promise<{ ok: boolean; message: string }> {
    const rec = this.store.subscription(id)
    if (!rec) return { ok: false, message: 'Такой подписки нет.' }
    if (this.refreshingSubs.has(id)) return { ok: true, message: 'Подписка уже обновляется.' }
    const url = this.store.openUrl(rec)
    if (!url) return { ok: false, message: 'Не удалось прочитать адрес подписки. Удалите её и добавьте заново.' }
    this.refreshingSubs.add(id)
    this.lastSubTry.set(id, Date.now())
    this.pushState()
    try {
      const f = await this.fetchSub(url, this.activeProxyPort())
      if (f.outcome.kind !== 'servers') {
        const message = f.outcome.kind === 'error' ? f.outcome.error.message : 'Подписка пустая.'
        // старые серверы остаются: временный сбой не должен оставлять человека без списка
        this.store.setSubscriptionResult(id, { error: message })
        this.log.add('Подписка не обновилась')
        if (!silent) this.toast('warn', message)
        return { ok: false, message }
      }
      const before = this.store.settings.selectedServerId
      const beforeRec = before ? this.store.server(before) : null
      const keep = new Set<string>()
      if (this.conn.state.serverId && this.conn.state.status !== 'off') keep.add(this.conn.state.serverId)
      const r = this.store.reconcileSubscription(id, f.outcome.servers, keep)
      this.store.setSubscriptionResult(id, { error: null, info: f.info, title: f.title, intervalHours: f.intervalHours })
      // выбранный сервер исчез из подписки — выбираем похожий (тот же адрес, то же название), а не оставляем человека ни с чем
      if (before && beforeRec?.subscriptionId === id && !this.store.server(before)) {
        const mine = this.store.servers.filter((s) => s.subscriptionId === id)
        const next = mine.find((s) => s.host === beforeRec.host && s.port === beforeRec.port) ?? mine.find((s) => (s.origName ?? s.name) === (beforeRec.origName ?? beforeRec.name)) ?? mine[0]
        if (next) this.store.updateSettings({ selectedServerId: next.id })
      }
      this.log.add(`Подписка обновлена: добавлено ${r.added}, убрано ${r.removed}, обновлено ${r.updated}`)
      const parts = [r.added ? `добавлено ${r.added}` : '', r.removed ? `убрано ${r.removed}` : ''].filter(Boolean)
      const message = parts.length ? `Список серверов обновлён: ${parts.join(', ')}.` : 'Список серверов актуален: изменений нет.'
      if (!silent) this.toast('success', message)
      return { ok: true, message }
    } finally {
      this.refreshingSubs.delete(id)
      this.pushState()
    }
  }

  async refreshSubscription(id: string): Promise<{ ok: boolean; message: string }> {
    return this.doRefresh(id, false)
  }

  /** Фоновое обновление по сроку. Тихое: человек узнаёт только о проблемах (значок у подписки), а не о каждом обновлении. */
  async refreshDueSubscriptions(): Promise<void> {
    for (const rec of [...this.store.subscriptions]) {
      if (subscriptionDue(rec, Date.now(), this.lastSubTry.get(rec.id))) await this.doRefresh(rec.id, true)
    }
  }

  async renameSubscription(id: string, name: string): Promise<void> {
    this.store.renameSubscription(id, name)
    this.pushState()
  }

  async removeSubscription(id: string): Promise<void> {
    const activeId = this.conn.state.serverId
    if (activeId && this.conn.state.status !== 'off' && this.store.server(activeId)?.subscriptionId === id) await this.disconnect()
    this.store.removeSubscription(id, true)
    this.log.add('Подписка удалена вместе с серверами')
    this.pushState()
  }

  // ---------------------------------------------------------------- «Проверить, всё ли работает»

  async runCheck(): Promise<void> {
    // уже идёт и человек его видит — второй запуск не нужен; если окно проверки закрыли, можно начать заново
    if (this.runningCheck && this.check) return
    const clash = this.conn.clashClient
    if (this.conn.state.status !== 'on' || !clash) {
      this.check = { ...newReport(), steps: [], finished: true, verdict: 'fail', summary: 'Сначала включите VPN — пока проверять нечего.' }
      this.pushState()
      return
    }
    const port = this.conn.proxyPort
    const rec = this.conn.state.serverId ? this.store.server(this.conn.state.serverId) : null
    const settings = this.store.settings
    const token = ++this.checkToken
    this.runningCheck = token
    this.log.add('Проверка «всё ли работает»: начало')
    try {
      const report = await runSelfCheck({
        mode: this.conn.state.mode,
        serverName: rec?.name ?? 'сервер',
        serverCountry: rec?.countryCode ? rec.countryCode.toUpperCase() : null,
        bypassRu: settings.bypassRu,
        dnsLeakProtection: settings.dnsLeakProtection,
        probe: () => this.conn.probeOnce(),
        fetchExit: () => this.fetchExitFn(port),
        fetchRealExit: () => this.fetchExitFn(null),
        dnsResolverIp: async () => {
          try {
            // Akamai в ответ называет адрес того, кто его спросил, — так видно, чей DNS-узел искал адрес за нас
            const r = await clash.dnsQuery('whoami.akamai.net', 'A', 8000)
            return r.Answer?.find((a) => a.type === 1)?.data ?? null
          } catch { return null }
        },
        countryOf: (ip) => this.countryOfFn(ip, port),
        ruDirect: async () => {
          const r = await probeRoute(port, clash, this.ruCheckUrl)
          return { ms: r.ms, chain: r.chain }
        },
        isCancelled: () => token !== this.checkToken || this.conn.state.status !== 'on',
        onUpdate: (r) => {
          if (token !== this.checkToken) return
          this.check = r
          this.pushState()
        }
      })
      this.log.add(`Проверка «всё ли работает»: ${report.verdict ?? 'прервана'}`)
    } catch (e) {
      this.log.add(`Проверка не удалась: ${(e as Error).message}`)
      if (token === this.checkToken) {
        this.check = { ...newReport(), steps: [], finished: true, verdict: 'fail', summary: 'Проверка не удалась из-за внутренней ошибки. Попробуйте ещё раз.' }
        this.pushState()
      }
    } finally {
      if (this.runningCheck === token) this.runningCheck = 0
    }
  }

  async clearCheck(): Promise<void> {
    this.checkToken++
    this.check = null
    this.pushState()
  }

  // ---------------------------------------------------------------- QR-код

  /** QR-код показывается только по просьбе человека. Ключ целиком в журнал не попадает. */
  async getQr(kind: 'server' | 'subscription', id: string): Promise<QrResult> {
    let text: string | null = null
    let title = ''
    if (kind === 'server') {
      const rec = this.store.server(id)
      if (!rec) return { ok: false, message: 'Такого сервера нет.' }
      text = this.store.getSecret(id)?.rawLink ?? null
      title = `Ключ «${rec.name}»`
      if (!text) return { ok: false, message: 'У этого сервера нет исходной ссылки (он добавлен из готового файла настроек), поэтому QR-код сделать нельзя.' }
    } else {
      const sub = this.store.subscription(id)
      if (!sub) return { ok: false, message: 'Такой подписки нет.' }
      text = this.store.openUrl(sub)
      title = `Подписка «${sub.name}»`
      if (!text) return { ok: false, message: 'Не удалось прочитать адрес подписки.' }
    }
    if (text.length > 2200) return { ok: false, message: 'Этот ключ слишком длинный, в QR-код он не помещается.' }
    try {
      const dataUrl = await QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 2, width: 440, color: { dark: '#0b1020', light: '#ffffff' } })
      this.log.add(`Показан QR-код (${kind === 'server' ? 'сервер' : 'подписка'})`)
      return { ok: true, dataUrl, title }
    } catch {
      return { ok: false, message: 'Не удалось построить QR-код.' }
    }
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
    if (this.subTimer) clearInterval(this.subTimer)
    for (const ac of this.pingAborts) ac.abort()
    await this.conn.shutdown()
    this.store.flush()
  }
}

export { DEFAULT_SETTINGS, initialConnState }
