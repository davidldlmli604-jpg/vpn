// «Внутренности» Android-версии. Разбор ключей, сборка настроек движка, хранилище и тексты ошибок — общие
// с Windows (core/, shared/). Своё здесь только одно: движок запускает система через VpnService (см. native.ts).
import { buildSingBoxConfig, parseInput } from '@core/index'
import type { ToastMessage, VpnApi } from '@shared/api'
import { DataStore, SecureStorageError, newId, type Sealer, type StoreBackend } from '@shared/dataStore'
import { EXIT_SERVICES, countryNameRu, parseExit } from '@shared/exit'
import { humanizeEngineLog, noServer } from '@shared/humanErrors'
import type { AddResult, AppState, ConfigPreview, ConnState, ExitInfo, HumanError, QrResult, RunningApp, Settings, StatsSample } from '@shared/types'
import { Tropa, type NativeStatusEvent } from './native'

type Listener<T> = (v: T) => void

const notReady = { ok: false, message: 'На телефоне это появится в следующих версиях.' }
const LATENCY_URL = 'https://www.gstatic.com/generate_204'

export async function createMobileApi(): Promise<VpnApi> {
  const [info, saved] = await Promise.all([Tropa.info(), Tropa.loadData()])
  const c = new MobileController(info, saved.text ?? null, !!saved.broken)
  await c.init()
  return c
}

class MobileController implements VpnApi {
  private store: DataStore
  private conn: ConnState = { status: 'off', error: null, serverId: null, since: null, reconnect: null, degraded: false, mode: 'tun', blocked: false }
  private exit: ExitInfo = { checking: false, countryCode: null, countryName: null, ip: null, error: null }
  private stateL = new Set<Listener<AppState>>()
  private statsL = new Set<Listener<StatsSample>>()
  private toastL = new Set<Listener<ToastMessage>>()
  private logs: string[] = []
  private statsTimer: ReturnType<typeof setInterval> | null = null
  private prevTotals: { tx: number; rx: number; t: number } | null = null
  private latencyMs: number | null = null
  private latencyAt = 0
  /** Человек сам нажал «выключить» — обрыв не считается ошибкой. */
  private userStopped = false

  constructor(private readonly info: { version: string; engineVersion: string; secure: boolean }, savedText: string | null, broken: boolean) {
    let text = savedText
    const backend: StoreBackend = {
      read: () => text,
      write: (t) => {
        text = t
        void Tropa.saveData({ text: t }).catch((e: Error) => this.log(`Не удалось сохранить данные: ${e.message}`))
      },
      quarantine: () => { text = null }
    }
    // Шифруется весь файл целиком ключом из хранилища Android (см. SecureStore.kt), поэтому поштучно — без изменений.
    const sealer: Sealer = { available: () => info.secure, seal: (s) => s, open: (s) => s }
    this.store = new DataStore(backend, sealer)
    if (broken) this.store.loadNote = 'Сохранённые данные не удалось прочитать, поэтому программа начала с чистого листа.'
    // На телефоне режим один — весь трафик через VPN. Мастер первого запуска для телефона — в следующих версиях.
    if (this.store.settings.mode !== 'tun' || !this.store.settings.wizardDone) this.store.updateSettings({ mode: 'tun', wizardDone: true })
  }

  async init(): Promise<void> {
    await Tropa.addListener('status', (e) => this.onNative(e))
    const s = await Tropa.status()
    if (s.status === 'on' || s.status === 'connecting') {
      this.conn = { ...this.conn, status: s.status, serverId: this.store.settings.selectedServerId, since: s.since ?? Date.now() }
      if (s.status === 'on') this.afterConnected()
    }
    if (this.store.loadNote) setTimeout(() => this.toast('warn', this.store.loadNote!), 800)
    if (this.store.settings.connectOnLaunch && this.conn.status === 'off' && this.store.settings.selectedServerId) void this.connect()
  }

  // ------------------------------------------------------------------ события и состояние

  private log(line: string): void {
    const t = new Date().toLocaleTimeString('ru-RU')
    this.logs = [...this.logs.slice(-499), `${t} ${line}`]
  }

  private toast(kind: ToastMessage['kind'], text: string): void {
    const t: ToastMessage = { id: newId(), kind, text }
    for (const l of this.toastL) l(t)
  }

