import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { buildProbeConfig, buildSingBoxConfig, parseInput, RULESETS } from '../core'
import type { BuildOptions, Mode, ParsedServer, RuleSetFile } from '../core'
import { GOOD } from './fixtures'
import { RULES_DIR, singBoxCheck, singBoxPath } from './helpers/singbox'
import { validateReferences } from './helpers/validate'

const ruleSets: RuleSetFile[] = RULESETS.sets.map((s) => ({
  tag: s.file.replace(/\.srs$/, ''),
  path: join(RULES_DIR, s.file),
  role: s.role as RuleSetFile['role']
}))

function server(key: string): ParsedServer {
  const r = parseInput(key)
  if (r.kind !== 'servers') throw new Error('не разобрался ключ: ' + JSON.stringify(r))
  return r.servers[0]!
}

function opts(s: ParsedServer, over: Partial<BuildOptions> = {}): BuildOptions {
  return {
    outbound: s.outbound,
    mode: 'proxy',
    mixedPort: 17890,
    clashPort: 17891,
    clashSecret: 'test-secret',
    bypassRu: true,
    ruleSets,
    bypassProcesses: [],
    alwaysVpn: [],
    alwaysDirect: [],
    dns: { leakProtection: true },
    ...over
  }
}

function expectValid(config: unknown, label: string): void {
  const refs = validateReferences(config as Record<string, unknown>)
  if (refs.length) throw new Error(`Неверные ссылки внутри конфига «${label}»:\n- ${refs.join('\n- ')}`)
  const r = singBoxCheck(config)
  if (!r.ok) throw new Error(`sing-box check отверг конфиг «${label}»:\n${r.output}\n\n${JSON.stringify(config, null, 2).slice(0, 4000)}`)
}

describe('проверка самой проверки', () => {
  it('движок на месте и это нужная версия', () => {
    expect(singBoxPath()).toBeTruthy()
  })
  it('заведомо сломанный конфиг отвергается', () => {
    expect(singBoxCheck({ outbounds: [{ type: 'direct', tag: 'd', bogus: 1 }] }).ok).toBe(false)
    expect(singBoxCheck({ dns: { servers: [{ tag: 'a', address: '1.1.1.1' }] }, outbounds: [{ type: 'direct', tag: 'direct' }] }).ok).toBe(false)
    expect(singBoxCheck({ route: { rule_set: [{ type: 'local', tag: 'r', format: 'binary', path: '/нет/файла.srs' }] }, outbounds: [{ type: 'direct', tag: 'direct' }] }).ok).toBe(false)
  })
  it('проверка ссылок ловит то, что sing-box check пропускает', () => {
    const bad = { route: { rules: [{ action: 'route', outbound: 'нет-такого' }, { rule_set: ['x'], action: 'route', outbound: 'direct' }] }, dns: { servers: [{ type: 'local', tag: 'a' }], final: 'b' }, outbounds: [{ type: 'direct', tag: 'direct' }] }
    expect(singBoxCheck(bad).ok).toBe(true) // движок пропускает…
    expect(validateReferences(bad).length).toBeGreaterThanOrEqual(3) // …а наша проверка — нет
  })
  it('простейший рабочий конфиг принимается', () => {
    expect(singBoxCheck({ outbounds: [{ type: 'direct', tag: 'direct' }] }).ok).toBe(true)
  })
})

describe('каждый тип ключа × каждый режим → sing-box check', () => {
  const modes: Mode[] = ['proxy', 'tun']
  for (const [name, key] of Object.entries(GOOD)) {
    for (const mode of modes) {
      it(`${name} / ${mode} / российские напрямую`, () => {
        expectValid(buildSingBoxConfig(opts(server(key), { mode })), `${name}/${mode}`)
      })
    }
    it(`${name} / без российских правил, без защиты DNS`, () => {
      expectValid(buildSingBoxConfig(opts(server(key), { bypassRu: false, dns: { leakProtection: false } })), name)
    })
  }
})

