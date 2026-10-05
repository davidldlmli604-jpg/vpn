// Сквозная проверка без настоящего VPN: поднимаем настоящий sing-box-СЕРВЕР на 127.0.0.1,
// собираем клиентский конфиг нашим кодом из ключа и прогоняем реальный трафик через туннель.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { buildSingBoxConfig, parseInput, RULESETS } from '../core'
import type { RuleSetFile } from '../core'
import { REALITY_PRIVATE, REALITY_PUBLIC, SS2022_KEY, UUID } from './fixtures'
import { Box, freePort, httpViaProxy, makeCert, removeDir, startTarget, tempDir } from './helpers/loopback'
import { RULES_DIR } from './helpers/singbox'

const ruleSets: RuleSetFile[] = RULESETS.sets.map((s) => ({ tag: s.file.replace(/\.srs$/, ''), path: join(RULES_DIR, s.file), role: s.role as RuleSetFile['role'] }))
const b64 = (s: string): string => Buffer.from(s).toString('base64')
const b64url = (s: string): string => b64(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

interface Scenario {
  name: string
  /** inbound сервера и ключ клиента, собранные из выданного порта. */
  make: (p: number, tls: { certPath: string; keyPath: string }, handshakePort: number) => { inbounds: Array<Record<string, unknown>>; key: string }
}

const tlsBlock = (t: { certPath: string; keyPath: string }, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ enabled: true, server_name: 'localhost', certificate_path: t.certPath, key_path: t.keyPath, ...extra })
const L = '127.0.0.1'

const scenarios: Scenario[] = [
  { name: 'shadowsocks aes-256-gcm', make: (p) => ({ inbounds: [{ type: 'shadowsocks', tag: 'in', listen: L, listen_port: p, method: 'aes-256-gcm', password: 'pw-1' }], key: `ss://${b64url('aes-256-gcm:pw-1')}@${L}:${p}#SS` }) },
  { name: 'shadowsocks 2022', make: (p) => ({ inbounds: [{ type: 'shadowsocks', tag: 'in', listen: L, listen_port: p, method: '2022-blake3-aes-256-gcm', password: SS2022_KEY }], key: `ss://2022-blake3-aes-256-gcm:${encodeURIComponent(SS2022_KEY)}@${L}:${p}#SS22` }) },
  { name: 'vless tcp', make: (p) => ({ inbounds: [{ type: 'vless', tag: 'in', listen: L, listen_port: p, users: [{ uuid: UUID }] }], key: `vless://${UUID}@${L}:${p}?encryption=none&type=tcp#v` }) },
  { name: 'vless websocket', make: (p) => ({ inbounds: [{ type: 'vless', tag: 'in', listen: L, listen_port: p, users: [{ uuid: UUID }], transport: { type: 'ws', path: '/w' } }], key: `vless://${UUID}@${L}:${p}?encryption=none&type=ws&path=%2Fw&host=x.test#ws` }) },
  { name: 'vless httpupgrade', make: (p) => ({ inbounds: [{ type: 'vless', tag: 'in', listen: L, listen_port: p, users: [{ uuid: UUID }], transport: { type: 'httpupgrade', path: '/u' } }], key: `vless://${UUID}@${L}:${p}?encryption=none&type=httpupgrade&path=%2Fu&host=x.test#hu` }) },
  { name: 'vless grpc + tls', make: (p, t) => ({ inbounds: [{ type: 'vless', tag: 'in', listen: L, listen_port: p, users: [{ uuid: UUID }], tls: tlsBlock(t), transport: { type: 'grpc', service_name: 'g' } }], key: `vless://${UUID}@${L}:${p}?encryption=none&security=tls&sni=localhost&allowInsecure=1&type=grpc&serviceName=g#grpc` }) },
  {
    name: 'vless Reality + vision',
    make: (p, _t, hp) => ({
      inbounds: [{ type: 'vless', tag: 'in', listen: L, listen_port: p, users: [{ uuid: UUID, flow: 'xtls-rprx-vision' }], tls: { enabled: true, server_name: 'localhost', reality: { enabled: true, handshake: { server: L, server_port: hp }, private_key: REALITY_PRIVATE, short_id: ['abcd1234'] } } }],
      key: `vless://${UUID}@${L}:${p}?encryption=none&flow=xtls-rprx-vision&security=reality&sni=localhost&fp=chrome&pbk=${REALITY_PUBLIC}&sid=abcd1234&type=tcp#reality`
    })
  },
  { name: 'vmess tcp', make: (p) => ({ inbounds: [{ type: 'vmess', tag: 'in', listen: L, listen_port: p, users: [{ uuid: UUID, alterId: 0 }] }], key: 'vmess://' + b64(JSON.stringify({ v: '2', ps: 'vm', add: L, port: String(p), id: UUID, aid: '0', scy: 'auto', net: 'tcp', type: 'none', tls: '' })) }) },
  { name: 'vmess websocket', make: (p) => ({ inbounds: [{ type: 'vmess', tag: 'in', listen: L, listen_port: p, users: [{ uuid: UUID, alterId: 0 }], transport: { type: 'ws', path: '/vm' } }], key: 'vmess://' + b64(JSON.stringify({ v: '2', ps: 'vmws', add: L, port: String(p), id: UUID, aid: '0', scy: 'auto', net: 'ws', type: 'none', host: 'x.test', path: '/vm', tls: '' })) }) },
  { name: 'trojan + tls', make: (p, t) => ({ inbounds: [{ type: 'trojan', tag: 'in', listen: L, listen_port: p, users: [{ password: 'tp@ss' }], tls: tlsBlock(t) }], key: `trojan://${encodeURIComponent('tp@ss')}@${L}:${p}?sni=localhost&allowInsecure=1#tr` }) },
  { name: 'trojan websocket + tls', make: (p, t) => ({ inbounds: [{ type: 'trojan', tag: 'in', listen: L, listen_port: p, users: [{ password: 'tp' }], tls: tlsBlock(t), transport: { type: 'ws', path: '/t' } }], key: `trojan://tp@${L}:${p}?sni=localhost&allowInsecure=1&type=ws&path=%2Ft&host=localhost#trws` }) },
  { name: 'hysteria2 + salamander', make: (p, t) => ({ inbounds: [{ type: 'hysteria2', tag: 'in', listen: L, listen_port: p, users: [{ password: 'hy2pw' }], obfs: { type: 'salamander', password: 'obfspw' }, tls: tlsBlock(t, { alpn: ['h3'] }) }], key: `hysteria2://hy2pw@${L}:${p}?sni=localhost&insecure=1&obfs=salamander&obfs-password=obfspw#hy2` }) },
  { name: 'tuic', make: (p, t) => ({ inbounds: [{ type: 'tuic', tag: 'in', listen: L, listen_port: p, users: [{ uuid: UUID, password: 'tuicpw' }], congestion_control: 'bbr', tls: tlsBlock(t, { alpn: ['h3'] }) }], key: `tuic://${UUID}:tuicpw@${L}:${p}?congestion_control=bbr&udp_relay_mode=native&alpn=h3&sni=localhost&allow_insecure=1#tuic` }) },
  { name: 'anytls', make: (p, t) => ({ inbounds: [{ type: 'anytls', tag: 'in', listen: L, listen_port: p, users: [{ password: 'anypw' }], tls: tlsBlock(t) }], key: `anytls://anypw@${L}:${p}?sni=localhost&insecure=1#any` }) }
]

