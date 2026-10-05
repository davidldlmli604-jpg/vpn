// Правила маршрутизации «вживую»: куда реально уходит каждое соединение — в VPN или напрямую.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { basename, join } from 'node:path'
import { buildSingBoxConfig, parseInput, RULESETS } from '../core'
import type { BuildOptions, RuleSetFile } from '../core'
import { Box, freePort, httpViaProxy, removeDir, startTarget, tempDir } from './helpers/loopback'
import { RULES_DIR } from './helpers/singbox'

const ruleSets: RuleSetFile[] = RULESETS.sets.map((s) => ({ tag: s.file.replace(/\.srs$/, ''), path: join(RULES_DIR, s.file), role: s.role as RuleSetFile['role'] }))
const b64url = (s: string): string => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const REPLY = 'через-туннель'

let dir: string
let target: { port: number; close: () => Promise<void> }
let server: Box
let serverPort: number

beforeAll(async () => {
  dir = tempDir()
  target = await startTarget(REPLY)
  serverPort = await freePort()
  server = new Box('server', {
    log: { level: 'info' },
    inbounds: [{ type: 'shadowsocks', tag: 'in', listen: '127.0.0.1', listen_port: serverPort, method: 'aes-256-gcm', password: 'pw' }],
    outbounds: [{ type: 'direct', tag: 'direct' }],
    route: { rules: [{ action: 'route-options', override_address: '127.0.0.1', override_port: target.port }], final: 'direct' }
  }, dir)
  await server.start()
}, 60000)

afterAll(async () => {
  await server?.stop()
  await target?.close()
  if (dir) removeDir(dir)
})

async function withClient(over: Partial<BuildOptions>, key = `ss://${b64url('aes-256-gcm:pw')}@127.0.0.1:{PORT}#t`): Promise<{ port: number; box: Box }> {
  const parsed = parseInput(key.replace('{PORT}', String(serverPort)))
  if (parsed.kind !== 'servers') throw new Error('ключ не разобрался')
  const port = await freePort()
  const box = new Box(`client-${Math.random().toString(36).slice(2, 8)}`, buildSingBoxConfig({
    outbound: parsed.servers[0]!.outbound, mode: 'proxy', mixedPort: port, clashPort: await freePort(), clashSecret: 's',
    bypassRu: true, ruleSets, bypassProcesses: [], alwaysVpn: [], alwaysDirect: [], dns: { leakProtection: true }, logLevel: 'debug', ...over
  }), dir)
  await box.start()
  return { port, box }
}

/** Куда ушло соединение с этим адресом: разбираем журнал отладки. */
function routeOf(log: string, host: string): 'proxy' | 'direct' | 'reject' | 'нет в журнале' {
  const line = log.split('\n').filter((l) => l.includes(host)).join('\n')
  if (/outbound\/direct\[direct\]/.test(line) || /route\(direct\)/.test(line)) return 'direct'
  if (/outbound\/shadowsocks\[proxy\]/.test(line) || /route\(proxy\)/.test(line)) return 'proxy'
  if (/reject/.test(line)) return 'reject'
  return 'нет в журнале'
}

export function failWithLog(e: unknown, box: Box): never {
  throw new Error(`${(e as Error).message}\n--- журнал клиента ---\n${box.log.replace(/\x1b\[[0-9;]*m/g, '').slice(-3500)}`)
}

async function tryGet(port: number, url: string): Promise<void> {
  try { await httpViaProxy(port, url, 3000) } catch { /* напрямую в песочнице до этих адресов не достучаться — важно только решение маршрута */ }
}

describe('неверный пароль не пропускает (проверка самого теста)', () => {
  it('с неправильным паролем ответа из «интернета» нет', async () => {
    const { port, box } = await withClient({}, `ss://${b64url('aes-256-gcm:НЕВЕРНЫЙ')}@127.0.0.1:{PORT}#bad`)
    try {
      const r = await httpViaProxy(port, 'http://203.0.113.7:8080/', 4000).catch(() => ({ status: 0, body: '' }))
      expect(r.body).not.toBe(REPLY)
    } finally { await box.stop() }
  }, 30000)
})

