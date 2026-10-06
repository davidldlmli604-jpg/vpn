// «Куда на самом деле пошёл запрос?»: делаем обычный запрос через наш локальный вход, затем открываем туннель к тому же узлу
// и, пока он открыт, спрашиваем у движка, каким выходом он обработан (direct — напрямую, proxy — через VPN-сервер).
import { request } from 'node:http'
import type { ClashClient } from './clash'

export interface RouteProbe {
  /** Сколько миллисекунд занял ответ; null — ответа не было. */
  ms: number | null
  /** Каким выходом обработан запрос: 'direct' | 'proxy' | …; null — определить не удалось. */
  chain: string | null
  error?: string
}

/** Держит туннель (CONNECT) к узлу открытым, пока не вызовут stop — такое соединение движок всегда показывает в списке. */
function holdTunnel(proxyPort: number, host: string, port: number, timeoutMs: number): Promise<{ stop: () => void } | null> {
  return new Promise((resolve) => {
    const req = request({ host: '127.0.0.1', port: proxyPort, method: 'CONNECT', path: `${host}:${port}`, headers: { Host: `${host}:${port}` }, agent: false, timeout: timeoutMs })
    const done = (v: { stop: () => void } | null): void => resolve(v)
    req.on('connect', (res, socket) => {
      socket.on('error', () => undefined)
      if (res.statusCode !== 200) { socket.destroy(); done(null); return }
      done({ stop: () => socket.destroy() })
    })
    req.on('timeout', () => { req.destroy(); done(null) })
    req.on('error', () => done(null))
    req.end()
  })
}

export async function probeRoute(proxyPort: number, clash: ClashClient, url: string, timeoutMs = 8000): Promise<RouteProbe> {
  const u = new URL(url)
  const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80)
  // 1) время ответа: обычный запрос, как у браузера
  let ms: number
  try {
    ms = await new Promise<number>((resolve, reject) => {
      const started = process.hrtime.bigint()
      const req = request(
        { host: '127.0.0.1', port: proxyPort, method: 'GET', path: url, headers: { Host: u.host, 'User-Agent': 'probe', Connection: 'close' }, agent: false, timeout: timeoutMs },
        (res) => {
          const status = res.statusCode ?? 0
          res.resume()
          res.on('end', () => {
            if (status > 0 && status < 500) resolve(Math.max(1, Number((process.hrtime.bigint() - started) / 1_000_000n)))
            else reject(new Error(`ответ ${status}`))
          })
          res.on('error', reject)
        }
      )
      req.on('timeout', () => req.destroy(new Error('таймаут')))
      req.on('error', reject)
      req.end()
    })
  } catch (e) {
    return { ms: null, chain: null, error: (e as Error).message }
  }
  // 2) маршрут: открываем туннель к тому же узлу и держим его, пока смотрим в список соединений движка
  const tunnel = await holdTunnel(proxyPort, u.hostname, port, Math.min(timeoutMs, 4000))
  let chain: string | null = null
  try {
    for (let i = 0; i < 8 && chain === null && tunnel; i++) {
      try {
        const snap = await clash.connections(1500)
        const hit = snap.connections.find((c) => (c.metadata.host ?? '').toLowerCase() === u.hostname.toLowerCase())
        if (hit && hit.chains.length) chain = hit.chains[0]!
      } catch { /* движок мог быть занят — попробуем ещё раз */ }
      if (chain === null) await new Promise((r) => setTimeout(r, 120))
    }
  } finally {
    tunnel?.stop()
  }
  return { ms, chain }
}
