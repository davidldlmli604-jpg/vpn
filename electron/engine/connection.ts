// Дирижёр подключения: собирает настройки, запускает движок, следит за связью,
// переподключает при обрыве, считает скорость. Не знает про Electron — поэтому проверяется обычными тестами.
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { GAMES_PRESET, buildSingBoxConfig, redactConfig, type BuildOptions, type Outbound, type RuleSetFile } from '../../core'
import { engineMissing, humanizeEngineLog, needAdminHuman, noServer, protectionHolding, unexpectedExit } from '../../shared/humanErrors'
import type { ConnState, ExitInfo, HumanError, Mode, Settings, StatsSample } from '../../shared/types'
import { TUN_LOCAL_ADDRESS, TUN_LOCAL_ADDRESS_V6, type KillSwitch } from '../platform/killswitch'
import type { SystemProxy } from '../platform/systemProxy'
import { ClashClient } from './clash'
import { pickPort, randomFreePort } from './ports'
import { PROBE_URLS, probeAny } from './probe'
import { SingBoxProcess, type EngineExit } from './process'


export interface ServerSecret {
  outbound: Outbound
  rawLink?: string
}

export interface ConnectionDeps {
  engineExe: string
  /** Рабочая папка движка (кеш, временный конфиг). */
  workDir: string
  getSettings(): Settings
  getServerName(id: string): string | null
  getSecret(id: string): ServerSecret | null
  /** Наборы правил: основные (скачанные) и запасные (вшитые). */
  ruleSets(): { primary: RuleSetFile[]; fallback: RuleSetFile[] }
  systemProxy: SystemProxy
  killSwitch: KillSwitch | null
  isAdmin(): Promise<boolean>
  platform: NodeJS.Platform
  /** Определение страны выходного адреса (через VPN). */
  fetchExit?(mixedPort: number): Promise<Pick<ExitInfo, 'countryCode' | 'countryName' | 'ip' | 'error'>>
  log(line: string): void
  /** Предупреждение, которое нужно показать человеку (например, защита не включилась). */
  onWarning?(text: string): void
  /** Мелкие события для уведомлений. */
  onEvent?(e: ConnectionEvent): void
  timing?: Partial<Timing>
  /** Адреса для проверки связи (по умолчанию — общеизвестные «204»-страницы). Нужно в основном тестам. Только обычный http. */
  probeUrls?: string[]
  /** Запоминает pid движка (или null, когда остановлен) — чтобы после аварийного завершения программы убрать забытый процесс. */
  recordEngine?(pid: number | null): void
  /** Последняя правка конфига перед запуском. Нужно в основном тестам. */
  configTransform?(config: Record<string, unknown>): Record<string, unknown>
}

export type ConnectionEvent =
  | { type: 'connected'; serverName: string }
  | { type: 'disconnected' }
  | { type: 'lost' }
  | { type: 'reconnected'; serverName: string }
  | { type: 'failed'; error: HumanError }
  | { type: 'degraded' }
  | { type: 'recovered' }

export interface Timing {
  readyTimeoutMs: number
  statsIntervalMs: number
  probeTimeoutMs: number
  firstProbeAttempts: number
  healthIntervalMs: number
  backoffMs: number[]
}

const DEFAULT_TIMING: Timing = {
  readyTimeoutMs: 30000,
  statsIntervalMs: 1000,
  probeTimeoutMs: 6000,
  firstProbeAttempts: 3,
  healthIntervalMs: 20000,
  backoffMs: [1500, 3000, 6000, 12000, 30000]
}

export function initialConnState(): ConnState {
  return { status: 'off', error: null, serverId: null, since: null, reconnect: null, degraded: false, mode: null, blocked: false }
}

