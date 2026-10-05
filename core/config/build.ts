import { normalizeRuleList } from '../domains'
import { expandProcessNames } from '../presets'
import type { Mode, Outbound, TunStack } from '../types'
import { dnsServerObject, parseDnsSpec } from './dnsSpec'

export interface RuleSetFile {
  tag: string
  /** Полный путь к файлу .srs на диске. */
  path: string
  role: 'direct' | 'direct-ip' | 'vpn'
}

export interface BuildOptions {
  /** Выбранный сервер (исходящее подключение sing-box без поля tag). */
  outbound: Outbound
  mode: Mode
  mixedPort: number
  clashPort: number
  clashSecret: string
  /** ipv6: true — добавить IPv6 в туннель. По умолчанию выключено: на ПК с отключённым IPv6 туннель иначе не запустится. */
  tun?: { mtu?: number; stack?: TunStack; strictRoute?: boolean; interfaceName?: string; ipv6?: boolean }
  bypassRu: boolean
  /** Какие файлы наборов правил есть на диске (из них выбираются нужные роли). */
  ruleSets: RuleSetFile[]
  bypassProcesses: string[]
  /** Строки как их ввёл человек — сборщик сам приведёт их в порядок. */
  alwaysVpn: string[]
  alwaysDirect: string[]
  dns: { remote?: string; direct?: string; leakProtection: boolean }
  multiplex?: boolean
  logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error'
}

export const PROXY_TAG = 'proxy'
export const DIRECT_TAG = 'direct'
export const DEFAULT_DNS_REMOTE = 'https://1.1.1.1/dns-query'

/** Домашняя сеть всегда идёт напрямую: роутер, принтер, NAS, камеры. */
export const PRIVATE_NETS_V4 = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '224.0.0.0/4']
export const PRIVATE_NETS_V6 = ['fc00::/7', 'fe80::/10', 'ff00::/8']
export const PRIVATE_NETS = [...PRIVATE_NETS_V4, ...PRIVATE_NETS_V6]
const RU_ZONES = ['ru', 'xn--p1ai', 'su'] // .ru, .рф, .su
const LOCAL_SUFFIXES = ['local', 'lan', 'localdomain', 'home.arpa', 'internal']

type Rule = Record<string, unknown>

const route = (outbound: string, match: Rule): Rule => ({ ...match, action: 'route', outbound })

function applyMultiplex(ob: Outbound, enable: boolean | undefined): Outbound {
  if (!enable) return ob
  const type = String(ob.type)
  if (!['vless', 'vmess', 'trojan', 'shadowsocks'].includes(type)) return ob
  if (ob.flow) return ob // xtls-rprx-vision несовместим с уплотнением
  if (ob.multiplex) return ob
  return { ...ob, multiplex: { enabled: true, protocol: 'h2mux', max_connections: 4, min_streams: 4 } }
}

