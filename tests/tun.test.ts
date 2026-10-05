// Режим «весь компьютер» (TUN) вживую. Нужны права на создание сетевого устройства:
// на Linux это root с /dev/net/tun. На обычной машине тест честно пропускается и пишет почему.
// В туннель заворачивается ТОЛЬКО тестовая сеть 203.0.113.0/24 — остальной трафик машины не затрагивается.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { request } from 'node:http'
import { join } from 'node:path'
import { buildSingBoxConfig, parseInput, RULESETS } from '../core'
import type { RuleSetFile, TunStack } from '../core'
import { Box, freePort, removeDir, startTarget, tempDir } from './helpers/loopback'
import { RULES_DIR } from './helpers/singbox'

const canTun = process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0 && existsSync('/dev/net/tun')
const ruleSets: RuleSetFile[] = RULESETS.sets.map((s) => ({ tag: s.file.replace(/\.srs$/, ''), path: join(RULES_DIR, s.file), role: s.role as RuleSetFile['role'] }))
const REPLY = 'ответ-через-туннель-TUN'

let dir: string
let target: { port: number; close: () => Promise<void> }
let server: Box
let serverPort: number

function plainGet(host: string, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request({ host, port, path: '/', agent: false, timeout: 6000 }, (res) => {
      let b = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (b += c))
      res.on('end', () => resolve(b))
    })
    req.on('timeout', () => req.destroy(new Error('таймаут')))
    req.on('error', reject)
    req.end()
  })
}

describe.skipIf(!canTun)('TUN: трафик без всяких настроек прокси уходит в туннель', () => {
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

  const stacks: TunStack[] = ['mixed', 'system', 'gvisor']
  for (const stack of stacks) {
    it(`стек ${stack}`, async () => {
      const parsed = parseInput(`ss://${Buffer.from('aes-256-gcm:pw').toString('base64')}@127.0.0.1:${serverPort}#t`)
      if (parsed.kind !== 'servers') throw new Error('ключ не разобрался')
      const cfg = buildSingBoxConfig({
        outbound: parsed.servers[0]!.outbound, mode: 'tun', mixedPort: await freePort(), clashPort: await freePort(), clashSecret: 's',
        bypassRu: true, ruleSets, bypassProcesses: [], alwaysVpn: [], alwaysDirect: [], dns: { leakProtection: true }, tun: { stack, interfaceName: `tt${stack.slice(0, 3)}` }, logLevel: 'debug'
      }) as { inbounds: Array<Record<string, unknown>> }
      // только для теста: в туннель — одна тестовая сеть, чтобы не трогать настоящий трафик песочницы
      const tun = cfg.inbounds.find((i) => i.type === 'tun')!
      delete tun.route_exclude_address
      tun.route_address = ['203.0.113.0/24']
      tun.strict_route = false
      const box = new Box(`tun-${stack}`, cfg, dir)
      try {
        await box.start()
        await new Promise((r) => setTimeout(r, 800))
        expect(await plainGet('203.0.113.7', 8080)).toBe(REPLY)
      } catch (e) {
        throw new Error(`${(e as Error).message}\n${box.log.replace(/\x1b\[[0-9;]*m/g, '').slice(-2500)}`)
      } finally {
        await box.stop()
      }
    }, 60000)
  }
})

describe.skipIf(canTun)('TUN: пропущено', () => {
  it('на этой машине нет прав на создание туннеля (нужен root + /dev/net/tun на Linux) — проверяется только `sing-box check`', () => {
    expect(canTun).toBe(false)
  })
})
