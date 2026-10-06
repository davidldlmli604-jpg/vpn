import { abort } from '../errors'
import type { Outbound } from '../types'
import { compact, isTruthyFlag, splitList } from '../util/text'

type Query = Record<string, string>

const FINGERPRINTS = new Set([
  'chrome', 'firefox', 'edge', 'safari', 'ios', 'android', '360', 'qq', 'random', 'randomized'
])

/** Блок tls для sing-box из параметров ссылки (общий для vless / trojan / hysteria2 / tuic ...). */
export function buildTls(q: Query, opts: { serverHost: string; defaultOn?: boolean; alpnDefault?: string[] }): Outbound | undefined {
  const security = (q.security ?? q.tls ?? '').toLowerCase()
  const on = security === 'tls' || security === 'reality' || security === 'xtls' || security === '1' || security === 'true' || (security === '' && !!opts.defaultOn)
  if (!on) return undefined
  const isReality = security === 'reality'
  const sni = q.sni || q.peer || q.servername || (isReality ? '' : q.host) || ''
  const alpn = splitList(q.alpn).length ? splitList(q.alpn) : opts.alpnDefault
  const fp = (q.fp || q.fingerprint || '').toLowerCase()
  const insecure = isTruthyFlag(q.allowInsecure) || isTruthyFlag(q.insecure) || isTruthyFlag(q.allow_insecure) || isTruthyFlag(q['skip-cert-verify'])

  const tls: Outbound = compact({
    enabled: true,
    server_name: sni || undefined,
    insecure: insecure || undefined,
    alpn
  })
  if (isReality) {
    const pbk = q.pbk || q.publicKey || ''
    if (!pbk) abort('missing-secret', 'нет публичного ключа Reality (pbk)', 'Для Reality в ключе должен быть параметр pbk.')
    if (!/^[A-Za-z0-9_-]{40,50}$/.test(pbk)) abort('bad-secret', 'публичный ключ Reality (pbk) выглядит неверно')
    const sid = q.sid || q.shortId || ''
    if (sid && !/^[0-9a-fA-F]{0,16}$/.test(sid)) abort('bad-secret', 'короткий идентификатор Reality (sid) выглядит неверно')
    tls.reality = compact({ enabled: true, public_key: pbk, short_id: sid })
    tls.utls = { enabled: true, fingerprint: FINGERPRINTS.has(fp) ? fp : 'chrome' }
    if (!tls.server_name) abort('missing-host', 'нет имени сайта-прикрытия (sni) для Reality', 'Для Reality в ключе должен быть параметр sni.')
  } else if (fp && fp !== 'none' && FINGERPRINTS.has(fp)) {
    tls.utls = { enabled: true, fingerprint: fp }
  }
  return tls
}

function splitHosts(v: string | undefined): string[] {
  return splitList(v)
}

/** Блок transport для sing-box. Для обычного TCP возвращает undefined. */
export function buildTransport(q: Query, opts?: { netKey?: string }): Outbound | undefined {
  const net = (q[opts?.netKey ?? 'type'] || q.net || 'tcp').toLowerCase()
  const host = q.host || ''
  let path = q.path || ''

  switch (net) {
    case 'tcp':
    case 'raw': {
      const header = (q.headerType || '').toLowerCase()
      if (header === 'http') {
        return compact({ type: 'http', host: splitHosts(host), path: path || '/' })
      }
      return undefined
    }
    case 'ws':
    case 'websocket': {
      const t: Outbound = { type: 'ws' }
      const ed = /[?&]ed=(\d+)/.exec(path)
      if (ed) {
        t.max_early_data = Number(ed[1])
        t.early_data_header_name = 'Sec-WebSocket-Protocol'
        path = path.replace(/[?&]ed=\d+/, '')
      }
      if (path) t.path = path
      if (host) t.headers = { Host: host }
      return t
    }
    case 'grpc':
    case 'gun':
      return compact({ type: 'grpc', service_name: q.serviceName || q.service_name || path || undefined })
    case 'h2':
    case 'http':
      return compact({ type: 'http', host: splitHosts(host), path: path || '/' })
    case 'httpupgrade':
      return compact({ type: 'httpupgrade', host: host || undefined, path: path || '/' })
    case 'xhttp':
    case 'splithttp':
      return abort('unsupported-transport', 'xhttp', 'Способ подключения «xhttp» движок не поддерживает.')
    case 'kcp':
    case 'mkcp':
      return abort('unsupported-transport', 'kcp', 'Способ подключения «mKCP» движок не поддерживает.')
    case 'quic':
      return abort('unsupported-transport', 'quic', 'Способ подключения «QUIC-транспорт» движок не поддерживает.')
    case 'ds':
    case 'domainsocket':
      return abort('unsupported-transport', 'domainsocket')
    default:
      return abort('unsupported-transport', net)
  }
}
