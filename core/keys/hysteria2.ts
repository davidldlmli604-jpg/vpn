import { abort } from '../errors'
import type { ParsedServer } from '../types'
import { compact, isTruthyFlag, splitList } from '../util/text'
import { splitShareLink } from './shareLink'

/** «20000-30000» → «20000:30000» (так хочет sing-box). */
function portRange(piece: string): string | undefined {
  const m = /^(\d{1,5})(?:[-:](\d{1,5}))?$/.exec(piece.trim())
  if (!m) return undefined
  const a = Number(m[1])
  const b = m[2] === undefined ? a : Number(m[2])
  if (a < 1 || a > 65535 || b < 1 || b > 65535 || b < a) return undefined
  return `${a}:${b}`
}

export function parseHysteria2(link: string): ParsedServer {
  // hy2:// — короткая запись той же схемы
  const normalized = link.trim().replace(/^hy2:\/\//i, 'hysteria2://')
  const parts = splitShareLink(normalized)
  if (!parts.host) abort('missing-host')
  const q = parts.query
  const mport = q.mport || q.ports || ''
  // порты могут идти и в адресе: hysteria2://pass@host:443,20000-30000
  const firstSpec = parts.portSpecs[0]
  const port = firstSpec !== undefined && !firstSpec.includes('-') ? parts.ports[0] : undefined
  const extraSpecs = parts.portSpecs.slice(port === undefined ? 0 : 1)
  const ranges = [...extraSpecs, ...splitList(mport)].map(portRange)
  if (ranges.some((r) => r === undefined)) abort('bad-port', 'диапазон портов (mport)')
  if (port === undefined && ranges.length === 0) abort('missing-port')
  const password = parts.userinfo
  if (!password) abort('missing-secret', 'нет пароля')

  const warnings: string[] = []
  const insecure = isTruthyFlag(q.insecure) || isTruthyFlag(q.allowInsecure) || isTruthyFlag(q.allow_insecure)
  if (q.pinSHA256) {
    warnings.push('В ключе задан отпечаток сертификата (pinSHA256). Движок такую проверку не поддерживает, поэтому подключение будет работать, только если у сервера обычный сертификат.')
  }
  const alpn = splitList(q.alpn)
  const tls = compact({
    enabled: true,
    server_name: q.sni || q.peer || undefined,
    insecure: insecure || undefined,
    alpn: alpn.length ? alpn : ['h3']
  })
  const obfsType = (q.obfs || '').toLowerCase()
  let obfs: Record<string, unknown> | undefined
  if (obfsType) {
    if (obfsType !== 'salamander') abort('unsupported-feature', `obfs ${obfsType}`, 'Такой вариант маскировки (obfs) движок не поддерживает.')
    const op = q['obfs-password'] || q.obfs_password || ''
    if (!op) abort('missing-secret', 'нет пароля маскировки (obfs-password)')
    obfs = { type: 'salamander', password: op }
  }
  const mbps = (v: string | undefined): number | undefined => {
    if (!v) return undefined
    const m = /^(\d+(?:\.\d+)?)/.exec(v.trim())
    return m ? Math.round(Number(m[1])) : undefined
  }

  const effectivePort = port ?? Number(ranges[0]!.split(':')[0])
  const outbound = compact({
    type: 'hysteria2',
    server: parts.host,
    server_port: effectivePort,
    server_ports: ranges.length ? (ranges as string[]) : undefined,
    password,
    obfs,
    up_mbps: mbps(q.up) || mbps(q.upmbps),
    down_mbps: mbps(q.down) || mbps(q.downmbps),
    tls
  })
  return { protocol: 'hysteria2', name: parts.fragment, host: parts.host, port: effectivePort, outbound, rawLink: link.trim(), warnings }
}
