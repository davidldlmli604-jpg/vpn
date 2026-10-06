import { abort } from '../errors'
import type { ParsedServer } from '../types'
import { compact, isTruthyFlag, splitList } from '../util/text'
import { requireHostPort, splitShareLink } from './shareLink'

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export function parseTuic(link: string): ParsedServer {
  const parts = splitShareLink(link)
  const { host, port } = requireHostPort(parts)
  const colon = parts.userinfo.indexOf(':')
  const uuid = (colon === -1 ? parts.userinfo : parts.userinfo.slice(0, colon)).trim()
  const password = colon === -1 ? '' : parts.userinfo.slice(colon + 1)
  if (!uuid) abort('missing-secret', 'нет идентификатора (UUID)')
  if (!UUID_RE.test(uuid)) abort('bad-secret', 'UUID записан неверно')
  if (!password) abort('missing-secret', 'нет пароля')
  const q = parts.query

  const cc = (q.congestion_control || q.congestion || 'cubic').toLowerCase()
  const ccMap: Record<string, string> = { cubic: 'cubic', bbr: 'bbr', new_reno: 'new_reno', newreno: 'new_reno', reno: 'new_reno' }
  if (!ccMap[cc]) abort('unsupported-feature', `congestion_control ${cc}`)
  const relay = (q.udp_relay_mode || q['udp-relay-mode'] || 'native').toLowerCase()
  if (relay !== 'native' && relay !== 'quic') abort('unsupported-feature', `udp_relay_mode ${relay}`)

  const alpn = splitList(q.alpn)
  const insecure = isTruthyFlag(q.allow_insecure) || isTruthyFlag(q.allowInsecure) || isTruthyFlag(q.insecure)
  const tls = compact({
    enabled: true,
    server_name: q.sni || undefined,
    insecure: insecure || undefined,
    disable_sni: isTruthyFlag(q.disable_sni) || undefined,
    alpn: alpn.length ? alpn : ['h3']
  })
  const outbound = compact({
    type: 'tuic',
    server: host,
    server_port: port,
    uuid: uuid.toLowerCase(),
    password,
    congestion_control: ccMap[cc],
    udp_relay_mode: relay,
    zero_rtt_handshake: isTruthyFlag(q.zero_rtt_handshake) || isTruthyFlag(q['reduce_rtt']) || undefined,
    tls
  })
  return { protocol: 'tuic', name: parts.fragment, host, port, outbound, rawLink: link.trim(), warnings: [] }
}
