// Перевод доменных имён с русскими буквами в «технический» вид (рф → xn--p1ai).
// Алгоритм из RFC 3492. Нужен, потому что sing-box понимает только латинский вид.

const BASE = 36
const T_MIN = 1
const T_MAX = 26
const SKEW = 38
const DAMP = 700
const INITIAL_BIAS = 72
const INITIAL_N = 128

function adapt(delta: number, numPoints: number, first: boolean): number {
  delta = first ? Math.floor(delta / DAMP) : delta >> 1
  delta += Math.floor(delta / numPoints)
  let k = 0
  while (delta > ((BASE - T_MIN) * T_MAX) >> 1) {
    delta = Math.floor(delta / (BASE - T_MIN))
    k += BASE
  }
  return k + Math.floor(((BASE - T_MIN + 1) * delta) / (delta + SKEW))
}

function digit(d: number): string {
  return String.fromCharCode(d < 26 ? d + 97 : d + 22)
}

function encodeLabel(input: string): string {
  const cps = Array.from(input).map((c) => c.codePointAt(0)!)
  let n = INITIAL_N
  let delta = 0
  let bias = INITIAL_BIAS
  let out = ''
  for (const cp of cps) if (cp < 0x80) out += String.fromCharCode(cp)
  const basicLen = out.length
  let handled = basicLen
  if (basicLen > 0) out += '-'
  while (handled < cps.length) {
    let m = Infinity
    for (const cp of cps) if (cp >= n && cp < m) m = cp
    delta += (m - n) * (handled + 1)
    n = m
    for (const cp of cps) {
      if (cp < n) delta++
      if (cp === n) {
        let q = delta
        for (let k = BASE; ; k += BASE) {
          const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias
          if (q < t) break
          out += digit(t + ((q - t) % (BASE - t)))
          q = Math.floor((q - t) / (BASE - t))
        }
        out += digit(q)
        bias = adapt(delta, handled + 1, handled === basicLen)
        delta = 0
        handled++
      }
    }
    delta++
    n++
  }
  return out
}

/** «пример.рф» → «xn--e1afmkfd.xn--p1ai». Уже латинские имена не меняются. */
export function toAsciiDomain(domain: string): string {
  return domain
    .split('.')
    .map((label) => (/^[\x00-\x7f]*$/.test(label) ? label : 'xn--' + encodeLabel(label.normalize('NFC'))))
    .join('.')
}