export class ConnectionManager {
  state: ConnState = initialConnState()
  private proc: SingBoxProcess | null = null
  private clash: ClashClient | null = null
  private mixedPort = 0
  private configPath: string | null = null
  private lastConfig: Record<string, unknown> | null = null
  private userStopped = true
  private attemptId = 0
  private statsTimer: NodeJS.Timeout | null = null
  private healthTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private prev = { t: 0, up: 0, down: 0 }
  private carry = { up: 0, down: 0 }
  private lastLatency: number | null = null
  private failStreak = 0
  private timing: Timing

  /** Подписчики: состояние, скорость и сведения о выходном адресе. */
  onState: (s: ConnState) => void = () => undefined
  onStats: (s: StatsSample) => void = () => undefined
  onExit: (e: Partial<ExitInfo>) => void = () => undefined
  onEngineLine: (line: string) => void = () => undefined

  constructor(private readonly deps: ConnectionDeps) {
    this.timing = { ...DEFAULT_TIMING, ...(deps.timing ?? {}) }
  }

  // ---------------------------------------------------------------- состояние

  private set(patch: Partial<ConnState>): void {
    this.state = { ...this.state, ...patch }
    this.onState(this.state)
  }

  get proxyPort(): number {
    return this.mixedPort
  }
  get isRunning(): boolean {
    return !!this.proc && !this.proc.exited
  }
  get clashClient(): ClashClient | null {
    return this.clash
  }
  get engineLog(): string[] {
    return this.proc?.lines ?? []
  }

  /** Итоговый конфиг без секретов — для раздела «Для специалиста». */
  redactedConfig(): string | null {
    return this.lastConfig ? JSON.stringify(redactConfig(this.lastConfig), null, 2) : null
  }

  /**
   * Итоговые настройки движка для выбранного сервера «как они были бы сейчас», без запуска и без секретов.
   * Если подключение уже работает, показываются настоящие (с реальными портами).
   */
  preview(serverId: string | null): { json: string; note: string } | null {
    const settings = this.deps.getSettings()
    const live = this.redactedConfig()
    const id = serverId ?? settings.selectedServerId
    const name = id ? this.deps.getServerName(id) : null
    const modeWords = settings.mode === 'tun' ? 'Весь компьютер' : 'Браузер и программы'
    if (live && this.isRunning) return { json: live, note: `Настоящие настройки работающего подключения · режим «${modeWords}» · сервер «${name ?? '—'}». Секреты скрыты.` }
    const secret = id ? this.deps.getSecret(id) : null
    if (!id || !secret) return null
    const { primary } = this.deps.ruleSets()
    const cfg = buildSingBoxConfig(this.buildOptions(settings, secret.outbound, primary, 9090, 'секрет-управления', settings.advanced.mixedPort))
    const final = this.deps.configTransform ? this.deps.configTransform(cfg) : cfg
    return { json: JSON.stringify(redactConfig(final), null, 2), note: `Так будут выглядеть настройки при подключении · режим «${modeWords}» · сервер «${name ?? '—'}». Секреты скрыты; порты управления подставятся при запуске.` }
  }

  // ---------------------------------------------------------------- подключение

  async connect(serverId: string | null): Promise<void> {
    if (this.state.status === 'connecting' || this.state.status === 'on' || this.state.status === 'disconnecting') return
    const id = serverId ?? this.deps.getSettings().selectedServerId
    if (!id || !this.deps.getSecret(id)) {
      this.set({ status: 'error', error: noServer(), serverId: null })
      return
    }
    this.userStopped = false
    this.carry = { up: 0, down: 0 }
    this.failStreak = 0
    this.clearReconnectTimer()
    const mode = this.deps.getSettings().mode
    this.set({ status: 'connecting', error: null, serverId: id, since: null, reconnect: null, degraded: false, mode, blocked: false })
    await this.startOnce(id, false)
  }

