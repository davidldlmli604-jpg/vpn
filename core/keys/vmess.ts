import { abort } from '../errors'
import type { ParsedServer } from '../types'
import { base64ToText, compact, isTruthyFlag } from '../util/text'
import { normalizeServerPort, requireHostPort, splitShareLink } from './shareLink'
import { buildTls, buildTransport } from './tlsTransport'

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const VMESS_CIPHERS = new Set(['auto', 'none', 'zero', 'aes-128-gcm', 'chacha20-poly1305', 'aes-128-ctr'])

function str(v: unknown): string {
  return v === undefined || v === null ? '' : String(v).trim()
}

export function parseVmess(link: string): ParsedServer {
  const body = link.trim().slice('vmess://'.length)
  // Классический вид: vmess://base64({"v":"2","ps":"…","add":"…",…})
  const noFrag = body.split('#')[0] ?? ''
  const decoded = base64ToText(noFrag)
  if (decoded !== null && decoded.trim().startsWith('{')) return parseVmessJson(decoded, link)
  if (decoded === null && !noFrag.includes('@')) abort('bad-encoding', 'не base64')
  if (decoded !== null && !noFrag.includes('@')) abort('bad-json', 'внутри base64 не JSON')
  return parseVmessUrl(link)
}

function parseVmessJson(text: string, rawLink: string): ParsedServer {
  let j: Record<string, unknown>
  try {
    j = JSON.parse(text) as Record<string, unknown>
  } catch {
    return abort('bad-json', 'внутри ключа повреждённый JSON')
  }
  if (typeof j !== 'object' || j === null) abort('bad-json')
  const host = str(j.add)
  if (!host) abort('missing-host')
  if (j.port === undefined || str(j.port) === '') abort('missing-port')
  const port = normalizeServerPort(j.port)
  const uuid = str(j.id)
  if (!uuid) abort('missing-secret', 'нет идентификатора пользователя (UUID)')
  if (!UUID_RE.test(uuid)) abort('bad-secret', 'UUID записан неверно')
  const scy = str(j.scy).toLowerCase() || 'auto'
  if (!VMESS_CIPHERS.has(scy)) abort('unsupported-cipher', scy)
  const alterId = Number(str(j.aid) || '0')

  // Приводим поля v2rayN к тем же именам, что и у ссылок-«запросов», и используем общий код.
  const net = str(j.net).toLowerCase() || 'tcp'
  const q: Record<string, string> = {
    type: net,
    headerType: str(j.type),
    host: str(j.host),
    path: str(j.path),
    sni: str(j.sni),
    alpn: str(j.alpn),
    fp: str(j.fp)
  }
  if (net === 'grpc') q.serviceName = str(j.path)
  if (isTruthyFlag(str(j.allowInsecure)) || isTruthyFlag(str(j.insecure))) q.allowInsecure = '1'
  const tlsFlag = str(j.tls).toLowerCase()
  const tls = tlsFlag === 'tls' || tlsFlag === '1' ? buildTls({ ...q, security: 'tls', sni: q.sni || q.host }, { serverHost: host }) : undefined
  const transport = buildTransport(q)
  // для h2 в v2rayN host может быть списком через запятую — buildTransport уже режет по запятой

  const outbound = compact({
    type: 'vmess',
    server: host,
    server_port: port,
    uuid: uuid.toLowerCase(),
    security: scy,
    alter_id: Number.isFinite(alterId) && alterId > 0 ? alterId : 0,
    tls,
    transport
  })
  return { protocol: 'vmess', name: str(j.ps), host, port, outbound, rawLink: rawLink.trim(), warnings: [] }
}

/** Новый вид: vmess://uuid@host:port?encryption=auto&security=tls&type=ws... */
function parseVmessUrl(link: string): ParsedServer {
  const parts = splitShareLink(link)
  const { host, port } = requireHostPort(parts)
  const uuid = parts.userinfo.trim()
  if (!uuid) abort('missing-secret', 'нет идентификатора пользователя (UUID)')
  if (!UUID_RE.test(uuid)) abort('bad-secret', 'UUID записан неверно')
  const q = parts.query
  const scy = (q.encryption || q.scy || 'auto').toLowerCase()
  if (!VMESS_CIPHERS.has(scy)) abort('unsupported-cipher', scy)
  const tls = buildTls(q, { serverHost: host })
  const transport = buildTransport(q)
  const outbound = compact({ type: 'vmess', server: host, server_port: port, uuid: uuid.toLowerCase(), security: scy, alter_id: 0, tls, transport })
  return { protocol: 'vmess', name: parts.fragment, host, port, outbound, rawLink: link.trim(), warnings: [] }
}
