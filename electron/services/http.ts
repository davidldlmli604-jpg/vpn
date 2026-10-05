// Минимальная загрузка по http/https. Умеет ходить через локальный прокси программы (CONNECT),
// чтобы запрос к «своим» службам при необходимости шёл через VPN. Никакой телеметрии: адреса — только из списка разрешённых.
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { connect as tlsConnect } from 'node:tls'

export interface HttpResult {
  status: number
  headers: IncomingHttpHeaders
  body: Buffer
}

export interface HttpOptions {
  timeoutMs?: number
  headers?: Record<string, string>
  /** Порт локального прокси (наш mixed-вход). Если задан, запрос идёт через него. */
  proxyPort?: number
  maxBytes?: number
  maxRedirects?: number
  method?: 'GET' | 'HEAD'
}

export class HttpError extends Error {
  constructor(message: string, public readonly kind: 'timeout' | 'network' | 'status' | 'too-large' | 'bad-url', public readonly status?: number) {
    super(message)
  }
}

export function httpGet(url: string, opts: HttpOptions = {}): Promise<HttpResult> {
  return doGet(url, opts, opts.maxRedirects ?? 4)
}

function doGet(url: string, opts: HttpOptions, redirectsLeft: number): Promise<HttpResult> {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return Promise.reject(new HttpError('Некорректный адрес', 'bad-url'))
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return Promise.reject(new HttpError('Поддерживаются только http и https', 'bad-url'))
  const timeoutMs = opts.timeoutMs ?? 15000
  const maxBytes = opts.maxBytes ?? 8 * 1024 * 1024
  const headers = { 'User-Agent': 'Mozilla/5.0', Accept: '*/*', ...(opts.headers ?? {}) }

  return new Promise<HttpResult>((resolve, reject) => {
    let settled = false
    const done = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(overall)
      fn()
    }
    const overall = setTimeout(() => done(() => reject(new HttpError('Время ожидания истекло', 'timeout'))), timeoutMs + 2000)

    const handle = (res: import('node:http').IncomingMessage): void => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume()
        const next = new URL(res.headers.location, u).toString()
        doGet(next, opts, redirectsLeft - 1).then((r) => done(() => resolve(r)), (e) => done(() => reject(e)))
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (c: Buffer) => {
        size += c.length
        if (size > maxBytes) {
          res.destroy()
          done(() => reject(new HttpError('Ответ слишком большой', 'too-large')))
          return
        }
        chunks.push(c)
      })
      res.on('end', () => done(() => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) })))
      res.on('error', (e) => done(() => reject(new HttpError(e.message, 'network'))))
    }
    const onErr = (e: Error): void => done(() => reject(e instanceof HttpError ? e : new HttpError(e.message, /timeout|таймаут/i.test(e.message) ? 'timeout' : 'network')))

    if (opts.proxyPort) {
      const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80)
      if (u.protocol === 'http:') {
        // обычный http через прокси: запрос с полным адресом
        const req = httpRequest({ host: '127.0.0.1', port: opts.proxyPort, method: opts.method ?? 'GET', path: url, headers: { ...headers, Host: u.host }, agent: false, timeout: timeoutMs }, handle)
        req.on('timeout', () => req.destroy(new Error('таймаут')))
        req.on('error', onErr)
        req.end()
        return
      }
      const connectReq = httpRequest({ host: '127.0.0.1', port: opts.proxyPort, method: 'CONNECT', path: `${u.hostname}:${port}`, headers: { Host: `${u.hostname}:${port}` }, agent: false, timeout: timeoutMs })
      connectReq.on('timeout', () => connectReq.destroy(new Error('таймаут')))
      connectReq.on('error', onErr)
      connectReq.on('connect', (cres, socket) => {
        if (cres.statusCode !== 200) {
          socket.destroy()
          done(() => reject(new HttpError(`Прокси ответил ${cres.statusCode}`, 'network')))
          return
        }
        socket.on('error', onErr)
        const tlsSocket = tlsConnect({ socket, servername: u.hostname })
        // без этого обработчика ошибка шифрования (например, сервер ответил не по-шифрованному) обрушила бы всю программу
        tlsSocket.on('error', (e) => { onErr(e); socket.destroy() })
        tlsSocket.setTimeout(timeoutMs, () => { onErr(new Error('таймаут')); tlsSocket.destroy() })
        const req = httpsRequest({ host: u.hostname, method: opts.method ?? 'GET', path: u.pathname + u.search, headers: { ...headers, Host: u.host }, createConnection: () => tlsSocket, agent: false, timeout: timeoutMs }, handle)
        req.on('timeout', () => req.destroy(new Error('таймаут')))
        req.on('error', onErr)
        req.end()
      })
      connectReq.end()
      return
    }

    const req = (u.protocol === 'https:' ? httpsRequest : httpRequest)(u, { method: opts.method ?? 'GET', headers, agent: false, timeout: timeoutMs }, handle)
    req.on('timeout', () => req.destroy(new Error('таймаут')))
    req.on('error', onErr)
    req.end()
  })
}

/** Загрузка: сначала напрямую, а если не вышло и есть работающий прокси программы — через него. */
export async function httpGetWithFallback(url: string, opts: HttpOptions, proxyPort: number | null): Promise<HttpResult> {
  try {
    return await httpGet(url, { ...opts, proxyPort: undefined })
  } catch (e) {
    if (!proxyPort) throw e
    return httpGet(url, { ...opts, proxyPort })
  }
}
