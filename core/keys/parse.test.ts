import { describe, expect, it } from 'vitest'
import { parseInput, parseSubscriptionBody, parseSubscriptionUserinfo } from '../index'
import type { ParseOutcome, ParsedServer } from '../types'
import { BROKEN, GOOD, REALITY_PUBLIC, UUID, vmessJson } from '../../tests/fixtures'

function one(text: string): ParsedServer {
  const r = parseInput(text)
  if (r.kind !== 'servers') throw new Error('ожидали сервер, получили ' + JSON.stringify(r))
  expect(r.servers).toHaveLength(1)
  return r.servers[0]!
}
const errCode = (r: ParseOutcome): string => (r.kind === 'error' ? r.error.code : r.kind)

describe('vless', () => {
  it('Reality', () => {
    const s = one(GOOD.vlessReality!)
    expect(s.protocol).toBe('vless')
    expect(s.name).toBe('Нидерланды Reality') // флаг-эмодзи убран
    expect(s.countryHint).toBe('NL')
    expect(s.host).toBe('nl.example.com')
    expect(s.port).toBe(443)
    expect(s.outbound).toMatchObject({
      type: 'vless', server: 'nl.example.com', server_port: 443, uuid: UUID, flow: 'xtls-rprx-vision', packet_encoding: 'xudp',
      tls: { enabled: true, server_name: 'www.microsoft.com', utls: { enabled: true, fingerprint: 'chrome' }, reality: { enabled: true, public_key: REALITY_PUBLIC, short_id: '6ba85179e30d4fc2' } }
    })
    expect(s.outbound.transport).toBeUndefined()
    expect(s.rawLink).toBe(GOOD.vlessReality)
  })
  it('WebSocket + TLS, ранние данные вынесены из пути', () => {
    const s = one(GOOD.vlessWs!)
    expect(s.outbound.transport).toEqual({ type: 'ws', path: '/vless', max_early_data: 2560, early_data_header_name: 'Sec-WebSocket-Protocol', headers: { Host: 'cdn.example.com' } })
    expect(s.outbound.tls).toMatchObject({ enabled: true, server_name: 'cdn.example.com', alpn: ['h2', 'http/1.1'], utls: { fingerprint: 'firefox' } })
  })
  it('gRPC', () => {
    const s = one(GOOD.vlessGrpc!)
    expect(s.outbound.transport).toEqual({ type: 'grpc', service_name: 'grpcsvc' })
    expect(s.countryHint).toBe('FI')
  })
  it('без шифрования и без tls', () => {
    const s = one(GOOD.vlessPlain!)
    expect(s.outbound.tls).toBeUndefined()
    expect(s.outbound.flow).toBeUndefined()
  })
  it('httpupgrade', () => {
    expect(one(GOOD.vlessHttpUpgrade!).outbound.transport).toEqual({ type: 'httpupgrade', host: 'hu.example.com', path: '/up' })
  })
  it('IPv6-адрес в скобках', () => {
    const s = one(`vless://${UUID}@[2001:db8::1]:8443?security=none#v6`)
    expect(s.host).toBe('2001:db8::1')
    expect(s.port).toBe(8443)
  })
})

describe('vmess', () => {
  it('классический вид v2rayN', () => {
    const s = one(GOOD.vmess!)
    expect(s.protocol).toBe('vmess')
    expect(s.name).toBe('Германия | vmess')
    expect(s.countryHint).toBe('DE')
    expect(s.outbound).toMatchObject({ type: 'vmess', server: 'de.example.com', server_port: 443, uuid: UUID, security: 'auto', alter_id: 0 })
    expect(s.outbound.transport).toMatchObject({ type: 'ws', path: '/ws', max_early_data: 2048, headers: { Host: 'cdn.example.com' } })
    expect(s.outbound.tls).toMatchObject({ enabled: true, server_name: 'cdn.example.com' })
  })
  it('обычный TCP без tls', () => {
    const s = one(GOOD.vmessTcp!)
    expect(s.outbound.tls).toBeUndefined()
    expect(s.outbound.transport).toBeUndefined()
  })
  it('gRPC: путь — это имя сервиса', () => {
    expect(one(GOOD.vmessGrpc!).outbound.transport).toEqual({ type: 'grpc', service_name: 'svc' })
  })
  it('порт числом, а не строкой', () => {
    expect(one(vmessJson({ port: 8443 })).port).toBe(8443)
  })
  it('новый вид со ссылкой', () => {
    const s = one(GOOD.vmessUrl!)
    expect(s.outbound).toMatchObject({ type: 'vmess', server: 'us.example.com', uuid: UUID, security: 'auto' })
  })
})

