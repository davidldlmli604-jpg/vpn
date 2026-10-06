import { abort } from '../errors'
import type { ParsedServer } from '../types'
import { compact, isTruthyFlag, splitList } from '../util/text'
import { requireHostPort, splitShareLink } from './shareLink'

export function parseAnytls(link: string): ParsedServer {
  const parts = splitShareLink(link)
  const { host, port } = requireHostPort(parts)
  const password = parts.userinfo
  if (!password) abort('missing-secret', 'нет пароля')
  const q = parts.query
  const alpn = splitList(q.alpn)
  const tls = compact({
    enabled: true,
    server_name: q.sni || q.peer || undefined,
    insecure: isTruthyFlag(q.insecure) || isTruthyFlag(q.allowInsecure) || undefined,
    alpn: alpn.length ? alpn : undefined
  })
  const outbound = compact({ type: 'anytls', server: host, server_port: port, password, tls })
  return { protocol: 'anytls', name: parts.fragment, host, port, outbound, rawLink: link.trim(), warnings: [] }
}
