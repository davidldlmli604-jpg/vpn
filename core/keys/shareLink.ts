import { abort } from '../errors'
import { parseQuery, safeDecodeURIComponent } from '../util/text'

export interface ShareLinkParts {
  scheme: string
  /** Часть до «@» (логин:пароль или идентификатор), уже раскодированная. */
  userinfo: string
  host: string
  /** Все порты из адреса (обычно один); для диапазона вида 20000-30000 берётся его начало. */
  ports: number[]
  /** Те же порты в исходной записи («443», «20000-30000»). */
  portSpecs: string[]
  path: string
  query: Record<string, string>
  fragment: string
}

const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//

/**
 * Свой терпимый разбор ссылки. Стандартный URL капризен к ключам: ломается на «лишних» символах
 * в пароле и на нестандартных схемах, а ключи в реальности часто «грязные».
 */
export function splitShareLink(link: string): ShareLinkParts {
  const text = link.trim()
  const m = SCHEME_RE.exec(text)
  if (!m) abort('broken', 'нет схемы')
  const scheme = m[1]!.toLowerCase()
  let rest = text.slice(m[0].length)

  let fragment = ''
  const hashAt = rest.indexOf('#')
  if (hashAt !== -1) {
    fragment = safeDecodeURIComponent(rest.slice(hashAt + 1))
    rest = rest.slice(0, hashAt)
  }
  let queryString = ''
  const qAt = rest.indexOf('?')
  if (qAt !== -1) {
    queryString = rest.slice(qAt + 1)
    rest = rest.slice(0, qAt)
  }
  let path = ''
  // userinfo может содержать «/», если пароль не закодирован, поэтому ищем путь после последней «@»
  const atAt = rest.lastIndexOf('@')
  const slashAt = rest.indexOf('/', atAt === -1 ? 0 : atAt)
  if (slashAt !== -1) {
    path = rest.slice(slashAt)
    rest = rest.slice(0, slashAt)
  }
  let userinfo = ''
  let hostPort = rest
  if (atAt !== -1) {
    userinfo = safeDecodeURIComponent(rest.slice(0, atAt))
    hostPort = rest.slice(atAt + 1)
  }

  let host = ''
  let portPart = ''
  if (hostPort.startsWith('[')) {
    const close = hostPort.indexOf(']')
    if (close === -1) abort('broken', 'не закрыта скобка в адресе IPv6')
    host = hostPort.slice(1, close)
    const after = hostPort.slice(close + 1)
    if (after.startsWith(':')) portPart = after.slice(1)
    else if (after !== '') abort('broken', 'лишние символы после адреса')
  } else {
    const colon = hostPort.lastIndexOf(':')
    if (colon === -1) host = hostPort
    else {
      host = hostPort.slice(0, colon)
      portPart = hostPort.slice(colon + 1)
    }
  }
  host = safeDecodeURIComponent(host).trim()

  const ports: number[] = []
  const portSpecs: string[] = []
  if (portPart) {
    for (const piece of portPart.split(',')) {
      const p = piece.trim()
      if (!/^\d{1,5}(-\d{1,5})?$/.test(p)) abort('bad-port', `порт «${p.slice(0, 12)}»`)
      const n = Number(p.split('-')[0])
      if (n < 1 || n > 65535) abort('bad-port', `порт ${n}`)
      ports.push(n)
      portSpecs.push(p)
    }
  }

  return { scheme, userinfo, host, ports, portSpecs, path, query: parseQuery(queryString), fragment }
}

/** Адрес и порт обязательны почти для всех типов ключей. */
export function requireHostPort(parts: ShareLinkParts): { host: string; port: number } {
  if (!parts.host) abort('missing-host')
  const port = parts.ports[0]
  if (port === undefined) abort('missing-port')
  if (parts.portSpecs[0]!.includes('-')) abort('bad-port', 'диапазон вместо порта')
  return { host: parts.host, port }
}

export function normalizeServerPort(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (!Number.isInteger(n) || n < 1 || n > 65535) abort('bad-port', `порт ${String(value).slice(0, 12)}`)
  return n
}