describe('trojan', () => {
  it('пароль со спецсимволами раскодируется', () => {
    const s = one(GOOD.trojan!)
    expect(s.outbound).toMatchObject({ type: 'trojan', password: 'p@ss:w0rd', server_port: 443, tls: { enabled: true, server_name: 'tr.example.com', alpn: ['h2'] } })
  })
  it('WebSocket', () => {
    expect(one(GOOD.trojanWs!).outbound.transport).toMatchObject({ type: 'ws', path: '/trojan' })
  })
})

describe('shadowsocks', () => {
  it('SIP002 (base64 в логине)', () => {
    const s = one(GOOD.ssSip002!)
    expect(s.outbound).toMatchObject({ type: 'shadowsocks', server: 'sw.example.com', server_port: 8388, method: 'aes-256-gcm', password: 'pass-word' })
    expect(s.name).toBe('Швеция SS')
    expect(s.countryHint).toBe('SE')
  })
  it('старый вид (всё в base64)', () => {
    expect(one(GOOD.ssLegacy!).outbound).toMatchObject({ method: 'chacha20-ietf-poly1305', password: 'legacy-pass', server: 'legacy.example.com', server_port: 8388 })
  })
  it('шифры 2022 с открытым паролем', () => {
    expect(one(GOOD.ss2022!).outbound).toMatchObject({ method: '2022-blake3-aes-256-gcm', password: expect.stringMatching(/^QOypW5nz/) })
  })
  it('плагин obfs', () => {
    expect(one(GOOD.ssPlugin!).outbound).toMatchObject({ plugin: 'obfs-local', plugin_opts: 'obfs=tls;obfs-host=www.bing.com' })
  })
  it('chacha20-poly1305 приводится к имени sing-box', () => {
    const s = one(`ss://${Buffer.from('chacha20-poly1305:pw').toString('base64')}@h.example.com:1234`)
    expect(s.outbound.method).toBe('chacha20-ietf-poly1305')
  })
})

describe('hysteria2 / tuic / anytls', () => {
  it('hysteria2 с маскировкой', () => {
    const s = one(GOOD.hysteria2!)
    expect(s.outbound).toMatchObject({ type: 'hysteria2', server_port: 443, password: 'hy2pass', obfs: { type: 'salamander', password: 'obfspw' }, tls: { enabled: true, server_name: 'hy.example.com', alpn: ['h3'] } })
  })
  it('короткая схема hy2://', () => {
    const s = one(GOOD.hy2Short!)
    expect(s.protocol).toBe('hysteria2')
    expect(s.outbound.tls).toMatchObject({ insecure: true })
  })
  it('перебор портов', () => {
    expect(one(GOOD.hy2Hop!).outbound.server_ports).toEqual(['20000:30000'])
  })
  it('отпечаток сертификата — предупреждение, а не ошибка', () => {
    const s = one('hysteria2://pw@example.com:443?pinSHA256=AA:BB&insecure=1')
    expect(s.warnings.join(' ')).toContain('pinSHA256')
  })
  it('tuic', () => {
    expect(one(GOOD.tuic!).outbound).toMatchObject({ type: 'tuic', uuid: UUID, password: 'tuicpass', congestion_control: 'bbr', udp_relay_mode: 'native', tls: { alpn: ['h3'] } })
  })
  it('anytls', () => {
    expect(one(GOOD.anytls!).outbound).toMatchObject({ type: 'anytls', password: 'anypass' })
  })
})

describe('битые и непонятные ключи', () => {
  for (const c of BROKEN) {
    it(`${c.name} → ${c.code}`, () => {
      const r = parseInput(c.input)
      expect(errCode(r)).toBe(c.code)
      if (r.kind === 'error') {
        expect(r.error.message.length).toBeGreaterThan(10)
        // сообщение — человеческое, без технических слов
        expect(r.error.message).not.toMatch(/handshake|undefined|TypeError|Unexpected token|at \w+\.\w+/i)
      }
    })
  }
  it('секреты не просачиваются в сообщения об ошибках', () => {
    const r = parseInput(`vless://${UUID}@example.com:70000?security=tls`)
    expect(JSON.stringify(r)).not.toContain(UUID)
  })
  it('ничего не бросает на случайном мусоре', () => {
    const junk = ['vless://', 'vmess://', 'ss://', 'trojan://', '://', 'vless://@', '[[[', 'hysteria2://:::', '\u0000\u0001', 'ss://#', 'vless://a@b:1?%', 'http://', 'tuic://x@y']
    for (const j of junk) expect(() => parseInput(j)).not.toThrow()
    for (const j of junk) expect(parseInput(j).kind).toBe('error')
  })
})

