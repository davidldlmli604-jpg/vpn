// Мелкие помощники для работы с текстом без Node и без браузерных API.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_LOOKUP: Record<string, number> = {}
for (let i = 0; i < B64.length; i++) B64_LOOKUP[B64.charAt(i)] = i
B64_LOOKUP['-'] = 62 // вариант base64url
B64_LOOKUP['_'] = 63

/** Декодирует base64 (обычный и url-safe, с «=» и без) в байты. Возвращает null, если это не base64. */
export function base64ToBytes(input: string): Uint8Array | null {
  const s = input.replace(/[\s\r\n]+/g, '').replace(/=+$/, '')
  if (s.length === 0 || s.length % 4 === 1) return null
  const out: number[] = []
  let buffer = 0
  let bits = 0
  for (let i = 0; i < s.length; i++) {
    const v = B64_LOOKUP[s.charAt(i)]
    if (v === undefined) return null
    buffer = (buffer << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buffer >> bits) & 0xff)
      buffer &= (1 << bits) - 1
    }
  }
  return Uint8Array.from(out)
}

/** Байты → строка в UTF-8. null — если байты не являются корректным UTF-8. */
export function utf8Decode(bytes: Uint8Array): string | null {
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const b = bytes[i++]!
    let cp: number
    if (b < 0x80) cp = b
    else if (b >= 0xc2 && b <= 0xdf) {
      const b1 = bytes[i++]
      if (b1 === undefined || (b1 & 0xc0) !== 0x80) return null
      cp = ((b & 0x1f) << 6) | (b1 & 0x3f)
    } else if (b >= 0xe0 && b <= 0xef) {
      const b1 = bytes[i++]
      const b2 = bytes[i++]
      if (b1 === undefined || b2 === undefined || (b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80) return null
      cp = ((b & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f)
    } else if (b >= 0xf0 && b <= 0xf4) {
      const b1 = bytes[i++]
      const b2 = bytes[i++]
      const b3 = bytes[i++]
      if (b1 === undefined || b2 === undefined || b3 === undefined) return null
      if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80 || (b3 & 0xc0) !== 0x80) return null
      cp = ((b & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f)
    } else return null
    out += String.fromCodePoint(cp)
  }
  return out
}

/** base64 → текст UTF-8, либо null. */
export function base64ToText(input: string): string | null {
  const bytes = base64ToBytes(input)
  return bytes ? utf8Decode(bytes) : null
}

/** Разбор %XX без исключений: при ошибке возвращает исходную строку. */
export function safeDecodeURIComponent(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** Разбор запроса вида a=1&b=2 (значения раскодируются, «+» остаётся плюсом — так делают клиенты ключей). */
export function parseQuery(q: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!q) return out
  for (const part of q.split('&')) {
    if (!part) continue
    const eq = part.indexOf('=')
    const key = safeDecodeURIComponent(eq === -1 ? part : part.slice(0, eq))
    const val = eq === -1 ? '' : safeDecodeURIComponent(part.slice(eq + 1))
    if (!(key in out)) out[key] = val
  }
  return out
}

export function isTruthyFlag(v: string | undefined): boolean {
  if (v === undefined) return false
  const s = v.trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes' || s === 'on'
}

/** Выкидывает пустые значения из объекта, чтобы в конфиг не попадали "" и undefined. */
export function compact<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    out[k] = v
  }
  return out as T
}

export function splitList(v: string | undefined): string[] {
  if (!v) return []
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}