  /** Один заход: запуск движка + проверка связи. При неудаче сам решает — повторять или показать ошибку. */
  private async startOnce(serverId: string, isRetry: boolean): Promise<void> {
    const attempt = ++this.attemptId
    const stale = (): boolean => attempt !== this.attemptId || this.userStopped
    try {
      try {
        await this.launchEngine(serverId, stale)
      } catch (e) {
        // порт успели занять между проверкой и запуском движка (другая программа) — один раз пробуем любой свободный
        if (!(e instanceof StartError && e.human.code === 'port-busy') || stale()) throw e
        this.deps.log('Порт локального входа оказался занят — пробую другой')
        await this.teardownEngine(true)
        await this.launchEngine(serverId, stale, true)
      }
      if (stale()) return
      const ok = await this.firstProbe(stale)
      if (stale()) return
      if (!ok) {
        const err: HumanError = { code: 'server-silent', title: 'Сервер не отвечает', text: 'Возможно, ключ устарел или введён с ошибкой. Если ключ точно рабочий, попробуйте другой сервер из списка или повторите позже.' }
        await this.teardownEngine(true)
        await this.fail(err, isRetry)
        return
      }
      this.set({ status: 'on', error: null, since: this.state.since ?? Date.now(), reconnect: null, degraded: false, blocked: false })
      this.startPollers()
      const name = this.deps.getServerName(serverId) ?? 'сервер'
      this.deps.onEvent?.(isRetry ? { type: 'reconnected', serverName: name } : { type: 'connected', serverName: name })
      void this.refreshExit()
    } catch (e) {
      if (stale()) return
      const err = e instanceof StartError ? e.human : humanizeEngineLog(this.proc?.recent(60) ?? String(e), { mode: this.state.mode ?? undefined })
      this.deps.log(`Не удалось подключиться: ${err.code}`)
      await this.teardownEngine(true)
      await this.fail(err, isRetry)
    }
  }

  private async fail(error: HumanError, wasRetry: boolean): Promise<void> {
    if (this.userStopped) return
    const s = this.deps.getSettings()
    // при потере связи (после того как уже работало) продолжаем пытаться, если разрешено
    if (wasRetry && s.autoReconnect && this.state.serverId) {
      this.scheduleReconnect(error)
      return
    }
    await this.finishStopped()
    this.set({ status: 'error', error, since: null, reconnect: null, degraded: false, blocked: false })
    this.deps.onEvent?.({ type: 'failed', error })
  }