describe('несколько ключей и подписки', () => {
  it('список через строки; битый ключ не мешает остальным', () => {
    const r = parseInput([GOOD.vlessReality, GOOD.trojan, 'vless://битый', GOOD.hysteria2].join('\n'))
    expect(r.kind).toBe('servers')
    if (r.kind === 'servers') {
      expect(r.servers.map((s) => s.protocol)).toEqual(['vless', 'trojan', 'hysteria2'])
      expect(r.failures).toHaveLength(1)
      expect(r.failures[0]!.hint).not.toContain(UUID)
    }
  })
  it('ссылка на подписку', () => {
    expect(parseInput('https://sub.example.com/api/v1/abcdef123')).toEqual({ kind: 'subscription-url', url: 'https://sub.example.com/api/v1/abcdef123' })
  })
  it('ссылки-обёртки sing-box:// и clash://', () => {
    const url = 'https://sub.example.com/x?token=1&b=2'
    expect(parseInput('sing-box://import-remote-profile?url=' + encodeURIComponent(url) + '#name')).toEqual({ kind: 'subscription-url', url })
    expect(parseInput('clash://install-config?url=' + encodeURIComponent(url))).toEqual({ kind: 'subscription-url', url })
  })
  it('тело подписки в base64', () => {
    const body = Buffer.from([GOOD.vlessReality, GOOD.ssSip002, '# служебная строка', 'REMARKS=test'].join('\n')).toString('base64')
    const r = parseSubscriptionBody(body)
    expect(r.kind).toBe('servers')
    if (r.kind === 'servers') expect(r.servers).toHaveLength(2)
  })
  it('тело подписки обычным текстом (url-safe base64 без «=» тоже)', () => {
    const body = Buffer.from([GOOD.trojan, GOOD.tuic].join('\r\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const r = parseSubscriptionBody(body)
    expect(r.kind).toBe('servers')
    if (r.kind === 'servers') expect(r.servers).toHaveLength(2)
  })
  it('пустая подписка — понятная ошибка', () => {
    const r = parseSubscriptionBody('   ')
    expect(errCode(r)).toBe('no-servers')
  })
  it('подписка в формате Clash — честно говорим, что не читаем', () => {
    const r = parseSubscriptionBody('port: 7890\nproxies:\n  - name: a\n    type: ss\n')
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.error.message).toContain('Clash')
  })
  it('заголовок Subscription-Userinfo', () => {
    expect(parseSubscriptionUserinfo('upload=455727941; download=6174315083; total=1073741824000; expire=1671815872')).toEqual({
      upload: 455727941, download: 6174315083, total: 1073741824000, expireAt: 1671815872000
    })
    expect(parseSubscriptionUserinfo(null)).toEqual({})
    expect(parseSubscriptionUserinfo('мусор')).toEqual({})
  })
})

describe('готовый файл настроек sing-box', () => {
  const full = {
    log: { level: 'info' },
    inbounds: [{ type: 'tun', tag: 'tun-in' }],
    outbounds: [
      { type: 'selector', tag: 'select', outbounds: ['🇳🇱 NL'] },
      { type: 'vless', tag: '🇳🇱 NL Reality', server: 'nl.example.com', server_port: 443, uuid: UUID, flow: 'xtls-rprx-vision', tls: { enabled: true, server_name: 'a.com', reality: { enabled: true, public_key: REALITY_PUBLIC, short_id: 'ab' } }, detour: undefined },
      { type: 'hysteria2', tag: 'hy', server: 'hy.example.com', server_port: 443, password: 'x', tls: { enabled: true } },
      { type: 'direct', tag: 'direct' },
      { type: 'block', tag: 'block' },
      { type: 'shadowsocks', tag: 'chain', server: 'a.com', server_port: 1, method: 'aes-128-gcm', password: 'p', detour: 'hy' }
    ],
    route: { rules: [] }
  }
  it('берёт только настоящие серверы, служебные пропускает', () => {
    const r = parseInput(JSON.stringify(full))
    expect(r.kind).toBe('servers')
    if (r.kind === 'servers') {
      expect(r.servers.map((s) => s.host)).toEqual(['nl.example.com', 'hy.example.com'])
      expect(r.servers[0]!.name).toBe('NL Reality')
      expect(r.servers[0]!.countryHint).toBe('NL')
      expect(r.servers[0]!.outbound.tag).toBeUndefined() // свой тег проставит сборщик
      expect(r.servers[0]!.rawLink).toBeUndefined()
      expect(r.failures).toHaveLength(1) // цепочка с detour не поддерживается
      expect(r.failures[0]!.error.code).toBe('unsupported-feature')
    }
  })
  it('один объект подключения', () => {
    const r = parseInput(JSON.stringify(full.outbounds[1]))
    expect(r.kind).toBe('servers')
  })
})