describe('куда уходит трафик', () => {
  it('российские зоны .ru, .рф, .su — напрямую; остальное — в VPN', async () => {
    const { port, box } = await withClient({})
    try {
      await tryGet(port, 'http://example-shop.ru:8080/')
      await tryGet(port, 'http://xn--e1afmkfd.xn--p1ai:8080/') // пример.рф
      await tryGet(port, 'http://old-site.su:8080/')
      const foreign = await httpViaProxy(port, 'http://foreign-site.example.org:8080/')
      expect(foreign.body).toBe(REPLY) // иностранный сайт пошёл через сервер
      expect(routeOf(box.log, 'example-shop.ru')).toBe('direct')
      expect(routeOf(box.log, 'xn--e1afmkfd.xn--p1ai')).toBe('direct')
      expect(routeOf(box.log, 'old-site.su')).toBe('direct')
      expect(routeOf(box.log, 'foreign-site.example.org')).toBe('proxy')
    } catch (e) { failWithLog(e, box) } finally { await box.stop() }
  }, 40000)

  it('готовые наборы: Яндекс и ВК — напрямую, даже не в зоне .ru', async () => {
    const { port, box } = await withClient({})
    try {
      await tryGet(port, 'http://yastatic.net:8080/')
      await tryGet(port, 'http://vk.com:8080/')
      await tryGet(port, 'http://userapi.com:8080/')
      expect(routeOf(box.log, 'yastatic.net')).toBe('direct')
      expect(routeOf(box.log, 'vk.com')).toBe('direct')
      expect(routeOf(box.log, 'userapi.com')).toBe('direct')
    } finally { await box.stop() }
  }, 40000)

  it('заблокированные в России СМИ идут через VPN, даже если домен .ru', async () => {
    const { port, box } = await withClient({})
    try {
      await tryGet(port, 'http://meduza.io:8080/')
      await tryGet(port, 'http://theins.ru:8080/')
      expect(routeOf(box.log, 'meduza.io')).toBe('proxy')
      expect(routeOf(box.log, 'theins.ru')).toBe('proxy')
    } finally { await box.stop() }
  }, 40000)

  it('если выключить «российские напрямую», всё идёт через VPN', async () => {
    const { port, box } = await withClient({ bypassRu: false })
    try {
      const r = await httpViaProxy(port, 'http://example-shop.ru:8080/')
      expect(r.body).toBe(REPLY)
      expect(routeOf(box.log, 'example-shop.ru')).toBe('proxy')
    } finally { await box.stop() }
  }, 40000)

  it('домашняя сеть всегда напрямую (роутер, принтер)', async () => {
    const { port, box } = await withClient({ bypassRu: false })
    try {
      await tryGet(port, 'http://192.168.1.1:80/')
      await tryGet(port, 'http://10.20.30.40:631/')
      await tryGet(port, 'http://printer.local:80/')
      expect(routeOf(box.log, '192.168.1.1')).toBe('direct')
      expect(routeOf(box.log, '10.20.30.40')).toBe('direct')
      expect(routeOf(box.log, 'printer.local')).toBe('direct')
    } finally { await box.stop() }
  }, 40000)

  it('свои списки: «всегда через VPN» главнее .ru, «всегда напрямую» главнее всего остального', async () => {
    const { port, box } = await withClient({ alwaysVpn: ['https://www.blocked-but-ru.ru/page', 'пример.рф'], alwaysDirect: ['*.my-bank.example.org', '203.0.113.99'] })
    try {
      await tryGet(port, 'http://blocked-but-ru.ru:8080/')
      await tryGet(port, 'http://sub.blocked-but-ru.ru:8080/')
      await tryGet(port, 'http://xn--e1afmkfd.xn--p1ai:8080/')
      await tryGet(port, 'http://app.my-bank.example.org:8080/')
      await tryGet(port, 'http://203.0.113.99:8080/')
      expect(routeOf(box.log, 'blocked-but-ru.ru')).toBe('proxy')
      expect(routeOf(box.log, 'sub.blocked-but-ru.ru')).toBe('proxy')
      expect(routeOf(box.log, 'xn--e1afmkfd.xn--p1ai')).toBe('proxy')
      expect(routeOf(box.log, 'app.my-bank.example.org')).toBe('direct')
      expect(routeOf(box.log, '203.0.113.99')).toBe('direct')
    } finally { await box.stop() }
  }, 40000)

  it('российские IP-адреса напрямую (по адресному списку)', async () => {
    const { port, box } = await withClient({})
    try {
      // 77.88.55.60 — адрес Яндекса, входит в список российских адресов
      await tryGet(port, 'http://77.88.55.60:8080/')
      expect(routeOf(box.log, '77.88.55.60')).toBe('direct')
    } finally { await box.stop() }
  }, 40000)

  it('программы мимо VPN: запросы от выбранной программы идут напрямую, от остальных — в VPN', async () => {
    const me = basename(process.execPath) // в тесте «программа» — это сам node, он и стучится во вход
    const bypass = await withClient({ bypassProcesses: [me], bypassRu: false })
    try {
      await tryGet(bypass.port, 'http://203.0.113.7:8080/')
      expect(routeOf(bypass.box.log, '203.0.113.7')).toBe('direct')
    } finally { await bypass.box.stop() }
    const normal = await withClient({ bypassProcesses: ['какая-то-другая.exe'], bypassRu: false })
    try {
      const r = await httpViaProxy(normal.port, 'http://203.0.113.7:8080/')
      expect(r.body).toBe(REPLY)
      expect(routeOf(normal.box.log, '203.0.113.7')).toBe('proxy')
    } finally { await normal.box.stop() }
  }, 60000)
})
