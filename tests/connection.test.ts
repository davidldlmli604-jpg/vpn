// Жизненный цикл подключения на настоящем движке: подключение, скорость, обрыв, переподключение, отключение.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RULESETS, parseInput } from '../core'
import type { RuleSetFile } from '../core'
import { ConnectionManager, type ConnectionDeps, type ConnectionEvent } from '../electron/engine/connection'
import type { SystemProxy } from '../electron/platform/systemProxy'
import { DEFAULT_SETTINGS } from '../shared/defaults'
import type { ConnState, Settings, StatsSample } from '../shared/types'
import { Box, freePort, httpViaProxy, removeDir, startTarget, tempDir } from './helpers/loopback'
import { RULES_DIR, singBoxPath } from './helpers/singbox'

const REPLY = 'ответ-через-менеджер'
const b64 = (s: string): string => Buffer.from(s).toString('base64')

let dir: string
let httpTarget: { port: number; close: () => Promise<void> }
let server: Box
let serverPort: number

const bundled: RuleSetFile[] = RULESETS.sets.map((s) => ({ tag: s.file.replace(/\.srs$/, ''), path: join(RULES_DIR, s.file), role: s.role as RuleSetFile['role'] }))

beforeAll(async () => {
  dir = tempDir('tropa-conn-')
  httpTarget = await startTarget(REPLY)
  serverPort = await freePort()
  server = new Box('server', {
    log: { level: 'info' },
    inbounds: [{ type: 'shadowsocks', tag: 'in', listen: '127.0.0.1', listen_port: serverPort, method: 'aes-256-gcm', password: 'pw' }],
    outbounds: [{ type: 'direct', tag: 'direct' }],
    route: {
      // любой запрос клиента (включая проверку связи) попадает на наш локальный «интернет»
      rules: [{ action: 'route', outbound: 'direct', override_address: '127.0.0.1', override_port: httpTarget.port }],
      final: 'direct'
    }
  }, dir)
  await server.start()
}, 60000)

afterAll(async () => {
  await server?.stop()
  await httpTarget?.close()
  if (dir) removeDir(dir)
})

class FakeProxy implements SystemProxy {
  supported = true
  calls: string[] = []
  async set(_h: string, port: number): Promise<void> { this.calls.push(`set:${port}`) }
  async clear(): Promise<void> { this.calls.push('clear') }
  async pointsTo(): Promise<boolean> { return false }
}

function setup(over: { settings?: Partial<Settings>; password?: string; deps?: Partial<ConnectionDeps>; timing?: ConnectionDeps['timing']; primaryRules?: RuleSetFile[] } = {}) {
  const key = `ss://${b64(`aes-256-gcm:${over.password ?? 'pw'}`)}@127.0.0.1:${serverPort}#Тест`
  const parsed = parseInput(key)
  if (parsed.kind !== 'servers') throw new Error('ключ не разобрался')
  const settings: Settings = { ...DEFAULT_SETTINGS, ...(over.settings ?? {}), selectedServerId: 's1' }
  const proxy = new FakeProxy()
  const events: ConnectionEvent[] = []
  const logs: string[] = []
  const states: ConnState[] = []
  const stats: StatsSample[] = []
  const workDir = join(dir, 'work-' + Math.random().toString(36).slice(2, 8))
  mkdirSync(workDir, { recursive: true })
  const deps: ConnectionDeps = {
    engineExe: singBoxPath(),
    workDir,
    getSettings: () => settings,
    getServerName: () => 'Тест',
    getSecret: (id) => (id === 's1' ? { outbound: parsed.servers[0]!.outbound, rawLink: key } : null),
    ruleSets: () => ({ primary: over.primaryRules ?? bundled, fallback: bundled }),
    systemProxy: proxy,
    killSwitch: null,
    isAdmin: async () => true,
    platform: process.platform,
    log: (l) => logs.push(l),
    onEvent: (e) => events.push(e),
    probeUrls: ['http://cp.cloudflare.com/generate_204'],
    timing: { probeTimeoutMs: 3000, firstProbeAttempts: 2, statsIntervalMs: 200, healthIntervalMs: 60000, backoffMs: [200, 400], ...(over.timing ?? {}) },
    ...(over.deps ?? {})
  }
  const mgr = new ConnectionManager(deps)
  mgr.onState = (s) => states.push(s)
  mgr.onStats = (s) => stats.push(s)
  return { mgr, proxy, events, logs, states, stats, settings, workDir }
}