  private snapshot(): AppState {
    return {
      conn: { ...this.conn },
      exit: { ...this.exit },
      servers: this.store.views(),
      subscriptions: [],
      settings: this.store.settings,
      system: {
        platform: 'android',
        appVersion: this.info.version,
        isAdmin: false,
        elevationReady: false,
        singbox: { found: true, version: this.info.engineVersion, path: null },
        secureStorage: this.info.secure,
        rules: { updatedAt: null, count: 0, updating: false, bundledOnly: true },
        startedHidden: false,
        killSwitchActive: false,
        // на телефоне новая версия ставится файлом APK поверх старой (см. ОТЧЁТ.md)
        update: { status: 'unsupported', version: null, percent: 0, error: null, checkedAt: null }
      },
      check: null
    }
  }

  private push(): void {
    const s = this.snapshot()
    for (const l of this.stateL) l(s)
  }

  private setConn(patch: Partial<ConnState>): void {
    this.conn = { ...this.conn, ...patch }
    this.push()
  }

  private onNative(e: NativeStatusEvent): void {
    if (e.error) this.log(`Движок: ${e.error}`)
    if (e.status === 'on') {
      if (this.conn.status !== 'on') {
        this.setConn({ status: 'on', error: null, since: Date.now(), degraded: false })
        this.afterConnected()
      }
      return
    }
    if (e.status === 'connecting' || e.status === 'disconnecting') {
      this.setConn({ status: e.status })
      return
    }
    // выключено
    this.stopStats()
    this.exit = { checking: false, countryCode: null, countryName: null, ip: null, error: null }
    if (e.revoked && !this.userStopped) {
      this.setConn({ status: 'error', since: null, error: { code: 'revoked', title: 'VPN выключен системой', text: 'Android отдал VPN другому приложению или разрешение было отозвано. Нажмите кнопку, чтобы включить снова.' } })
    } else if (e.error && !this.userStopped) {
      this.setConn({ status: 'error', since: null, error: humanizeEngineLog(e.error, { mode: 'tun' }) })
    } else {
      this.setConn({ status: 'off', since: null, error: null, serverId: null })
    }
    this.userStopped = false
  }

  private afterConnected(): void {
    this.prevTotals = null
    this.latencyMs = null
    this.latencyAt = 0
    this.startStats()
    void this.checkExit()
  }

  private startStats(): void {
    this.stopStats()
    this.statsTimer = setInterval(() => void this.tick(), 1000)
  }

  private stopStats(): void {
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.statsTimer = null
  }

  private async tick(): Promise<void> {
    if (this.conn.status !== 'on') return
    const now = Date.now()
    if (now - this.latencyAt > 10000) {
      this.latencyAt = now
      void this.measureLatency()
    }
    let totals: { tx: number; rx: number }
    try { totals = await Tropa.stats() } catch { return }
    const prev = this.prevTotals
    this.prevTotals = { ...totals, t: now }
    if (!prev) return
    const dt = Math.max(0.2, (now - prev.t) / 1000)
    const sample: StatsSample = {
      t: now,
      upBps: Math.max(0, (totals.tx - prev.tx) / dt),
      downBps: Math.max(0, (totals.rx - prev.rx) / dt),
      upTotal: totals.tx,
      downTotal: totals.rx,
      latencyMs: this.latencyMs
    }
    for (const l of this.statsL) l(sample)
  }

