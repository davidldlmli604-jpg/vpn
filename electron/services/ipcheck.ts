// «Ваш адрес сейчас виден как…»: узнаём, под какой страной нас видит интернет.
// Это единственный запрос к стороннему сервису; проходит через VPN, чтобы показать именно выходной адрес.
import { httpGet } from './http'

export interface ExitResult {
  ip: string | null
  countryCode: string | null
  countryName: string | null
  error: string | null
}

const SERVICES = ['https://api.country.is/', 'https://ipwho.is/']

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

/** proxyPort — порт нашего локального прокси; запрос пойдёт через сервер. */
export async function fetchExitInfo(proxyPort: number | null, get: typeof httpGet = httpGet): Promise<ExitResult> {
  let lastErr = 'нет ответа'
  for (const url of SERVICES) {
    try {
      const r = await get(url, { timeoutMs: 10000, proxyPort: proxyPort ?? undefined, maxBytes: 64 * 1024, headers: { Accept: 'application/json' } })
      if (r.status !== 200) throw new Error(`HTTP ${r.status}`)
      const p = parseExit(r.body.toString('utf8'))
      if (!p || !p.code) throw new Error('непонятный ответ')
      return { ip: p.ip, countryCode: p.code, countryName: countryNameRu(p.code), error: null }
    } catch (e) {
      lastErr = (e as Error).message
    }
  }
  return { ip: null, countryCode: null, countryName: null, error: `Не удалось определить адрес (${lastErr})` }
}

/** Страна произвольного адреса (нужна для проверки DNS). */
export async function countryOfIp(ip: string, proxyPort: number | null, get: typeof httpGet = httpGet): Promise<string | null> {
  if (!/^[0-9a-fA-F:.]+$/.test(ip)) return null
  try {
    const r = await get(`https://api.country.is/${ip}`, { timeoutMs: 10000, proxyPort: proxyPort ?? undefined, maxBytes: 16 * 1024 })
    return parseExit(r.body.toString('utf8'))?.code ?? null
  } catch {
    return null
  }
}
