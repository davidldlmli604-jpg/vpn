import { toAsciiDomain } from './util/punycode'

export interface NormalizedList {
  /** Домены (с поддоменами) — идут в domain_suffix. */
  domains: string[]
  /** Адреса и сети — идут в ip_cidr. */
  cidrs: string[]
  /** Что не удалось понять (для подсказки человеку). */
  invalid: string[]
}

const LABEL_RE = /^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?$/
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/

function ipv4ToCidr(s: string): string | null {
  const m = IPV4_RE.exec(s)
  if (!m) return null
  for (let i = 1; i <= 4; i++) if (Number(m[i]) > 255) return null
  const bits = m[5] === undefined ? 32 : Number(m[5])
  if (bits > 32) return null
  return `${m[1]}.${m[2]}.${m[3]}.${m[4]}/${bits}`
}

function ipv6ToCidr(s: string): string | null {
  const [addr, bitsRaw] = s.split('/')
  if (!addr || !addr.includes(':') || !/^[0-9a-f:.]+$/i.test(addr)) return null
  if (addr.split('::').length > 2) return null
  const bits = bitsRaw === undefined ? 128 : Number(bitsRaw)
  if (!Number.isInteger(bits) || bits < 0 || bits > 128) return null
  return `${addr.toLowerCase()}/${bits}`
}

/** Превращает то, что человек набрал в поле («https://www.site.ru/page», «*.site.ru», «1.2.3.4»), в строгие правила. */
export function normalizeRuleList(input: string | string[]): NormalizedList {
  const pieces = (Array.isArray(input) ? input : [input]).flatMap((s) => s.split(/[\s,;]+/)).map((s) => s.trim()).filter(Boolean)
  const domains: string[] = []
  const cidrs: string[] = []
  const invalid: string[] = []
  for (const raw of pieces) {
    let s = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '') // схема
    s = s.replace(/[/?#].*$/, '') // путь и запрос (для CIDR хвост /24 разберём отдельно ниже)
    const cidrCandidate = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[?#].*$/, '')
    const v4 = ipv4ToCidr(cidrCandidate)
    if (v4) { cidrs.push(v4); continue }
    const v6 = ipv6ToCidr(cidrCandidate.replace(/^\[|\]$/g, ''))
    if (v6) { cidrs.push(v6); continue }
    s = s.replace(/^[^@]*@/, '').replace(/:\d+$/, '') // логин и порт
    s = s.replace(/^\*\./, '').replace(/^\./, '').replace(/\.$/, '')
    s = s.toLowerCase()
    s = s.replace(/^www\./, '')
    if (!s) { invalid.push(raw); continue }
    let ascii: string
    try { ascii = toAsciiDomain(s) } catch { invalid.push(raw); continue }
    const labels = ascii.split('.')
    if (ascii.length > 253 || labels.some((l) => l.length === 0 || l.length > 63 || !LABEL_RE.test(l))) { invalid.push(raw); continue }
    domains.push(ascii)
  }
  const uniq = (a: string[]): string[] => Array.from(new Set(a))
  return { domains: uniq(domains), cidrs: uniq(cidrs), invalid: uniq(invalid) }
}