  /** Задержка: сколько идёт короткий запрос через VPN (весь трафик телефона уже идёт через сервер). */
  private async measureLatency(): Promise<void> {
    const t0 = performance.now()
    try {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 5000)
      await fetch(`${LATENCY_URL}?t=${Date.now()}`, { method: 'GET', cache: 'no-store', signal: ctl.signal })
      clearTimeout(timer)
      this.latencyMs = Math.round(performance.now() - t0)
      if (this.conn.degraded) this.setConn({ degraded: false })
    } catch {
      this.latencyMs = null
    }
  }

  private async checkExit(): Promise<void> {
    this.exit = { ...this.exit, checking: true, error: null }
    this.push()
    let err = 'нет ответа'
    for (const url of EXIT_SERVICES) {
      try {
        const ctl = new AbortController()
        const timer = setTimeout(() => ctl.abort(), 10000)
        const r = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: ctl.signal })
        clearTimeout(timer)
        if (r.status !== 200) throw new Error(`HTTP ${r.status}`)
        const p = parseExit(await r.text())
        if (!p?.code) throw new Error('непонятный ответ')
        if (this.conn.status !== 'on') return
        this.exit = { checking: false, ip: p.ip, countryCode: p.code, countryName: countryNameRu(p.code), error: null }
        this.push()
        return
      } catch (e) {
        err = (e as Error).message
      }
    }
    this.exit = { checking: false, ip: null, countryCode: null, countryName: null, error: `Не удалось определить адрес (${err})` }
    this.push()
  }

  // ------------------------------------------------------------------ VpnApi

  async getState(): Promise<AppState> {
    return this.snapshot()
  }
  onState(cb: Listener<AppState>): () => void {
    this.stateL.add(cb)
    return () => this.stateL.delete(cb)
  }
  onStats(cb: Listener<StatsSample>): () => void {
    this.statsL.add(cb)
    return () => this.statsL.delete(cb)
  }
  onToast(cb: Listener<ToastMessage>): () => void {
    this.toastL.add(cb)
    return () => this.toastL.delete(cb)
  }
  onNavigate(): () => void {
    return () => undefined
  }

  async pasteKey(): Promise<AddResult> {
    let text = ''
    try { text = (await Tropa.readClipboard()).text } catch { /* пусто */ }
    if (!text.trim()) return this.fail('В буфере обмена пусто. Скопируйте ключ (долгое нажатие на текст → «Копировать») и нажмите ещё раз.')
    return this.addKeyText(text)
  }

  async scanQr(): Promise<AddResult> {
    const r = await Tropa.scanQr()
    if (r.denied) return this.fail('Нет доступа к камере. Разрешите его: Настройки телефона → Приложения → Тропа → Разрешения → Камера.')
    if (r.text === null) return { ok: false, added: 0, kind: 'error', message: 'Сканирование отменено.', skipped: [], firstId: null }
    return this.addKeyText(r.text)
  }

  private fail(message: string): AddResult {
    return { ok: false, added: 0, kind: 'error', message, skipped: [], firstId: null }
  }

  async addKeyText(text: string): Promise<AddResult> {
    const outcome = parseInput(text)
    if (outcome.kind === 'error') return this.fail(outcome.error.message)
    if (outcome.kind === 'subscription-url') return this.fail('Это ссылка на подписку. Подписки на телефоне появятся в следующей версии — пока добавьте ключ одного сервера.')
    try {
      const { added, duplicates } = this.store.addServers(outcome.servers)
      const skipped = outcome.failures.map((f) => `${f.hint}: ${f.error.message}`)
      if (added.length === 0) return { ...this.fail(duplicates > 0 ? 'Такой ключ уже есть в списке.' : 'Не удалось добавить ключ.'), skipped }
      // на телефоне пока нет списка серверов, поэтому новый ключ сразу становится выбранным
      this.store.updateSettings({ selectedServerId: added[0]!.id })
      const message = added.length === 1 ? `Ключ добавлен: ${added[0]!.name}` : `Добавлено серверов: ${added.length}`
      this.log(`Добавлено серверов: ${added.length}`)
      this.push()
      return { ok: true, added: added.length, kind: 'servers', message: skipped.length ? `${message}. Не удалось прочитать: ${skipped.length}` : message, skipped, firstId: added[0]!.id }
    } catch (e) {
      if (e instanceof SecureStorageError) return this.fail('Телефон не дал защитить ключ шифрованием, поэтому он не сохранён. Попробуйте перезапустить программу.')
      throw e
    }
  }

  async selectServer(id: string): Promise<void> {
    if (!this.store.server(id)) return
    this.store.updateSettings({ selectedServerId: id })
    this.push()
  }
  async renameServer(id: string, name: string): Promise<void> {
    this.store.rename(id, name)
    this.push()
  }
  async removeServer(id: string): Promise<void> {
    if (this.conn.serverId === id && this.conn.status !== 'off') await this.disconnect()
    this.store.removeServer(id)
    this.push()
  }
  async toggleFavorite(id: string): Promise<void> {
    this.store.toggleFavorite(id)
    this.push()
  }
  async pingServers(): Promise<void> { /* список серверов на телефоне — в следующих версиях */ }

  async refreshSubscription(): Promise<{ ok: boolean; message: string }> { return notReady }
  async renameSubscription(): Promise<void> { /* подписок пока нет */ }
  async removeSubscription(): Promise<void> { /* подписок пока нет */ }
  async getQr(): Promise<QrResult> { return { ok: false, message: notReady.message } }
  async runCheck(): Promise<void> { /* в следующих версиях */ }
  async clearCheck(): Promise<void> { /* в следующих версиях */ }

  private buildConfig(serverId: string): { config: string; name: string } | HumanError {
    const secret = this.store.getSecret(serverId)
    const rec = this.store.server(serverId)
    if (!secret || !rec) return noServer()
    const s: Settings = this.store.settings
    const config = buildSingBoxConfig({
      target: 'android',
      outbound: secret.outbound,
      mode: 'tun',
      mixedPort: 0,
      clashPort: 0,
      clashSecret: '',
      // IPv6 в туннеле на телефоне всегда: иначе Android пустил бы IPv6-трафик мимо VPN. (На Windows он выключен
      // по умолчанию из-за компьютеров с отключённым IPv6 — на Android такой проблемы нет.)
      tun: { mtu: s.advanced.mtu, stack: s.advanced.tunStack, ipv6: true, strictRoute: true },
      bypassRu: s.bypassRu,
      ruleSets: [],
      bypassProcesses: [],
      alwaysVpn: s.alwaysVpn,
      alwaysDirect: s.alwaysDirect,
      dns: { remote: s.advanced.dnsRemote, direct: s.advanced.dnsDirect, leakProtection: s.dnsLeakProtection },
      multiplex: s.advanced.multiplex,
      logLevel: s.advanced.logLevel
    })
    return { config: JSON.stringify(config), name: rec.name }
  }

  async connect(serverId?: string): Promise<void> {
    const id = serverId ?? this.store.settings.selectedServerId ?? this.store.servers[0]?.id ?? null
    if (!id) {
      this.setConn({ status: 'error', error: noServer() })
      return
    }
    if (id !== this.store.settings.selectedServerId) this.store.updateSettings({ selectedServerId: id })
    const built = this.buildConfig(id)
    if ('code' in built) {
      this.setConn({ status: 'error', error: built })
      return
    }
    this.userStopped = false
    this.setConn({ status: 'connecting', error: null, serverId: id, since: null, degraded: false })
    try {
      const r = await Tropa.start({ config: built.config, serverName: built.name })
      if (!r.consent) {
        this.setConn({ status: 'error', serverId: null, error: { code: 'no-consent', title: 'Нужно разрешение Android', text: 'Без разрешения телефон не даёт включить VPN. Нажмите кнопку ещё раз и выберите «OK» в окне системы.' } })
      }
    } catch (e) {
      const msg = (e as Error).message
      this.log(`Запуск: ${msg}`)
      this.setConn({ status: 'error', serverId: null, error: humanizeEngineLog(msg, { mode: 'tun' }) })
    }
  }

  async disconnect(): Promise<void> {
    this.userStopped = true
    this.setConn({ status: 'disconnecting' })
    try {
      await Tropa.stop()
    } catch (e) {
      this.log(`Остановка: ${(e as Error).message}`)
      this.setConn({ status: 'off', since: null, serverId: null })
    }
  }

  async requestTunMode(): Promise<{ ok: boolean; message: string; relaunching: boolean }> {
    return { ok: true, message: 'На телефоне через VPN всегда идёт весь трафик.', relaunching: false }
  }
  async revokeElevation(): Promise<{ ok: boolean; message: string }> { return notReady }
  async recoverInternet(): Promise<{ ok: boolean; message: string }> {
    await this.disconnect()
    return { ok: true, message: 'VPN выключен — интернет идёт напрямую.' }
  }
  async listRunningApps(): Promise<RunningApp[]> { return [] }
  async listInstalledApps(): Promise<RunningApp[]> { return [] }
  async updateRules(): Promise<{ ok: boolean; message: string }> { return notReady }

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    this.store.updateSettings({ ...patch, mode: 'tun' })
    this.push()
  }
  async updateAdvanced(patch: Partial<Settings['advanced']>): Promise<void> {
    this.store.updateAdvanced(patch)
    this.push()
  }
  async resetAdvanced(): Promise<void> { /* раздел «Для специалиста» на телефоне — в следующих версиях */ }

  async getLogs(): Promise<string[]> { return this.logs }
  async clearLogs(): Promise<void> { this.logs = [] }
  async getConfigPreview(): Promise<ConfigPreview | null> { return null }
  async copyText(text: string): Promise<void> { await Tropa.writeClipboard({ text }) }
  async checkForUpdates(): Promise<void> { /* на телефоне обновление — файлом APK */ }
  async installUpdate(): Promise<void> { /* на телефоне обновление — файлом APK */ }
  async windowAction(): Promise<void> { /* окна на телефоне нет */ }
  async quit(): Promise<void> { /* приложение закрывает система */ }
}
