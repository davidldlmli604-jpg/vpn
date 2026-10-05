import { abort } from '../errors'
import type { ParsedServer } from '../types'
import { compact } from '../util/text'
import { requireHostPort, splitShareLink } from './shareLink'
import { buildTls, buildTransport } from './tlsTransport'

export function parseTrojan(link: string): ParsedServer {
  const parts = splitShareLink(link)
  const { host, port } = requireHostPort(parts)
  const password = parts.userinfo
  if (!password) abort('missing-secret', 'нет пароля')
  const q = parts.query
  const tls = buildTls({ ...q, security: q.security ?? 'tls' }, { serverHost: host, defaultOn: true })
  const transport = buildTransport(q)
  const outbound = compact({ type: 'trojan', server: host, server_port: port, password, tls, transport })
  return { protocol: 'trojan', name: parts.fragment, host, port, outbound, rawLink: link.trim(), warnings: [] }
}
