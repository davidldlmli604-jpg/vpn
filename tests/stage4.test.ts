// Этап 4: защита (аварийная блокировка), трей, автозапуск, подключение при запуске, настройки для специалиста, мастер.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { RULESETS, parseInput } from '../core'
import type { RuleSetFile } from '../core'
import { AppController } from '../electron/controller'
import { ConnectionManager, initialConnState, type ConnectionDeps } from '../electron/engine/connection'
import type { ExecResult, Runner } from '../electron/platform/exec'
import { KillSwitch, RULE_GROUP, armScript, disarmScript, parsePolicies, readPoliciesScript, type ProfilePolicies } from '../electron/platform/killswitch'
import { consumeHiddenStart, markHiddenStart } from '../electron/platform/hiddenStart'
import type { SystemProxy } from '../electron/platform/systemProxy'
import { TrayController, buildTrayMenu, statusWords, trayStatusOf, trayTooltip, type TrayDeps, type TrayLike, type TrayMenuItem } from '../electron/tray'
import type { Sealer } from '../electron/store'
import { DEFAULT_SETTINGS } from '../shared/defaults'
import type { ConnState, Settings } from '../shared/types'
import { fakeHost } from './helpers/fakeHost'
import { Box, freePort, removeDir, startTarget, tempDir } from './helpers/loopback'
import { RULES_DIR, singBoxPath } from './helpers/singbox'

const b64 = (s: string): string => Buffer.from(s).toString('base64')
const decodePs = (args: string[]): string => Buffer.from(args[args.indexOf('-EncodedCommand') + 1]!, 'base64').toString('utf16le')
const canTun = process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0 && existsSync('/dev/net/tun')
const sealer: Sealer = { available: () => true, seal: (p) => 'S:' + Buffer.from(p).toString('base64'), open: (s) => Buffer.from(s.slice(2), 'base64').toString() }
const ok = (stdout = ''): ExecResult => ({ code: 0, stdout, stderr: '' })

const POLICIES_OUT = 'Domain=Allow\r\nPrivate=Allow\r\nPublic=Block\r\n'

/** Подставной PowerShell: запоминает, какие сценарии запускали, и умеет «ломаться». */
function fakePowerShell(opts: { failArm?: boolean; onScript?: (kind: 'read' | 'arm' | 'disarm', script: string) => void } = {}): { exec: Runner; scripts: Array<{ kind: 'read' | 'arm' | 'disarm'; script: string }> } {
  const scripts: Array<{ kind: 'read' | 'arm' | 'disarm'; script: string }> = []
  const exec: Runner = async (_file, args) => {
    const script = decodePs(args)
    const kind = script.includes('Get-NetFirewallProfile') && !script.includes('Set-NetFirewallProfile') ? 'read' : script.includes('-DefaultOutboundAction Block') ? 'arm' : 'disarm'
    scripts.push({ kind, script })
    opts.onScript?.(kind, script)
    if (kind === 'read') return ok(POLICIES_OUT)
    if (kind === 'arm' && opts.failArm) return { code: 1, stdout: '', stderr: 'Access is denied' }
    return ok()
  }
  return { exec, scripts }
}

function memoryStore(): { store: ConstructorParameters<typeof KillSwitch>[0]; data: { active: boolean; previous: ProfilePolicies | null } } {
  const data = { active: false, previous: null as ProfilePolicies | null }
  return { data, store: { load: () => ({ ...data }), save: (s) => { data.active = s.active; data.previous = s.previous } } }
}

describe('аварийная блокировка: сценарии брандмауэра', () => {
  it('сценарий включения: разрешены только движок, туннель и домашняя сеть; всё остальное исходящее закрыто', () => {
    const s = armScript("C:\\Program Files\\Тропа's\\sing-box.exe")
    expect(s).toContain(`-Group '${RULE_GROUP}'`)
    expect(s).toContain("-Program 'C:\\Program Files\\Тропа''s\\sing-box.exe'") // апостроф в пути удвоен — сценарий не ломается
    expect(s).toContain("-LocalAddress '172.19.0.1'")
    expect(s).toContain("'192.168.0.0/16'")
    expect(s).toContain('Set-NetFirewallProfile -Profile Domain,Private,Public -DefaultOutboundAction Block')
    expect(s.indexOf('New-NetFirewallRule')).toBeLessThan(s.indexOf('Set-NetFirewallProfile')) // сначала «калитки», потом закрытие
  })

  it('при IPv6 в туннеле разрешены оба адреса туннеля', () => {
    expect(armScript('C:\\x\\sing-box.exe', ['172.19.0.1', 'fdfe:dcba:9876::1'])).toContain("-LocalAddress '172.19.0.1','fdfe:dcba:9876::1'")
  })

  it('сценарий выключения возвращает прежние настройки человека, но никогда не оставляет «Block» нашей же защиты', () => {
    const prev: ProfilePolicies = { Domain: 'Allow', Private: 'Block', Public: 'NotConfigured' }
    const s = disarmScript(prev)
    expect(s).toContain('-Profile Domain -DefaultOutboundAction Allow')
    expect(s).toContain('-Profile Private -DefaultOutboundAction Allow') // у человека было «Block» — это могла быть наша защита после аварии
    expect(s).toContain('-Profile Public -DefaultOutboundAction NotConfigured')
    expect(s).toContain('Remove-NetFirewallRule')
    expect(disarmScript(null)).toContain('-Profile Public -DefaultOutboundAction Allow') // не знаем прежнего — обычное «разрешено»
  })

  it('чтение настроек брандмауэра', () => {
    expect(readPoliciesScript()).toContain('Get-NetFirewallProfile')
    expect(parsePolicies(POLICIES_OUT)).toEqual({ Domain: 'Allow', Private: 'Allow', Public: 'Block' })
    expect(parsePolicies('мусор')).toBeNull()
  })
})

