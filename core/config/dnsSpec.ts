import type { Outbound } from '../types'

export interface DnsServerSpec {
  type: 'udp' | 'tcp' | 'tls' | 'https' | 'quic' | 'local'
  server?: string
  server_port?: number
  path?: string
}

const IP4 = /^\d{1,3}(\.\d{1,3}){3}$/
const HOSTNAME = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/

/**
 * «https://1.1.1.1/dns-query», «tls://dns.google», «udp://8.8.8.8:53», «1.1.1.1», «system».
 * Возвращает null, если адрес непонятен — тогда вызывающий берёт значение по умолчанию.
 */
export function parseDnsSpec(input: string | undefined): DnsServerSpec | null {
  const s = (input ?? '').trim()
  if (!s) return null
  if (s.toLowerCase() === 'system' || s.toLowerCase() === 'local') return { type: 'local' }
  const m = /^(?:(udp|tcp|tls|https|quic):\/\/)?(\[[0-9a-fA-F:]+\]|[^/:\s]+)(?::(\d{1,5}))?(\/\S*)?$/i.exec(s)
  if (!m) return null
  const type = (m[1]?.toLowerCase() ?? 'udp') as DnsServerSpec['type']
  const host = m[2]!.replace(/^\[|\]$/g, '')
  if (!(IP4.test(host) || host.includes(':') || HOSTNAME.test(host))) return null
  const port = m[3] ? Number(m[3]) : undefined
  if (port !== undefined && (port < 1 || port > 65535)) return null
  const spec: DnsServerSpec = { type, server: host }
  if (port !== undefined) spec.server_port = port
  if (type === 'https' && m[4] && m[4] !== '/') spec.path = m[4]
  return spec
}

export function isIpLiteral(host: string): boolean {
  return IP4.test(host) || host.includes(':')
}

export function dnsServerObject(tag: string, spec: DnsServerSpec, opts: { detour?: string; resolver?: string }): Outbound {
  if (spec.type === 'local') return { type: 'local', tag }
  const obj: Outbound = { type: spec.type, tag, server: spec.server }
  if (spec.server_port !== undefined) obj.server_port = spec.server_port
  if (spec.path) obj.path = spec.path
  if (opts.detour) obj.detour = opts.detour
  if (spec.server && !isIpLiteral(spec.server) && opts.resolver) obj.domain_resolver = opts.resolver
  return obj
}
