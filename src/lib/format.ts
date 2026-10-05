const UNITS = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']

/** 1536 → { value: '1,5', unit: 'КБ' } */
export function splitBytes(n: number, perSecond = false): { value: string; unit: string } {
  let v = Math.max(0, n)
  let i = 0
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024
    i++
  }
  const digits = v >= 100 || i === 0 ? 0 : v >= 10 ? 1 : 2
  return { value: v.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }), unit: UNITS[i]! + (perSecond ? '/с' : '') }
}

export function formatBytes(n: number): string {
  const { value, unit } = splitBytes(n)
  return `${value} ${unit}`
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const p = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`
}

export function latencyClass(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return ''
  if (ms < 150) return 'latency-good'
  if (ms < 400) return 'latency-mid'
  return 'latency-bad'
}

const regionNames = (() => {
  try { return new Intl.DisplayNames(['ru'], { type: 'region' }) } catch { return null }
})()

export function countryName(code: string | null | undefined): string {
  if (!code) return 'Неизвестно'
  try { return regionNames?.of(code.toUpperCase()) ?? code } catch { return code }
}

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b > 1 && b < 5) return few
  if (b === 1) return one
  return many
}

const PROTOCOL_LABELS: Record<string, string> = {
  vless: 'VLESS', vmess: 'VMess', trojan: 'Trojan', shadowsocks: 'Shadowsocks', hysteria2: 'Hysteria2', tuic: 'TUIC', anytls: 'AnyTLS'
}

/** Как показывать тип подключения: «Shadowsocks», а не «SHADOWSOCKS». */
export function protocolLabel(p: string): string {
  return PROTOCOL_LABELS[p.toLowerCase()] ?? p
}