async function waitFor(cond: () => boolean, ms = 15000, what = 'условие'): Promise<void> {
  const t = Date.now()
  while (Date.now() - t < ms) {
    if (cond()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`не дождались: ${what}`)
}

describe('ConnectionManager на настоящем движке', () => {
  it('подключается, считает скорость и задержку, отключается и убирает за собой', async () => {
    const { mgr, proxy, events, states, stats, workDir } = setup()
    await mgr.connect('s1')
    expect(mgr.state.status).toBe('on')
    expect(mgr.state.error).toBeNull()
    expect(mgr.state.serverId).toBe('s1')
    expect(mgr.state.mode).toBe('proxy')
    expect(states.map((s) => s.status)).toEqual(['connecting', 'on'])
    expect(proxy.calls).toEqual([`set:${mgr.proxyPort}`])
    expect(events).toEqual([{ type: 'connected', serverName: 'Тест' }])

    // реальный трафик через поднятый движок
    const r = await httpViaProxy(mgr.proxyPort, 'http://203.0.113.7:8080/')
    expect(r.body).toBe(REPLY)

    await waitFor(() => stats.length >= 2, 8000, 'выборки скорости')
    const last = stats[stats.length - 1]!
    expect(last.downTotal).toBeGreaterThan(0)
    expect(last.latencyMs).toBeGreaterThanOrEqual(0)
    expect(existsSync(join(workDir, 'config.json'))).toBe(true)
    expect(mgr.redactedConfig()).toContain('••••')
    expect(mgr.redactedConfig()).not.toContain('"pw"')

    await mgr.disconnect()
    expect(mgr.state.status).toBe('off')
    expect(mgr.isRunning).toBe(false)
    expect(proxy.calls[proxy.calls.length - 1]).toBe('clear')
    expect(existsSync(join(workDir, 'config.json'))).toBe(false)
    expect(events[events.length - 1]).toEqual({ type: 'disconnected' })
  }, 60000)

  it('неверный ключ → понятная ошибка, а не «подключено»', async () => {
    const { mgr, proxy } = setup({ password: 'НЕВЕРНЫЙ', timing: { probeTimeoutMs: 1500, firstProbeAttempts: 2 } })
    await mgr.connect('s1')
    await waitFor(() => mgr.state.status === 'error', 20000, 'ошибка')
    expect(mgr.state.error?.title).toBe('Сервер не отвечает')
    expect(mgr.state.error?.text).toContain('ключ')
    expect(mgr.isRunning).toBe(false)
    expect(proxy.calls[proxy.calls.length - 1]).toBe('clear') // системный прокси не остался включённым
  }, 60000)

  it('обрыв движка → само переподключается', async () => {
    const { mgr, events } = setup({ settings: { autoReconnect: true } })
    await mgr.connect('s1')
    expect(mgr.state.status).toBe('on')
    const oldPort = mgr.proxyPort
    const pid = (mgr as unknown as { proc: { pid: number } }).proc.pid
    process.kill(pid, 'SIGKILL')
    await waitFor(() => mgr.state.status === 'connecting' && mgr.state.reconnect !== null, 8000, 'режим переподключения')
    expect(mgr.state.reconnect!.attempt).toBe(1)
    await waitFor(() => mgr.state.status === 'on', 20000, 'возврат подключения')
    expect(mgr.state.reconnect).toBeNull()
    expect(events.map((e) => e.type)).toEqual(['connected', 'lost', 'reconnected'])
    const r = await httpViaProxy(mgr.proxyPort, 'http://203.0.113.7:8080/')
    expect(r.body).toBe(REPLY)
    void oldPort
    await mgr.disconnect()
  }, 90000)

  it('обрыв без автопереподключения → ошибка простыми словами', async () => {
    const { mgr } = setup({ settings: { autoReconnect: false } })
    await mgr.connect('s1')
    process.kill((mgr as unknown as { proc: { pid: number } }).proc.pid, 'SIGKILL')
    await waitFor(() => mgr.state.status === 'error', 10000, 'ошибка после обрыва')
    expect(mgr.state.error?.title).toBe('Подключение оборвалось')
  }, 60000)

  it('отключение во время ожидания переподключения останавливает попытки', async () => {
    const { mgr } = setup({ settings: { autoReconnect: true }, timing: { backoffMs: [3000] } })
    await mgr.connect('s1')
    process.kill((mgr as unknown as { proc: { pid: number } }).proc.pid, 'SIGKILL')
    await waitFor(() => mgr.state.reconnect !== null, 8000, 'ожидание переподключения')
    await mgr.disconnect()
    expect(mgr.state.status).toBe('off')
    await new Promise((r) => setTimeout(r, 3500))
    expect(mgr.state.status).toBe('off')
    expect(mgr.isRunning).toBe(false)
  }, 60000)

  it('режим «весь компьютер» без прав администратора → просьба о разрешении', async () => {
    const { mgr } = setup({ settings: { mode: 'tun' }, deps: { isAdmin: async () => false } })
    await mgr.connect('s1')
    expect(mgr.state.status).toBe('error')
    expect(mgr.state.error?.code).toBe('need-admin')
    expect(mgr.state.error?.text).toContain('администратор')
  })

  it('нет движка → понятная ошибка', async () => {
    const { mgr } = setup({ deps: { engineExe: join(dir, 'нет-такого.exe') } })
    await mgr.connect('s1')
    expect(mgr.state.error?.code).toBe('engine-missing')
  })

  it('нет ключа → «сначала добавьте ключ»', async () => {
    const { mgr } = setup()
    await mgr.connect('нет-такого-id')
    expect(mgr.state.status).toBe('error')
    expect(mgr.state.error?.code).toBe('no-server')
  })

  it('испорченный скачанный набор правил → берутся вшитые', async () => {
    const broken = join(dir, 'broken.srs')
    writeFileSync(broken, 'это не набор правил')
    const bad: RuleSetFile[] = bundled.map((s, i) => (i === 0 ? { ...s, path: broken } : s))
    const { mgr, logs } = setup({ primaryRules: bad })
    await mgr.connect('s1')
    expect(mgr.state.status).toBe('on')
    expect(logs.join('\n')).toContain('вшитые')
    await mgr.disconnect()
  }, 60000)

  it('повторное «подключить» во время работы ничего не ломает', async () => {
    const { mgr } = setup()
    await mgr.connect('s1')
    const port = mgr.proxyPort
    await mgr.connect('s1')
    expect(mgr.proxyPort).toBe(port)
    await mgr.disconnect()
  }, 60000)
})
