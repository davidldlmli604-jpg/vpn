// «Ваш адрес сейчас виден как…»: общие части для Windows и Android (без сетевого кода).
export interface ExitResult {
  ip: string | null
  countryCode: string | null
  countryName: string | null
  error: string | null
}

export const EXIT_SERVICES = ['https://api.country.is/', 'https://ipwho.is/']

let names: Intl.DisplayNames | null = null
export function countryNameRu(code: string): string {
  try {
    names ??= new Intl.DisplayNames(['ru'], { type: 'region' })
    return names.of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

export function parseExit(body: string): { ip: string | null; code: string | null } | null {
  try {
    const j = JSON.parse(body) as Record<string, unknown>
    const code = String(j.country_code ?? j.country ?? '').toUpperCase()
    const ip = typeof j.ip === 'string' ? j.ip : null
    if (/^[A-Z]{2}$/.test(code)) return { ip, code }
  } catch { /* не JSON */ }
  return null
}

