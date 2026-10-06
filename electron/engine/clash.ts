// Клиент управляющего интерфейса sing-box (Clash API): состояние, трафик, задержка, DNS.
import { request } from 'node:http'

export interface ClashConnection {
  id: string
  metadata: { network?: string; type?: string; host?: string; destinationIP?: string; destinationPort?: string; processPath?: string }
  upload: number
  download: number
  start?: string
  chains: string[]
  rule?: string
  rulePayload?: string
}

export interface ClashSnapshot {
  downloadTotal: number
  uploadTotal: number
  connections: ClashConnection[]
}

export class ClashClient {
  constructor(private readonly port: number, private readonly secret: string) {}

  private get<T>(path: string, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port: this.port, path, method: 'GET', headers: { Authorization: `Bearer ${this.secret}` }, agent: false, timeout: timeoutMs },
        (res) => {
          let body = ''
          res.setEncoding('utf8')
          res.on('data', (c) => (body += c))
          res.on('end', () => {
            if ((res.statusCode ?? 0) >= 400) {
              let msg = body
              try { msg = (JSON.parse(body) as { message?: string }).message ?? body } catch { /* оставляем как есть */ }
              reject(new Error(`${res.statusCode}: ${msg}`))
              return
            }
            try { resolve(JSON.parse(body) as T) } catch (e) { reject(e) }
          })
        }
      )
      req.on('timeout', () => req.destroy(new Error('таймаут')))
      req.on('error', reject)
      req.end()
    })
  }

  version(timeoutMs = 1500): Promise<{ version: string }> {
    return this.get('/version', timeoutMs)
  }

  connections(timeoutMs = 2500): Promise<ClashSnapshot> {
    return this.get('/connections', timeoutMs)
  }

  /** Задержка до сайта через выбранное исходящее подключение. Бросает ошибку при неудаче. */
  async delay(tag: string, url: string, timeoutMs: number): Promise<number> {
    const q = `url=${encodeURIComponent(url)}&timeout=${Math.min(timeoutMs, 30000)}`
    const r = await this.get<{ delay: number }>(`/proxies/${encodeURIComponent(tag)}/delay?${q}`, timeoutMs + 2000)
    return r.delay
  }

  /** DNS-запрос через DNS-модуль самого sing-box. */
  dnsQuery(name: string, type = 'A', timeoutMs = 8000): Promise<{ Status: number; Answer?: Array<{ name: string; type: number; data: string }> }> {
    return this.get(`/dns/query?name=${encodeURIComponent(name)}&type=${type}`, timeoutMs)
  }
}
