// Проверка связи «как это делает браузер»: обычный запрос к крошечной странице через локальный вход прокси.
// Если ответ пришёл — весь путь (вход → правила → сервер → интернет) работает. Время ответа — задержка.
import { request } from 'node:http'

/** Крошечные страницы-«204», которые используются повсеместно для проверки связи (обычный http, без шифрования лишний раз). */
export const PROBE_URLS = [
  'http://cp.cloudflare.com/generate_204',
  'http://www.gstatic.com/generate_204',
  'http://connectivitycheck.gstatic.com/generate_204'
]

/** Возвращает задержку в миллисекундах или бросает ошибку. */
export function httpProbe(proxyPort: number, url: string, timeoutMs: number): Promise<number> {
  const u = new URL(url)
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint()
    const req = request(
      { host: '127.0.0.1', port: proxyPort, method: 'GET', path: url, headers: { Host: u.host, Connection: 'close', 'User-Agent': 'probe' }, agent: false, timeout: timeoutMs },
      (res) => {
        const status = res.statusCode ?? 0
        res.resume()
        res.on('end', () => {
          const ms = Number((process.hrtime.bigint() - started) / 1_000_000n)
          if (status > 0 && status < 500) resolve(Math.max(1, ms))
          else reject(new Error(`ответ ${status}`))
        })
        res.on('error', reject)
      }
    )
    req.on('timeout', () => req.destroy(new Error('таймаут')))
    req.on('error', reject)
    req.end()
  })
}

/** Пробует адреса по очереди, возвращает лучший результат или null. */
export async function probeAny(proxyPort: number, urls: string[], timeoutMs: number): Promise<number | null> {
  for (const url of urls) {
    try {
      return await httpProbe(proxyPort, url, timeoutMs)
    } catch { /* пробуем следующий */ }
  }
  return null
}