  private async launchEngine(serverId: string, stale: () => boolean, anyPort = false): Promise<void> {
    const settings = this.deps.getSettings()
    const secret = this.deps.getSecret(serverId)
    if (!secret) throw new StartError(noServer())
    if (!existsSync(this.deps.engineExe)) throw new StartError(engineMissing())
    const mode: Mode = settings.mode
    if (mode === 'tun' && !(await this.deps.isAdmin())) throw new StartError(needAdminHuman())

    mkdirSync(this.deps.workDir, { recursive: true })
    this.mixedPort = anyPort ? await randomFreePort() : await pickPort(settings.advanced.mixedPort)
    const clashPort = await randomFreePort()
    const secretToken = randomBytes(18).toString('hex')
    this.clash = new ClashClient(clashPort, secretToken)

    const { primary, fallback } = this.deps.ruleSets()
    const build = (ruleSets: RuleSetFile[]): Record<string, unknown> => buildSingBoxConfig(this.buildOptions(settings, secret.outbound, ruleSets, clashPort, secretToken))
    const finalize = (c: Record<string, unknown>): Record<string, unknown> => (this.deps.configTransform ? this.deps.configTransform(c) : c)
    let config = finalize(build(primary))
    this.configPath = join(this.deps.workDir, 'config.json')
    let check = this.checkConfig(config)
    if (!check.ok && primary !== fallback && fallback.length) {
      this.deps.log('Скачанные списки правил не подошли — использую вшитые')
      config = finalize(build(fallback))
      check = this.checkConfig(config)
    }
    if (!check.ok) {
      this.deps.log(`Проверка настроек не прошла: ${check.output.slice(0, 600)}`)
      throw new StartError(humanizeEngineLog(check.output, { mode }))
    }
    this.lastConfig = config
    if (stale()) return

    // защита от утечки: сначала закрываем «калитку», потом открываем туннель
    if (mode === 'tun' && settings.killSwitch && this.deps.killSwitch?.supported) {
      const r = await this.deps.killSwitch.arm(this.deps.engineExe, settings.advanced.tunIpv6 ? [TUN_LOCAL_ADDRESS, TUN_LOCAL_ADDRESS_V6] : [TUN_LOCAL_ADDRESS])
      if (!r.ok) {
        this.deps.log(`Аварийная блокировка не включилась: ${r.error ?? ''}`)
        this.deps.onWarning?.('Защита не включилась: Windows не дала изменить правила сети. VPN работает, но если он оборвётся, интернет сам не отключится.')
      }
    }

    const proc = new SingBoxProcess(this.deps.engineExe, this.configPath, this.deps.workDir)
    this.proc = proc
    proc.on('line', (l: string) => this.onEngineLine(l))
    proc.on('exit', (e: EngineExit) => this.onEngineExit(proc, e))
    proc.start()
    this.deps.recordEngine?.(proc.pid ?? null)

    const started = Date.now()
    while (Date.now() - started < this.timing.readyTimeoutMs) {
      if (stale()) return
      if (proc.exited) throw new StartError(humanizeEngineLog(proc.recent(80), { mode }))
      try {
        await this.clash!.version(1000)
        break
      } catch { /* движок ещё поднимается */ }
      await sleep(120)
    }
    if (proc.exited) throw new StartError(humanizeEngineLog(proc.recent(80), { mode }))
    if (!(await this.clashReady())) throw new StartError({ code: 'start-timeout', title: 'Подключение не успело запуститься', text: 'Движок слишком долго запускается. Попробуйте ещё раз.' })

    if (mode === 'proxy') {
      try {
        await this.deps.systemProxy.set('127.0.0.1', this.mixedPort)
      } catch (e) {
        this.deps.log(`Не удалось включить системный прокси: ${(e as Error).message}`)
      }
    }
  }

  private async clashReady(): Promise<boolean> {
    try {
      await this.clash!.version(1500)
      return true
    } catch {
      return false
    }
  }

  private buildOptions(settings: Settings, outbound: Outbound, ruleSets: RuleSetFile[], clashPort: number, secret: string, mixedPort: number = this.mixedPort): BuildOptions {
    const adv = settings.advanced
    const games = settings.bypassGames ? GAMES : []
    return {
      outbound,
      mode: settings.mode,
      mixedPort,
      clashPort,
      clashSecret: secret,
      tun: { mtu: adv.mtu, stack: adv.tunStack, strictRoute: adv.strictRoute, ipv6: adv.tunIpv6 },
      bypassRu: settings.bypassRu,
      ruleSets,
      bypassProcesses: [...settings.bypassApps.map((a) => a.exe), ...games],
      alwaysVpn: settings.alwaysVpn,
      alwaysDirect: settings.alwaysDirect,
      dns: { remote: adv.dnsRemote, direct: adv.dnsDirect, leakProtection: settings.dnsLeakProtection },
      multiplex: adv.multiplex,
      logLevel: adv.logLevel
    }
  }