export function buildSingBoxConfig(o: BuildOptions): Record<string, unknown> {
  const proxy: Outbound = { ...applyMultiplex(o.outbound, o.multiplex), tag: PROXY_TAG }

  // ---------- DNS ----------
  const directSpec = parseDnsSpec(o.dns.direct) ?? { type: 'local' as const }
  const remoteSpec = parseDnsSpec(o.dns.remote) ?? parseDnsSpec(DEFAULT_DNS_REMOTE)!
  const leak = o.dns.leakProtection
  const dnsServers: Outbound[] = [dnsServerObject('dns-direct', directSpec, { resolver: directSpec.type === 'local' ? undefined : 'dns-bootstrap' })]
  // если «прямой» DNS задан доменным именем, для его поиска нужен системный
  if (directSpec.type !== 'local' && directSpec.server && !/^[\d.:]+$/.test(directSpec.server)) dnsServers.push({ type: 'local', tag: 'dns-bootstrap' })
  if (leak) dnsServers.push(dnsServerObject('dns-remote', remoteSpec, { detour: PROXY_TAG, resolver: 'dns-direct' }))

  const ru = o.bypassRu
  const directSets = ru ? o.ruleSets.filter((s) => s.role === 'direct').map((s) => s.tag) : []
  const ipSets = ru ? o.ruleSets.filter((s) => s.role === 'direct-ip').map((s) => s.tag) : []
  const vpnSets = ru ? o.ruleSets.filter((s) => s.role === 'vpn').map((s) => s.tag) : []
  const alwaysVpn = normalizeRuleList(o.alwaysVpn)
  const alwaysDirect = normalizeRuleList(o.alwaysDirect)
  const procs = expandProcessNames(o.bypassProcesses)

  const dnsRules: Rule[] = []
  const dnsRoute = (server: string, match: Rule): Rule => ({ ...match, action: 'route', server })
  dnsRules.push(dnsRoute('dns-direct', { domain_suffix: LOCAL_SUFFIXES }))
  if (leak) {
    if (vpnSets.length) dnsRules.push(dnsRoute('dns-remote', { rule_set: vpnSets }))
    if (alwaysVpn.domains.length) dnsRules.push(dnsRoute('dns-remote', { domain_suffix: alwaysVpn.domains }))
  }
  if (alwaysDirect.domains.length) dnsRules.push(dnsRoute('dns-direct', { domain_suffix: alwaysDirect.domains }))
  if (ru) {
    dnsRules.push(dnsRoute('dns-direct', { domain_suffix: RU_ZONES }))
    if (directSets.length) dnsRules.push(dnsRoute('dns-direct', { rule_set: directSets }))
  }

  const dns: Record<string, unknown> = {
    servers: dnsServers,
    rules: dnsRules,
    final: leak ? 'dns-remote' : 'dns-direct',
    strategy: 'prefer_ipv4'
  }

  // ---------- Правила маршрутизации ----------
  const rules: Rule[] = [{ action: 'sniff' }]
  if (o.mode === 'tun') rules.push({ protocol: 'dns', action: 'hijack-dns' })
  // домашняя сеть — всегда напрямую
  rules.push(route(DIRECT_TAG, { ip_is_private: true }))
  rules.push(route(DIRECT_TAG, { domain_suffix: LOCAL_SUFFIXES }))
  // заблокированные в России сайты (СМИ) — всегда через VPN, даже если домен .ru
  if (vpnSets.length) rules.push(route(PROXY_TAG, { rule_set: vpnSets }))
  // свои списки человека — они главнее готовых наборов
  if (alwaysVpn.domains.length) rules.push(route(PROXY_TAG, { domain_suffix: alwaysVpn.domains }))
  if (alwaysVpn.cidrs.length) rules.push(route(PROXY_TAG, { ip_cidr: alwaysVpn.cidrs }))
  if (alwaysDirect.domains.length) rules.push(route(DIRECT_TAG, { domain_suffix: alwaysDirect.domains }))
  if (alwaysDirect.cidrs.length) rules.push(route(DIRECT_TAG, { ip_cidr: alwaysDirect.cidrs }))
  // программы мимо VPN
  if (procs.length) rules.push(route(DIRECT_TAG, { process_name: procs }))
  // российские сайты напрямую
  if (ru) {
    rules.push(route(DIRECT_TAG, { domain_suffix: RU_ZONES }))
    if (directSets.length) rules.push(route(DIRECT_TAG, { rule_set: directSets }))
    // Российские адреса (IP). Намеренно без действия resolve: если бы удалённый DNS на миг не ответил,
    // sing-box отверг бы вообще все соединения. В туннеле адрес назначения и так известен, в прокси-режиме
    // сайты покрываются доменными списками и зонами.
    if (ipSets.length) rules.push(route(DIRECT_TAG, { rule_set: ipSets }))
  }

  const usedTags = new Set<string>()
  for (const r of rules) for (const t of (r.rule_set as string[] | undefined) ?? []) usedTags.add(t)
  const ruleSetDefs = o.ruleSets
    .filter((s) => usedTags.has(s.tag))
    .map((s) => ({ type: 'local', tag: s.tag, format: 'binary', path: s.path }))

  // ---------- Входящие ----------
  const inbounds: Outbound[] = []
  if (o.mode === 'tun') {
    inbounds.push({
      type: 'tun',
      tag: 'tun-in',
      interface_name: o.tun?.interfaceName ?? 'tropa-tun',
      address: o.tun?.ipv6 ? ['172.19.0.1/30', 'fdfe:dcba:9876::1/126'] : ['172.19.0.1/30'],
      mtu: o.tun?.mtu ?? 9000,
      auto_route: true,
      strict_route: o.tun?.strictRoute ?? true,
      stack: o.tun?.stack ?? 'mixed',
      route_exclude_address: o.tun?.ipv6 ? PRIVATE_NETS : PRIVATE_NETS_V4
    })
  }
  inbounds.push({ type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: o.mixedPort })

  return {
    log: { level: o.logLevel ?? 'info', timestamp: true },
    dns,
    inbounds,
    outbounds: [proxy, { type: 'direct', tag: DIRECT_TAG }],
    route: {
      rules,
      rule_set: ruleSetDefs,
      final: PROXY_TAG,
      auto_detect_interface: true,
      default_domain_resolver: 'dns-direct'
    },
    experimental: {
      clash_api: { external_controller: `127.0.0.1:${o.clashPort}`, secret: o.clashSecret }
    }
  }
}

/**
 * Временный конфиг для проверки задержки: без входящих подключений и маршрутов,
 * только исходящие (по одному на сервер) и управляющий интерфейс.
 */
export function buildProbeConfig(opts: { outbounds: Array<{ tag: string; outbound: Outbound }>; clashPort: number; clashSecret: string }): Record<string, unknown> {
  return {
    log: { level: 'warn', timestamp: true },
    dns: { servers: [{ type: 'local', tag: 'dns-direct' }], final: 'dns-direct', strategy: 'prefer_ipv4' },
    inbounds: [],
    outbounds: [...opts.outbounds.map((x) => ({ ...x.outbound, tag: x.tag })), { type: 'direct', tag: DIRECT_TAG }],
    route: { rules: [], final: DIRECT_TAG, auto_detect_interface: true, default_domain_resolver: 'dns-direct' },
    experimental: { clash_api: { external_controller: `127.0.0.1:${opts.clashPort}`, secret: opts.clashSecret } }
  }
}