describe('настройки: каждая даёт валидный конфиг', () => {
  const s = (): ParsedServer => server(GOOD.vlessReality!)
  const cases: Array<[string, Partial<BuildOptions>]> = [
    ['программы мимо VPN', { bypassProcesses: ['chrome.exe', 'Steam.exe', 'Discord.exe'] }],
    ['свои списки: домены, кириллица, адреса', { alwaysVpn: ['https://www.youtube.com/watch?v=1', '*.instagram.com', 'пример.рф', '8.8.8.8', '2001:db8::/32'], alwaysDirect: ['bank.ru', 'my-nas.example.org', '203.0.113.0/24'] }],
    ['всё сразу', { bypassProcesses: ['a.exe'], alwaysVpn: ['x.com'], alwaysDirect: ['y.ru'], multiplex: true }],
    ['уплотнение соединений', { multiplex: true }],
    ['свой DNS: DoH по имени', { dns: { remote: 'https://dns.google/dns-query', direct: 'https://dns.yandex.ru/dns-query', leakProtection: true } }],
    ['свой DNS: tls и udp', { dns: { remote: 'tls://1.1.1.1', direct: 'udp://77.88.8.8', leakProtection: true } }],
    ['свой DNS: мусор → значения по умолчанию', { dns: { remote: '%%%', direct: '???', leakProtection: true } }],
    ['туннель: свой MTU и стек', { mode: 'tun', tun: { mtu: 1400, stack: 'system', strictRoute: false } }],
    ['туннель: gvisor', { mode: 'tun', tun: { stack: 'gvisor' } }],
    ['журнал: debug', { logLevel: 'debug' }],
    ['набор правил не скачался (список пуст)', { ruleSets: [] }]
  ]
  for (const [name, over] of cases) {
    it(name, () => expectValid(buildSingBoxConfig(opts(s(), over)), name))
  }
  it('в туннеле на каждый ключ: все 31 набор правил подключены и валидны', () => {
    const cfg = buildSingBoxConfig(opts(s(), { mode: 'tun' })) as { route: { rule_set: unknown[] } }
    expect(cfg.route.rule_set).toHaveLength(RULESETS.sets.length)
    expectValid(cfg, 'все наборы')
  })
  it('multiplex не добавляется к vision и к hysteria2', () => {
    const vision = buildSingBoxConfig(opts(server(GOOD.vlessReality!), { multiplex: true })) as { outbounds: Array<Record<string, unknown>> }
    expect(vision.outbounds[0]!.multiplex).toBeUndefined()
    const hy = buildSingBoxConfig(opts(server(GOOD.hysteria2!), { multiplex: true })) as { outbounds: Array<Record<string, unknown>> }
    expect(hy.outbounds[0]!.multiplex).toBeUndefined()
    const ws = buildSingBoxConfig(opts(server(GOOD.vlessWs!), { multiplex: true })) as { outbounds: Array<Record<string, unknown>> }
    expect(ws.outbounds[0]!.multiplex).toMatchObject({ enabled: true })
  })
})

describe('конфиг для проверки задержки', () => {
  it('все серверы в одном временном конфиге', () => {
    const outbounds = Object.entries(GOOD).map(([name, key], i) => ({ tag: `p${i}`, outbound: server(key).outbound, name }))
    expectValid(buildProbeConfig({ outbounds, clashPort: 17892, clashSecret: 's' }), 'probe')
  })
})

describe('готовый файл sing-box → наш конфиг', () => {
  it('сервер из чужого файла проходит проверку', () => {
    const imported = parseInput(JSON.stringify({ outbounds: [{ type: 'trojan', tag: 'Тест', server: 'tr.example.com', server_port: 443, password: 'pw', tls: { enabled: true, server_name: 'tr.example.com' } }] }))
    if (imported.kind !== 'servers') throw new Error('не разобрался')
    expectValid(buildSingBoxConfig(opts(imported.servers[0]!, { mode: 'tun' })), 'imported')
  })
})
