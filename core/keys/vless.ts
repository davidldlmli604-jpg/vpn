import { abort } from '../errors'
import type { ParsedServer } from '../types'
import { compact } from '../util/text'
import { requireHostPort, splitShareLink } from './shareLink'
import { buildTls, buildTransport } from './tlsTransport'

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export function parseVless(link: string): ParsedServer {
  const parts = splitShareLink(link)
  const { host, port } = requireHostPort(parts)
  const uuid = parts.userinfo.trim()
  if (!uuid) abort('missing-secret', 'нет идентификатора пользователя (UUID)')
  if (!UUID_RE.test(uuid)) abort('bad-secret', 'UUID записан неверно')
  const q = parts.query

  const enc = (q.encryption || 'none').toLowerCase()
  if (enc !== 'none' && enc !== '') {
    abort('unsupported-feature', 'vless encryption', 'Шифрование VLESS нового вида движок не поддерживает.')
  }
  const flow = (q.flow || '').toLowerCase()
  const warnings: string[] = []
  const tls = buildTls(q, { serverHost: host })
  const transport = buildTransport(q)
  if (flow && !flow.startsWith('xtls-rprx-vision')) {
    abort('unsupported-feature', `flow ${flow}`, 'Этот вариант потока (flow) движок не поддерживает.')
  }
  if (flow && !tls) abort('broken', 'flow без tls/reality')

  const outbound = compact({
    type: 'vless',
    server: host,
    server_port: port,
    uuid: uuid.toLowerCase(),
    flow: flow ? 'xtls-rprx-vision' : undefined,
    packet_encoding: 'xudp',
    tls,
    transport
  })
  return { protocol: 'vless', name: parts.fragment, host, port, outbound, rawLink: link.trim(), warnings }
}