let dir: string
let cert: { certPath: string; keyPath: string }
let target: { port: number; close: () => Promise<void> }
const REPLY = 'ответ-из-«интернета»-через-туннель'

beforeAll(async () => {
  dir = tempDir()
  cert = makeCert(dir)
  target = await startTarget(REPLY)
}, 60000)

afterAll(async () => {
  await target?.close()
  if (dir) removeDir(dir)
})

describe('реальный трафик через туннель, режим «системный прокси»', () => {
  for (const sc of scenarios) {
    it(sc.name, async () => {
      const serverPort = await freePort()
      const handshakePort = await freePort()
      const { inbounds, key } = sc.make(serverPort, cert, handshakePort)
      // для Reality нужен «сайт-прикрытие» — поднимаем его рядом (TLS 1.3, самоподписанный сертификат)
      const extra = sc.name.includes('Reality') ? [{ type: 'trojan', tag: 'dest', listen: L, listen_port: handshakePort, users: [{ password: 'x' }], tls: tlsBlock(cert) }] : []
      const server = new Box(`server-${sc.name.replace(/\W+/g, '_')}`, {
        log: { level: 'info' },
        inbounds: [...inbounds, ...extra],
        outbounds: [{ type: 'direct', tag: 'direct' }],
        // что бы ни просил клиент, «интернетом» для теста служит наш локальный сервер
        route: { rules: [{ action: 'route-options', override_address: L, override_port: target.port }], final: 'direct' }
      }, dir)

      const parsed = parseInput(key)
      if (parsed.kind !== 'servers') throw new Error('ключ не разобрался: ' + JSON.stringify(parsed))
      const mixedPort = await freePort()
      const clashPort = await freePort()
      const client = new Box(`client-${sc.name.replace(/\W+/g, '_')}`, buildSingBoxConfig({
        outbound: parsed.servers[0]!.outbound, mode: 'proxy', mixedPort, clashPort, clashSecret: 's',
        bypassRu: true, ruleSets, bypassProcesses: [], alwaysVpn: [], alwaysDirect: [], dns: { leakProtection: true }, logLevel: 'debug'
      }), dir)
      try {
        await server.start()
        await client.start()
        // обращаемся к «зарубежному» адресу: он не российский и не домашний, значит пойдёт через VPN
        const viaIp = await httpViaProxy(mixedPort, 'http://203.0.113.7:8080/')
        expect({ status: viaIp.status, body: viaIp.body }).toEqual({ status: 200, body: REPLY })
        // и по имени сайта: имя уходит на сервер, локальный DNS не нужен
        const viaName = await httpViaProxy(mixedPort, 'http://some-foreign-site.example.org:8080/page')
        expect(viaName.body).toBe(REPLY)
      } catch (e) {
        throw new Error(`${(e as Error).message}\n--- журнал клиента ---\n${client.log.slice(-2500)}\n--- журнал сервера ---\n${server.log.slice(-2500)}`)
      } finally {
        await client.stop()
        await server.stop()
      }
    }, 60000)
  }
})