describe('аварийная блокировка: включение и выключение', () => {
  it('включение: запоминает прежнее ДО изменений, потом закрывает; выключение возвращает и забывает', async () => {
    const { exec, scripts } = fakePowerShell()
    const m = memoryStore()
    const ks = new KillSwitch(m.store, exec, 'win32')
    expect(ks.supported).toBe(true)
    expect(ks.active).toBe(false)
    const r = await ks.arm('C:\\app\\sing-box.exe')
    expect(r.ok).toBe(true)
    expect(scripts.map((s) => s.kind)).toEqual(['read', 'arm'])
    expect(m.data).toEqual({ active: true, previous: { Domain: 'Allow', Private: 'Allow', Public: 'Block' } })
    expect(ks.active).toBe(true)
    await ks.disarm()
    expect(scripts.map((s) => s.kind)).toEqual(['read', 'arm', 'disarm'])
    expect(m.data).toEqual({ active: false, previous: null })
  })

  it('повторное включение (при переподключении) не затирает запомненное прежнее состояние', async () => {
    const { exec } = fakePowerShell()
    const m = memoryStore()
    const ks = new KillSwitch(m.store, exec, 'win32')
    await ks.arm('C:\\a.exe')
    m.data.previous = { Domain: 'Allow', Private: 'Allow', Public: 'Allow' } // «настоящее» прежнее
    await ks.arm('C:\\a.exe')
    expect(m.data.previous).toEqual({ Domain: 'Allow', Private: 'Allow', Public: 'Allow' }) // второй раз прежнее не перечитывали (там уже наш «Block»)
  })

  it('не удалось настроить брандмауэр: защита откатывается, человеку сообщается', async () => {
    const { exec, scripts } = fakePowerShell({ failArm: true })
    const m = memoryStore()
    const ks = new KillSwitch(m.store, exec, 'win32')
    const r = await ks.arm('C:\\a.exe')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('Access is denied')
    expect(m.data.active).toBe(false)
    expect(scripts.map((s) => s.kind)).toEqual(['read', 'arm', 'disarm']) // откат
  })

  it('выключение без включения ничего не запускает; «принудительно» — запускает (аварийная кнопка)', async () => {
    const { exec, scripts } = fakePowerShell()
    const ks = new KillSwitch(memoryStore().store, exec, 'win32')
    await ks.disarm()
    expect(scripts).toHaveLength(0)
    await ks.disarm(true)
    expect(scripts.map((s) => s.kind)).toEqual(['disarm'])
  })

  it('не Windows: ничего не делает и честно говорит об этом', async () => {
    const { exec, scripts } = fakePowerShell()
    const ks = new KillSwitch(memoryStore().store, exec, 'linux')
    expect(ks.supported).toBe(false)
    expect(await ks.arm('/x')).toEqual({ ok: false, error: 'not-supported' })
    await ks.disarm(true)
    expect(scripts).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// Подключение с защитой — на настоящем движке
// ---------------------------------------------------------------------------------------------------------------------

let dir: string
let target: { port: number; close: () => Promise<void> }
let server: Box
let serverPort: number
const bundled: RuleSetFile[] = RULESETS.sets.map((s) => ({ tag: s.file.replace(/\.srs$/, ''), path: join(RULES_DIR, s.file), role: s.role as RuleSetFile['role'] }))

beforeAll(async () => {
  dir = tempDir('tropa-s4-')
  target = await startTarget('ok-stage4')
  serverPort = await freePort()
  server = new Box('server', {
    log: { level: 'info' },
    inbounds: [{ type: 'shadowsocks', tag: 'in', listen: '127.0.0.1', listen_port: serverPort, method: 'aes-256-gcm', password: 'pw' }],
    outbounds: [{ type: 'direct', tag: 'direct' }],
    route: { rules: [{ action: 'route', outbound: 'direct', override_address: '127.0.0.1', override_port: target.port }], final: 'direct' }
  }, dir)
  await server.start()
}, 60000)

afterAll(async () => {
  await server?.stop()
  await target?.close()
  if (dir) removeDir(dir)
})

class FakeProxy implements SystemProxy {
  supported = true
  calls: string[] = []
  async set(_h: string, port: number): Promise<void> { this.calls.push(`set:${port}`) }
  async clear(): Promise<void> { this.calls.push('clear') }
  async pointsTo(): Promise<boolean> { return false }
}

/** Туннель для теста безопасный: устройство создаётся, но маршруты не меняются — сеть песочницы не затрагивается. */
const safeTun = (config: Record<string, unknown>): Record<string, unknown> => {
  const tun = (config.inbounds as Array<Record<string, unknown>>).find((i) => i.type === 'tun')
  if (tun) {
    tun.auto_route = false
    tun.strict_route = false
    tun.interface_name = `tt${Math.random().toString(36).slice(2, 7)}`
    delete tun.route_exclude_address
  }
  return config
}

function setup(over: { settings?: Partial<Settings>; failArm?: boolean; supported?: boolean } = {}) {
  const parsed = parseInput(`ss://${b64('aes-256-gcm:pw')}@127.0.0.1:${serverPort}#Тест`)
  if (parsed.kind !== 'servers') throw new Error('ключ не разобрался')
  const settings: Settings = { ...DEFAULT_SETTINGS, ...(over.settings ?? {}), selectedServerId: 's1' }
  const order: string[] = []
  const ps = fakePowerShell({ failArm: over.failArm, onScript: (kind) => order.push(kind) })
  const mem = memoryStore()
  const ks = new KillSwitch(mem.store, ps.exec, over.supported === false ? 'linux' : 'win32')
  const proxy = new FakeProxy()
  const states: ConnState[] = []
  const warnings: string[] = []
  const workDir = join(dir, 'w-' + Math.random().toString(36).slice(2, 8))
  mkdirSync(workDir, { recursive: true })
  const deps: ConnectionDeps = {
    engineExe: singBoxPath(),
    workDir,
    getSettings: () => settings,
    getServerName: () => 'Тест',
    getSecret: (id) => (id === 's1' ? { outbound: parsed.servers[0]!.outbound } : null),
    ruleSets: () => ({ primary: bundled, fallback: bundled }),
    systemProxy: proxy,
    killSwitch: ks,
    isAdmin: async () => true,
    platform: process.platform,
    log: () => undefined,
    onWarning: (t) => warnings.push(t),
    recordEngine: (pid) => order.push(pid ? 'engine-start' : 'engine-stop'),
    probeUrls: ['http://cp.cloudflare.com/generate_204'],
    configTransform: safeTun,
    timing: { probeTimeoutMs: 3000, firstProbeAttempts: 2, statsIntervalMs: 500, healthIntervalMs: 60000, backoffMs: [200, 400] }
  }
  const mgr = new ConnectionManager(deps)
  mgr.onState = (s) => states.push(s)
  return { mgr, ks, mem, proxy, order, scripts: ps.scripts, warnings, states, settings }
}

async function waitFor(cond: () => boolean, ms = 15000, what = 'условие'): Promise<void> {
  const t = Date.now()
  while (Date.now() - t < ms) {
    if (cond()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`не дождались: ${what}`)
}
const killEngine = (mgr: ConnectionManager): void => { process.kill((mgr as unknown as { proc: { pid: number } }).proc.pid, 'SIGKILL') }

describe.skipIf(!canTun)('защита при подключении на настоящем движке (режим «Весь компьютер»)', () => {
  it('защита включена: сначала закрывается «калитка», потом стартует движок; при отключении — открывается', async () => {
    const t = setup({ settings: { mode: 'tun', killSwitch: true } })
    await t.mgr.connect('s1')
    expect(t.mgr.state.status).toBe('on')
    expect(t.mgr.state.blocked).toBe(false)
    expect(t.order.indexOf('arm')).toBeGreaterThanOrEqual(0)
    expect(t.order.indexOf('arm')).toBeLessThan(t.order.indexOf('engine-start')) // порядок важен: иначе при запуске была бы щель
    expect(t.ks.active).toBe(true)
    await t.mgr.disconnect()
    expect(t.order).toContain('disarm')
    expect(t.ks.active).toBe(false)
    expect(t.mgr.state.status).toBe('off')
  }, 60000)

  it('защита выключена: брандмауэр не трогается вообще', async () => {
    const t = setup({ settings: { mode: 'tun', killSwitch: false } })
    await t.mgr.connect('s1')
    expect(t.mgr.state.status).toBe('on')
    await t.mgr.disconnect()
    expect(t.scripts).toHaveLength(0)
  }, 60000)

  it('обрыв без переподключения: интернет остаётся закрытым (а не открывается тихо); освобождается по просьбе человека', async () => {
    const t = setup({ settings: { mode: 'tun', killSwitch: true, autoReconnect: false } })
    await t.mgr.connect('s1')
    t.order.length = 0
    killEngine(t.mgr)
    await waitFor(() => t.mgr.state.status === 'error', 10000, 'ошибка после обрыва')
    expect(t.mgr.state.blocked).toBe(true)
    expect(t.mgr.state.error?.code).toBe('protection-holding')
    expect(t.mgr.state.error?.text).toContain('Починить интернет')
    expect(t.order).not.toContain('disarm') // защита держится
    expect(t.ks.active).toBe(true)
    await t.mgr.releaseProtection()
    expect(t.mgr.state).toMatchObject({ status: 'off', blocked: false, error: null })
    expect(t.order).toContain('disarm')
    expect(t.ks.active).toBe(false)
  }, 60000)

  it('обрыв с переподключением: пока ждём — интернет закрыт, вернулась связь — снова открыт для туннеля, защита та же', async () => {
    const t = setup({ settings: { mode: 'tun', killSwitch: true, autoReconnect: true } })
    await t.mgr.connect('s1')
    killEngine(t.mgr)
    await waitFor(() => t.mgr.state.status === 'connecting' && t.mgr.state.reconnect !== null, 8000, 'режим переподключения')
    expect(t.mgr.state.blocked).toBe(true)
    expect(t.order.filter((x) => x === 'disarm')).toHaveLength(0) // в паузе защита не снимается
    await waitFor(() => t.mgr.state.status === 'on', 20000, 'возврат подключения')
    expect(t.mgr.state.blocked).toBe(false)
    expect(t.ks.active).toBe(true)
    await t.mgr.disconnect()
    expect(t.ks.active).toBe(false)
  }, 90000)

  it('первое подключение не удалось (неверный ключ): защита снимается, человек не остаётся без интернета', async () => {
    const t = setup({ settings: { mode: 'tun', killSwitch: true } })
    // сервер «молчит»: порт, на котором никого нет
    ;(t.mgr as unknown as { deps: ConnectionDeps }).deps.getSecret = () => ({ outbound: { type: 'shadowsocks', server: '127.0.0.1', server_port: 1, method: 'aes-256-gcm', password: 'x' } })
    await t.mgr.connect('s1')
    await waitFor(() => t.mgr.state.status === 'error', 25000, 'ошибка подключения')
    expect(t.mgr.state.blocked).toBe(false)
    expect(t.ks.active).toBe(false)
    expect(t.order).toContain('disarm')
  }, 60000)

  it('не удалось включить защиту: VPN всё равно работает, но человеку честно сообщается', async () => {
    const t = setup({ settings: { mode: 'tun', killSwitch: true }, failArm: true })
    await t.mgr.connect('s1')
    expect(t.mgr.state.status).toBe('on')
    expect(t.warnings).toHaveLength(1)
    expect(t.warnings[0]).toContain('Защита не включилась')
    expect(t.ks.active).toBe(false)
    await t.mgr.disconnect()
  }, 60000)
})

describe('защита в режиме «Браузер и программы» (системный прокси)', () => {
  it('обрыв без переподключения: системный прокси остаётся указывать «в никуда» — браузеры не утекут; освобождается по просьбе', async () => {
    const t = setup({ settings: { mode: 'proxy', killSwitch: true, autoReconnect: false } })
    await t.mgr.connect('s1')
    const port = t.mgr.proxyPort
    killEngine(t.mgr)
    await waitFor(() => t.mgr.state.status === 'error', 10000, 'ошибка после обрыва')
    expect(t.mgr.state.blocked).toBe(true)
    expect(t.proxy.calls).toEqual([`set:${port}`]) // «clear» не вызывался
    await t.mgr.releaseProtection()
    expect(t.proxy.calls[t.proxy.calls.length - 1]).toBe('clear')
    expect(t.mgr.state).toMatchObject({ status: 'off', blocked: false })
    expect(t.scripts).toHaveLength(0) // брандмауэр в этом режиме не трогается
  }, 60000)

  it('защита выключена: при обрыве прокси сразу возвращается (интернет работает напрямую)', async () => {
    const t = setup({ settings: { mode: 'proxy', killSwitch: false, autoReconnect: false } })
    await t.mgr.connect('s1')
    killEngine(t.mgr)
    await waitFor(() => t.mgr.state.status === 'error', 10000, 'ошибка после обрыва')
    expect(t.mgr.state.blocked).toBe(false)
    expect(t.proxy.calls[t.proxy.calls.length - 1]).toBe('clear')
  }, 60000)
})

describe('контроллер: защита и «Починить интернет»', () => {
  function make(name: string, over: { admin?: boolean } = {}) {
    const fh = fakeHost({ admin: over.admin ?? false })
    const ps = fakePowerShell()
    const proxy = new FakeProxy()
    const c = new AppController(fh.host, { userDir: join(dir, name), engineExe: singBoxPath(), bundledRulesDir: join(__dirname, '..', 'resources', 'rules') }, sealer, { ruleFetch: async () => Buffer.alloc(0), systemProxy: proxy, probeUrls: ['http://cp.cloudflare.com/generate_204'], killSwitchRunner: ps.exec })
    return { c, ps, proxy, fh }
  }

  it('«Починить интернет»: снимает защиту (даже если программа «забыла», что она включена), возвращает прокси', async () => {
    const t = make('ctl-recover')
    await t.c.init()
    t.ps.scripts.length = 0
    const r = await t.c.recoverInternet()
    expect(r.ok).toBe(true)
    expect(r.message).toContain('Готово')
    expect(t.ps.scripts.some((s) => s.kind === 'disarm')).toBe(true) // принудительно, а не «если помним, что включали»
    expect(t.proxy.calls).toContain('clear')
    await t.c.shutdown()
  })

  it('в сведениях о системе видно, что защита включена; выключение защиты её снимает', async () => {
    const t = make('ctl-state')
    await t.c.init()
    expect(t.c.getStateSync().system.killSwitchActive).toBe(false)
    const ks = (t.c as unknown as { killSwitch: KillSwitch }).killSwitch
    await ks.arm('C:\\a.exe')
    expect(t.c.getStateSync().system.killSwitchActive).toBe(true)
    await t.c.updateSettings({ killSwitch: true })
    await t.c.updateSettings({ killSwitch: false }) // выключили, пока VPN не работает — защита снимается сразу
    expect(t.c.getStateSync().system.killSwitchActive).toBe(false)
    await t.c.shutdown()
  })

  it('после аварийного завершения при следующем запуске защита снимается сама', async () => {
    const t = make('ctl-crash')
    ;(t.c as unknown as { killSwitch: KillSwitch }).killSwitch // создаём
    await ((t.c as unknown as { killSwitch: KillSwitch }).killSwitch).arm('C:\\a.exe')
    t.c.store.flush()
    const again = make('ctl-crash') // «новый запуск» в той же папке данных
    await again.c.init()
    expect(again.ps.scripts.some((s) => s.kind === 'disarm')).toBe(true)
    expect(again.c.getStateSync().system.killSwitchActive).toBe(false)
    await again.c.shutdown()
    await t.c.shutdown()
  })
})

// =====================================================================================================================
// Значок в трее
// =====================================================================================================================

const conn = (over: Partial<ConnState> = {}): ConnState => ({ ...initialConnState(), ...over })
const noActions = { toggle: () => undefined, showWindow: () => undefined, quit: () => undefined }

describe('значок в трее: что он показывает', () => {
  it('иконка по состоянию: выключено, подключаюсь, работает, ошибка; «нет связи с сервером» и «интернет закрыт защитой» — тревожные', () => {
    expect(trayStatusOf(conn())).toBe('off')
    expect(trayStatusOf(conn({ status: 'disconnecting' }))).toBe('off')
    expect(trayStatusOf(conn({ status: 'connecting' }))).toBe('connecting')
    expect(trayStatusOf(conn({ status: 'on' }))).toBe('on')
    expect(trayStatusOf(conn({ status: 'on', degraded: true }))).toBe('error')
    expect(trayStatusOf(conn({ status: 'error' }))).toBe('error')
    expect(trayStatusOf(conn({ status: 'connecting', blocked: true, reconnect: { attempt: 1, nextInMs: 1000 } }))).toBe('error')
  })

  it('подсказка при наведении простыми словами, с названием сервера только когда он важен', () => {
    expect(trayTooltip('Тропа', conn(), 'Нидерланды')).toBe('Тропа: выключено')
    expect(trayTooltip('Тропа', conn({ status: 'on' }), 'Нидерланды')).toBe('Тропа: работает · Нидерланды')
    expect(trayTooltip('Тропа', conn({ status: 'error', blocked: true }), 'Нидерланды')).toBe('Тропа: интернет закрыт защитой')
    expect(statusWords(conn({ status: 'connecting', reconnect: { attempt: 2, nextInMs: 1 } }))).toContain('подключаюсь снова')
  })

  it('меню: включить / выключить / отменить; без ключей — ведёт в окно; во время отключения пункт недоступен', () => {
    const labels = (items: TrayMenuItem[]): string[] => items.map((i) => i.label ?? '—')
    expect(labels(buildTrayMenu('Тропа', conn(), 'A', true, noActions))).toEqual(['Тропа: выключено', '—', 'Включить VPN', 'Открыть окно', '—', 'Выйти'])
    expect(labels(buildTrayMenu('Тропа', conn({ status: 'on' }), 'A', true, noActions))[2]).toBe('Выключить VPN')
    expect(labels(buildTrayMenu('Тропа', conn({ status: 'connecting' }), 'A', true, noActions))[2]).toBe('Отменить подключение')
    expect(labels(buildTrayMenu('Тропа', conn(), null, false, noActions))[2]).toBe('Сначала добавьте ключ…')
    const busy = buildTrayMenu('Тропа', conn({ status: 'disconnecting' }), 'A', true, noActions)
    expect(busy[2]!.enabled).toBe(false)
    expect(busy[0]!.enabled).toBe(false) // строка-заголовок не нажимается
  })

  it('пункты меню вызывают нужные действия', () => {
    const calls: string[] = []
    const items = buildTrayMenu('Тропа', conn(), 'A', true, { toggle: () => calls.push('toggle'), showWindow: () => calls.push('show'), quit: () => calls.push('quit') })
    for (const it of items) it.click?.()
    expect(calls).toEqual(['toggle', 'show', 'quit'])
  })
})

describe('значок в трее: управление', () => {
  function make(over: { failCreate?: boolean; visible?: boolean } = {}) {
    const log: string[] = []
    const handlers: Record<string, () => void> = {}
    let visible = over.visible ?? true
    const tray: TrayLike = {
      setToolTip: (t) => log.push(`tip:${t}`),
      setImage: (img) => log.push(`img:${String(img).split(/[\\/]/).pop()}`),
      setContextMenu: () => log.push('menu'),
      on: (e, cb) => { handlers[e] = cb },
      destroy: () => log.push('destroy')
    }
    const deps: TrayDeps = {
      createTray: (icon) => { if (over.failCreate) throw new Error('нет области уведомлений'); log.push(`create:${String(icon).split(/[\\/]/).pop()}`); return tray },
      createMenu: (items) => items,
      loadIcon: (p) => p,
      iconDir: '/tray',
      name: 'Тропа',
      actions: { toggle: () => undefined, showWindow: () => { visible = true; log.push('show') }, quit: () => undefined },
      isWindowVisible: () => visible,
      hideWindow: () => { visible = false; log.push('hide') }
    }
    return { tc: new TrayController(deps), log, handlers }
  }

  it('создаётся с иконкой текущего состояния; иконка меняется только когда состояние изменилось; меню пересобирается только по делу', () => {
    const { tc, log } = make()
    expect(tc.create(conn(), null, true)).toBe(true)
    expect(tc.ready).toBe(true)
    expect(log[0]).toBe('create:off.png')
    log.length = 0
    tc.update(conn(), null, true) // ничего не изменилось
    expect(log.filter((l) => l.startsWith('img') || l === 'menu')).toEqual([])
    tc.update(conn({ status: 'on' }), 'Нидерланды', true)
    expect(log).toContain('img:on.png')
    expect(log).toContain('menu')
    expect(log).toContain('tip:Тропа: работает · Нидерланды')
    log.length = 0
    tc.update(conn({ status: 'on', degraded: true }), 'Нидерланды', true)
    expect(log).toContain('img:error.png')
    tc.destroy()
    expect(tc.ready).toBe(false)
    expect(log).toContain('destroy')
  })

  it('щелчок по значку: окно видно — прячется, скрыто — показывается; двойной щелчок всегда показывает', () => {
    const { tc, log, handlers } = make({ visible: true })
    tc.create(conn(), null, true)
    log.length = 0
    handlers['click']!()
    expect(log).toEqual(['hide'])
    handlers['click']!()
    expect(log).toEqual(['hide', 'show'])
    handlers['double-click']!()
    expect(log[log.length - 1]).toBe('show')
  })

  it('системе не удалось показать значок: об этом честно сообщается (окно тогда закрывается обычным образом)', () => {
    const { tc } = make({ failCreate: true })
    expect(tc.create(conn(), null, true)).toBe(false)
    expect(tc.ready).toBe(false)
    expect(() => tc.update(conn({ status: 'on' }), 'A', true)).not.toThrow()
  })
})

describe('запуск свёрнутым при перезапуске с правами', () => {
  it('записка читается один раз; забытая старая записка игнорируется', () => {
    const d = tempDir('tropa-hidden-')
    expect(consumeHiddenStart(d)).toBe(false) // записки нет
    markHiddenStart(d)
    expect(consumeHiddenStart(d)).toBe(true)
    expect(consumeHiddenStart(d)).toBe(false) // уже прочитана и удалена
    markHiddenStart(d)
    const old = new Date(Date.now() - 10 * 60_000)
    utimesSync(join(d, 'start-hidden'), old, old) // «лежит десять минут» — например, после аварии
    expect(consumeHiddenStart(d)).toBe(false)
    expect(existsSync(join(d, 'start-hidden'))).toBe(false) // и всё равно убрана
    removeDir(d)
  })
})

// =====================================================================================================================
// Автозапуск и подключение при запуске
// =====================================================================================================================

describe('автозапуск с Windows', () => {
  const make = (name: string, hostOver: Parameters<typeof fakeHost>[0] = {}) => {
    const fh = fakeHost(hostOver)
    const toasts: string[] = []
    const c = new AppController(fh.host, { userDir: join(dir, name), engineExe: singBoxPath(), bundledRulesDir: join(__dirname, '..', 'resources', 'rules') }, sealer, { ruleFetch: async () => Buffer.alloc(0), systemProxy: new FakeProxy() })
    c.onToast((t) => toasts.push(t.text))
    return { c, fh, toasts }
  }

  it('включение и выключение доходят до системы и запоминаются в настройках', async () => {
    const { c, fh } = make('auto-1')
    await c.init()
    await c.updateSettings({ autostart: true })
    expect(fh.state.actions).toContain('autostart true')
    expect(c.store.settings.autostart).toBe(true)
    await c.updateSettings({ autostart: false })
    expect(fh.state.actions).toContain('autostart false')
    expect(c.store.settings.autostart).toBe(false)
    await c.shutdown()
  })

  it('система отказала: выключатель возвращается в прежнее положение, человеку объясняют', async () => {
    const { c, toasts } = make('auto-2', { autostartWorks: false })
    await c.init()
    await c.updateSettings({ autostart: true })
    expect(c.store.settings.autostart).toBe(false)
    expect(toasts.join(' ')).toContain('Не удалось включить автозапуск')
    await c.shutdown()
  })

  it('автозапуск «слетел» (например, переустановили программу): при запуске включается заново', async () => {
    const first = make('auto-3')
    await first.c.init()
    await first.c.updateSettings({ autostart: true })
    first.c.store.flush()
    const second = make('auto-3', { autostart: false }) // «новая установка»: в системе записи нет, а в настройках автозапуск включён
    await second.c.init()
    expect(second.fh.state.actions).toContain('autostart true')
    expect(second.fh.state.autostart).toBe(true)
    await second.c.shutdown()
    await first.c.shutdown()
  })

  it('в сведениях о системе видно, что запуск был свёрнутым', async () => {
    const { c } = make('auto-4', { startedHidden: true })
    await c.init()
    expect(c.getStateSync().system.startedHidden).toBe(true)
    await c.shutdown()
  })
})

describe('подключение при запуске программы', () => {
  const make = (name: string, settings: Partial<Settings>) => {
    const fh = fakeHost()
    const c = new AppController(fh.host, { userDir: join(dir, name), engineExe: singBoxPath(), bundledRulesDir: join(__dirname, '..', 'resources', 'rules') }, sealer, { ruleFetch: async () => Buffer.alloc(0), systemProxy: new FakeProxy(), probeUrls: ['http://cp.cloudflare.com/generate_204'] })
    c.store.updateSettings(settings)
    return c
  }
  /** Подменяем подключение: первые n попыток заканчиваются ошибкой с этим кодом, потом — успех. */
  function scripted(c: AppController, failures: Array<string | null>): { attempts: () => number } {
    let n = 0
    ;(c.conn as unknown as { connect: () => Promise<void> }).connect = async () => {
      const code = failures[n++]
      c.conn.state = code === undefined || code === null
        ? { ...c.conn.state, status: 'on', error: null }
        : { ...c.conn.state, status: 'error', error: { code, title: 'x', text: 'y' } }
    }
    return { attempts: () => n }
  }

  it('включено и есть выбранный сервер: подключается по-настоящему', async () => {
    const c = make('acl-real', {})
    const key = `ss://${b64('aes-256-gcm:pw')}@127.0.0.1:${serverPort}#Тест`
    await c.init()
    await c.addKeyText(key)
    await c.updateSettings({ connectOnLaunch: true })
    await c.autoConnectOnLaunch([50])
    expect(c.conn.state.status).toBe('on')
    await c.shutdown()
  }, 60000)

  it('выключено, нет сервера или сервер удалён — ничего не происходит', async () => {
    const off = make('acl-off', { connectOnLaunch: false, selectedServerId: 'x' })
    const s1 = scripted(off, [null])
    await off.autoConnectOnLaunch([1])
    expect(s1.attempts()).toBe(0)
    const none = make('acl-none', { connectOnLaunch: true, selectedServerId: null })
    const s2 = scripted(none, [null])
    await none.autoConnectOnLaunch([1])
    expect(s2.attempts()).toBe(0)
    const gone = make('acl-gone', { connectOnLaunch: true, selectedServerId: 'нет-такого' })
    const s3 = scripted(gone, [null])
    await gone.autoConnectOnLaunch([1])
    expect(s3.attempts()).toBe(0)
  })

  async function withServer(name: string): Promise<AppController> {
    const c = make(name, {})
    await c.init()
    await c.addKeyText(`ss://${b64('aes-256-gcm:pw')}@127.0.0.1:${serverPort}#Тест`)
    await c.updateSettings({ connectOnLaunch: true })
    return c
  }

  it('сети ещё нет (Windows только загрузилась): пробует несколько раз, пока не получится', async () => {
    const c = await withServer('acl-retry')
    const s = scripted(c, ['offline', 'server-silent', null])
    await c.autoConnectOnLaunch([1, 1, 1, 1])
    expect(s.attempts()).toBe(3)
    expect(c.conn.state.status).toBe('on')
    await c.shutdown()
  })

  it('причина не сетевая (нет прав, неверный ключ): повторять бессмысленно — одна попытка', async () => {
    const c = await withServer('acl-noretry')
    const s = scripted(c, ['need-admin', null])
    await c.autoConnectOnLaunch([1, 1, 1])
    expect(s.attempts()).toBe(1)
    expect(c.conn.state.status).toBe('error')
    await c.shutdown()
  })

  it('число попыток ограничено', async () => {
    const c = await withServer('acl-limit')
    const s = scripted(c, ['offline', 'offline', 'offline', 'offline', 'offline', null])
    await c.autoConnectOnLaunch([1, 1, 1])
    expect(s.attempts()).toBe(3)
    await c.shutdown()
  })

  it('человек сам нажал кнопку, пока программа ждала, — автоподключение отступает и не мешает', async () => {
    const c = await withServer('acl-user')
    const s = scripted(c, ['offline', null])
    const run = c.autoConnectOnLaunch([40, 40])
    await c.disconnect() // человек взял управление на себя
    await run
    expect(s.attempts()).toBe(0)
  })
})

// =====================================================================================================================
// «Для специалиста»
// =====================================================================================================================

import { checkAdvanced, MTU_RANGE, PORT_RANGE } from '../shared/advanced'
import { readFileSync } from 'node:fs'

describe('«Для специалиста»: проверка значений', () => {
  const cur = DEFAULT_SETTINGS.advanced

  it('верные значения принимаются, остальные поля не меняются', () => {
    const r = checkAdvanced({ mtu: 1400, mixedPort: 8080, dnsRemote: 'tls://dns.google', dnsDirect: '77.88.8.8', tunStack: 'gvisor', logLevel: 'debug', multiplex: true, tunIpv6: true, strictRoute: false }, cur)
    expect(r.problems).toEqual([])
    expect(r.value).toMatchObject({ mtu: 1400, mixedPort: 8080, dnsRemote: 'tls://dns.google', dnsDirect: '77.88.8.8', tunStack: 'gvisor', logLevel: 'debug', multiplex: true, tunIpv6: true, strictRoute: false })
    expect(checkAdvanced({ mtu: 1500 }, cur).value.mixedPort).toBe(cur.mixedPort)
  })

  it.each([
    [{ mtu: 100 }, 'MTU'],
    [{ mtu: 99999 }, 'MTU'],
    [{ mtu: 1500.5 }, 'MTU'],
    [{ mtu: NaN }, 'MTU'],
    [{ mixedPort: 80 }, 'Порт'],
    [{ mixedPort: 70000 }, 'Порт'],
    [{ dnsRemote: '' }, 'DNS для запросов через VPN'],
    [{ dnsRemote: 'system' }, 'DNS для запросов через VPN'], // «как в системе» для удалённого DNS не имеет смысла: запрос должен уйти через VPN
    [{ dnsRemote: 'не адрес!!' }, 'DNS для запросов через VPN'],
    [{ dnsDirect: 'мусор мусор' }, 'DNS для прямых запросов'],
    [{ tunStack: 'wat' as never }, 'стек'],
    [{ logLevel: 'всё' as never }, 'журнала'],
    [{ multiplex: 'да' as never }, 'Выключатель']
  ])('неверное значение %j не принимается, значение остаётся прежним, причина — по-русски', (patch, word) => {
    const r = checkAdvanced(patch, cur)
    expect(r.value).toEqual(cur)
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0]).toContain(word)
  })

  it('границы допустимого включены; «local» приводится к «system»', () => {
    expect(checkAdvanced({ mtu: MTU_RANGE[0], mixedPort: PORT_RANGE[0] }, cur).problems).toEqual([])
    expect(checkAdvanced({ mtu: MTU_RANGE[1], mixedPort: PORT_RANGE[1] }, cur).problems).toEqual([])
    expect(checkAdvanced({ dnsDirect: 'local' }, cur).value.dnsDirect).toBe('system')
  })

  it('частично верное сообщение: верное применяется, неверное — нет', () => {
    const r = checkAdvanced({ mtu: 1280, mixedPort: 1 }, cur)
    expect(r.value.mtu).toBe(1280)
    expect(r.value.mixedPort).toBe(cur.mixedPort)
    expect(r.problems).toHaveLength(1)
  })
})

describe('«Для специалиста»: контроллер', () => {
  const make = (name: string) => {
    const fh = fakeHost()
    const toasts: string[] = []
    const c = new AppController(fh.host, { userDir: join(dir, name), engineExe: singBoxPath(), bundledRulesDir: join(__dirname, '..', 'resources', 'rules') }, sealer, { ruleFetch: async () => Buffer.alloc(0), systemProxy: new FakeProxy(), probeUrls: ['http://cp.cloudflare.com/generate_204'] })
    c.onToast((t) => toasts.push(t.text))
    return { c, fh, toasts }
  }
  const SECRET_UUID = 'e9a5d2ee-9d2d-4747-8686-86bc19445dc5'

  it('неверное значение не сохраняется и объясняется всплывающим сообщением; верное — сохраняется', async () => {
    const { c, toasts } = make('exp-1')
    await c.init()
    await c.updateAdvanced({ mtu: 5, dnsRemote: 'https://dns.google/dns-query' })
    expect(c.store.settings.advanced.mtu).toBe(9000)
    expect(c.store.settings.advanced.dnsRemote).toBe('https://dns.google/dns-query')
    expect(toasts.join(' ')).toContain('MTU')
    await c.resetAdvanced()
    expect(c.store.settings.advanced).toEqual(DEFAULT_SETTINGS.advanced)
    await c.shutdown()
  })

  it('итоговые настройки показываются без секретов и отражают текущие настройки; без сервера — null', async () => {
    const { c } = make('exp-2')
    await c.init()
    expect(await c.getConfigPreview()).toBeNull()
    await c.addKeyText(`vless://${SECRET_UUID}@nl.example.com:443?encryption=none&security=tls&sni=nl.example.com&type=ws&path=%2Fw#NL`)
    await c.updateAdvanced({ mixedPort: 8123, logLevel: 'debug' })
    const p = (await c.getConfigPreview())!
    expect(p.json).not.toContain(SECRET_UUID)
    expect(p.json).toContain('••••')
    expect(p.json).toContain('"listen_port": 8123')
    expect(p.json).toContain('"level": "debug"')
    expect(p.json).toContain('nl.example.com') // адрес сервера не секрет — специалисту он нужен
    expect(p.note).toContain('Секреты скрыты')
    JSON.parse(p.json) // это настоящий JSON
    await c.shutdown()
  })

  it('«Журнал» не содержит ни ключей, ни паролей, а очистка работает', async () => {
    const { c } = make('exp-3')
    await c.init()
    await c.addKeyText(`vless://${SECRET_UUID}@nl.example.com:443?encryption=none&type=tcp#NL`)
    c.log.add(`пробую vless://${SECRET_UUID}@nl.example.com:443?x=1 password=hunter2 uuid ${SECRET_UUID}`)
    const lines = await c.getLogs()
    expect(lines.length).toBeGreaterThan(0)
    const all = lines.join('\n')
    expect(all).not.toContain(SECRET_UUID)
    expect(all).not.toContain('hunter2')
    await c.clearLogs()
    expect(await c.getLogs()).toEqual([])
    await c.shutdown()
  })

  it('копирование в буфер доходит до системы', async () => {
    const { c, fh } = make('exp-4')
    await c.copyText('привет')
    expect(fh.state.clipboardWrites).toEqual(['привет'])
  })

  it('работающее подключение: показываются настоящие настройки с реальным портом', async () => {
    const { c } = make('exp-5')
    await c.init()
    await c.addKeyText(`ss://${b64('aes-256-gcm:pw')}@127.0.0.1:${serverPort}#Тест`)
    await c.connect()
    expect(c.conn.state.status).toBe('on')
    const p = (await c.getConfigPreview())!
    expect(p.note).toContain('работающего подключения')
    expect(p.json).toContain(`"listen_port": ${c.conn.proxyPort}`)
    expect(p.json).not.toContain('"pw"')
    await c.shutdown()
  }, 60000)

  it('смена сервера при включённом VPN переподключает на НОВЫЙ сервер (а не на прежний)', async () => {
    const { c } = make('exp-7')
    await c.init()
    await c.addKeyText(`ss://${b64('aes-256-gcm:pw')}@127.0.0.1:${serverPort}#Первый`)
    await c.addKeyText(`ss://${b64('aes-256-gcm:pw')}@localhost:${serverPort}#Второй`) // тот же сервер под другим адресом
    const [first, second] = c.getStateSync().servers
    await c.selectServer(first!.id)
    await c.connect()
    expect(c.conn.state.serverId).toBe(first!.id)
    await c.selectServer(second!.id)
    await waitFor(() => c.conn.state.status === 'on' && c.conn.state.serverId === second!.id, 20000, 'переподключение на второй сервер')
    await c.shutdown()
  }, 60000)

  it('смена расширенных настроек при включённом VPN переподключает его (порт новый)', async () => {
    const { c } = make('exp-6')
    await c.init()
    await c.addKeyText(`ss://${b64('aes-256-gcm:pw')}@127.0.0.1:${serverPort}#Тест`)
    await c.connect()
    expect(c.conn.state.status).toBe('on')
    const newPort = await freePort()
    await c.updateAdvanced({ mixedPort: newPort })
    await waitFor(() => c.conn.state.status === 'on' && c.conn.proxyPort === newPort, 20000, 'переподключение на новый порт')
    await c.shutdown()
  }, 60000)
})