  /** Проверка настроек движком до запуска. Ловит многие поломки заранее. */
  private checkConfig(config: Record<string, unknown>): { ok: boolean; output: string } {
    const file = this.configPath!
    writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 })
    try { chmodSync(file, 0o600) } catch { /* на Windows права наследуются от папки */ }
    const r = spawnSync(this.deps.engineExe, ['check', '-c', file, '-D', this.deps.workDir], { encoding: 'utf8', timeout: 30000, windowsHide: true })
    return { ok: r.status === 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(/\x1b\[[0-9;]*m/g, '').trim() }
  }

  /** Первая проверка связи: движок запущен, но доходит ли трафик до сервера? */
  private async firstProbe(stale: () => boolean): Promise<boolean> {
    for (let i = 0; i < this.timing.firstProbeAttempts; i++) {
      if (stale()) return false
      const ms = await this.probeOnce()
      if (ms !== null) {
        this.lastLatency = ms
        return true
      }
      if (this.proc?.exited) return false
      await sleep(400)
    }
    return false
  }

  /** Задержка до интернета через сервер: запрос идёт тем же путём, что и у браузера. */
  async probeOnce(): Promise<number | null> {
    if (!this.proc || this.proc.exited || !this.mixedPort) return null
    return probeAny(this.mixedPort, this.deps.probeUrls ?? PROBE_URLS, this.timing.probeTimeoutMs)
  }

  // ---------------------------------------------------------------- наблюдение

  private startPollers(): void {
    this.stopPollers()
    this.prev = { t: Date.now(), up: 0, down: 0 }
    this.statsTimer = setInterval(() => void this.pollStats(), this.timing.statsIntervalMs)
    this.healthTimer = setInterval(() => void this.health(), this.timing.healthIntervalMs)
  }

  private stopPollers(): void {
    if (this.statsTimer) clearInterval(this.statsTimer)
    if (this.healthTimer) clearInterval(this.healthTimer)
    this.statsTimer = null
    this.healthTimer = null
  }

  private polling = false
  private async pollStats(): Promise<void> {
    if (this.polling || !this.clash || this.state.status !== 'on') return
    this.polling = true
    try {
      const snap = await this.clash.connections()
      const now = Date.now()
      const dt = Math.max(0.2, (now - this.prev.t) / 1000)
      const up = snap.uploadTotal
      const down = snap.downloadTotal
      const upBps = Math.max(0, (up - this.prev.up) / dt)
      const downBps = Math.max(0, (down - this.prev.down) / dt)
      this.prev = { t: now, up, down }
      this.onStats({ t: now, upBps, downBps, upTotal: this.carry.up + up, downTotal: this.carry.down + down, latencyMs: this.lastLatency })
    } catch { /* движок мог только что остановиться */ } finally {
      this.polling = false
    }
  }

  private async health(): Promise<void> {
    if (this.state.status !== 'on') return
    const ms = await this.probeOnce()
    if (this.state.status !== 'on') return
    if (ms !== null) {
      this.lastLatency = ms
      this.failStreak = 0
      if (this.state.degraded) {
        this.set({ degraded: false })
        this.deps.onEvent?.({ type: 'recovered' })
      }
      return
    }
    this.failStreak++
    if (this.failStreak >= 3 && !this.state.degraded) {
      this.lastLatency = null
      this.set({ degraded: true })
      this.deps.onEvent?.({ type: 'degraded' })
    }
  }

  /** Страна, под которой нас видит интернет. */
  async refreshExit(): Promise<void> {
    if (!this.deps.fetchExit || this.state.status !== 'on') return
    this.onExit({ checking: true, error: null })
    try {
      const r = await this.deps.fetchExit(this.mixedPort)
      if (this.state.status === 'on') this.onExit({ ...r, checking: false })
    } catch (e) {
      this.onExit({ checking: false, error: (e as Error).message })
    }
  }

  // ---------------------------------------------------------------- обрыв и переподключение

  private onEngineExit(proc: SingBoxProcess, e: EngineExit): void {
    if (proc !== this.proc) return
    this.deps.log(`Движок остановился (код ${e.code ?? e.signal})`)
    if (this.userStopped) return
    const status = this.state.status
    if (status === 'connecting') return // стартовый сбой разбирается в launchEngine
    if (status !== 'on') return
    this.stopPollers()
    this.carry = { up: this.carry.up + this.prev.up, down: this.carry.down + this.prev.down }
    // Защита держит интернет закрытым: в туннеле — правилами брандмауэра, в режиме «Браузер и программы» — системным
    // прокси, который указывает «в никуда». Снимается только когда VPN вернулся или человек сам скажет.
    const s = this.deps.getSettings()
    const mode = this.state.mode
    const holding = s.killSwitch && (mode === 'proxy' || (mode === 'tun' && !!this.deps.killSwitch?.supported))
    this.set({ blocked: holding })
    this.deps.onEvent?.({ type: 'lost' })
    void (async () => {
      this.proc = null
      this.deps.recordEngine?.(null)
      if (!(holding && mode === 'proxy')) {
        try { await this.deps.systemProxy.clear() } catch { /* ничего */ }
      }
      if (s.autoReconnect && this.state.serverId) this.scheduleReconnect(unexpectedExit())
      else if (holding) {
        await this.teardownEngine(true)
        this.set({ status: 'error', error: protectionHolding(), since: null, degraded: false, reconnect: null })
      } else {
        await this.finishStopped()
        this.set({ status: 'error', error: unexpectedExit(), since: null, degraded: false })
      }
    })()
  }

  private scheduleReconnect(reason: HumanError, attemptNo = 0): void {
    if (this.userStopped) return
    const n = (this.state.reconnect?.attempt ?? attemptNo) + 1
    const delays = this.timing.backoffMs
    const wait = delays[Math.min(n - 1, delays.length - 1)]!
    this.set({ status: 'connecting', error: reason, reconnect: { attempt: n, nextInMs: wait }, degraded: false })
    this.deps.log(`Переподключение: попытка ${n} через ${Math.round(wait / 100) / 10} с`)
    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      const id = this.state.serverId
      if (this.userStopped || !id) return
      void this.startOnce(id, true)
    }, wait)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  // ---------------------------------------------------------------- остановка

  async disconnect(): Promise<void> {
    if (this.state.status === 'off') return
    this.userStopped = true
    this.attemptId++
    this.clearReconnectTimer()
    this.set({ status: 'disconnecting', reconnect: null })
    await this.finishStopped()
    this.set({ status: 'off', error: null, since: null, serverId: this.state.serverId, reconnect: null, degraded: false, mode: null, blocked: false })
    this.deps.onEvent?.({ type: 'disconnected' })
  }

  /** Полная остановка: движок, прокси, защита, временный конфиг. */
  private async finishStopped(): Promise<void> {
    this.stopPollers()
    await this.teardownEngine(true)
    try { await this.deps.systemProxy.clear() } catch { /* ничего */ }
    try { await this.deps.killSwitch?.disarm() } catch { /* ничего */ }
  }

  private async teardownEngine(removeConfig: boolean): Promise<void> {
    const p = this.proc
    this.proc = null
    this.clash = null
    if (p) {
      await p.stop()
      this.deps.recordEngine?.(null)
    }
    if (removeConfig && this.configPath) {
      try { rmSync(this.configPath, { force: true }) } catch { /* ничего */ }
    }
  }

  /** Человек отказался от защиты, пока связь оборвана: снимаем блокировку и возвращаем обычное состояние. */
  async releaseProtection(): Promise<void> {
    if (!this.state.blocked || (this.state.status !== 'error' && this.state.status !== 'connecting')) return
    this.userStopped = true
    this.attemptId++
    this.clearReconnectTimer()
    await this.finishStopped()
    this.set({ status: 'off', error: null, since: null, reconnect: null, degraded: false, mode: null, blocked: false })
  }

  /** Вызывается при выходе из приложения. */
  async shutdown(): Promise<void> {
    this.userStopped = true
    this.attemptId++
    this.clearReconnectTimer()
    await this.finishStopped()
  }
}

class StartError extends Error {
  constructor(public readonly human: HumanError) {
    super(human.title)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

const GAMES = GAMES_PRESET.processes
