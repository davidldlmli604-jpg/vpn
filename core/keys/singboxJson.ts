import { abort, keyError } from '../errors'
import { guessCountry, stripFlagEmoji } from '../country'
import type { Outbound, ParseFailure, ParsedServer, Protocol } from '../types'

const PROXY_TYPES: Record<string, Protocol> = {
  vless: 'vless',
  vmess: 'vmess',
  trojan: 'trojan',
  shadowsocks: 'shadowsocks',
  hysteria2: 'hysteria2',
  tuic: 'tuic',
  anytls: 'anytls',
  hysteria: 'other',
  socks: 'other',
  http: 'other',
  ssh: 'other',
  naive: 'other'
}
const SERVICE_TYPES = new Set(['direct', 'block', 'dns', 'selector', 'urltest'])
/** Поля, которые привязывают исходящее подключение к чужой сетевой обвязке — мы строим свою. */
const STRIP_FIELDS = ['tag', 'detour', 'bind_interface', 'inet4_bind_address', 'inet6_bind_address', 'routing_mark', 'netns', 'reuse_addr']

export function looksLikeJson(text: string): boolean {
  const t = text.trim()
  return t.startsWith('{') || t.startsWith('[')
}

/**
 * Достаёт исходящие подключения из готового файла sing-box.
 * Принимает: весь файл ({"outbounds": [...]}), один объект подключения или список подключений.
 * Остальное (маршруты, DNS, входящие) намеренно отбрасывается: приложение строит свои.
 */
export function parseSingBoxJson(text: string): { servers: ParsedServer[]; failures: ParseFailure[] } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return abort('bad-json')
  }
  let list: unknown[]
  if (Array.isArray(data)) list = data
  else if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (Array.isArray(obj.outbounds)) list = obj.outbounds
    else if (typeof obj.type === 'string') list = [obj]
    else return abort('no-servers', undefined, 'В файле нет раздела outbounds с серверами.')
  } else return abort('bad-json')

  const servers: ParsedServer[] = []
  const failures: ParseFailure[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const ob = item as Outbound
    const type = String(ob.type ?? '')
    if (SERVICE_TYPES.has(type)) continue
    const proto = PROXY_TYPES[type]
    const tag = typeof ob.tag === 'string' ? ob.tag : ''
    if (!proto) {
      failures.push({ hint: `${type || 'без типа'} ${tag}`.trim(), error: keyError('unsupported-protocol', type) })
      continue
    }
    if (ob.detour !== undefined && ob.detour !== '') {
      failures.push({ hint: tag || type, error: keyError('unsupported-feature', 'detour', 'Цепочки из нескольких серверов программа пока не умеет.') })
      continue
    }
    const host = typeof ob.server === 'string' ? ob.server : ''
    const port = typeof ob.server_port === 'number' ? ob.server_port : Number(ob.server_port ?? 0)
    if (!host) {
      failures.push({ hint: tag || type, error: keyError('missing-host') })
      continue
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      failures.push({ hint: tag || type, error: keyError(port ? 'bad-port' : 'missing-port') })
      continue
    }
    const clean: Outbound = {}
    for (const [k, v] of Object.entries(ob)) if (!STRIP_FIELDS.includes(k)) clean[k] = v
    servers.push({
      protocol: proto,
      name: stripFlagEmoji(tag),
      host,
      port,
      outbound: clean,
      countryHint: guessCountry(tag),
      warnings: []
    })
  }
  return { servers, failures }
}
