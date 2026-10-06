import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer, request as httpRequest } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { singBoxPath } from './singbox'

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port
      srv.close(() => resolve(port))
    })
  })
}

export function tempDir(prefix = 'tropa-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

/** Самоподписанный сертификат для «localhost» — его выпускает сам sing-box. */
export function makeCert(dir: string): { certPath: string; keyPath: string } {
  const r = spawnSync(singBoxPath(), ['generate', 'tls-keypair', 'localhost', '-m', '12'], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('не удалось выпустить сертификат: ' + r.stderr)
  const key = /-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/.exec(r.stdout)![0]
  const cert = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/.exec(r.stdout)![0]
  const keyPath = join(dir, 'key.pem')
  const certPath = join(dir, 'cert.pem')
  writeFileSync(keyPath, key + '\n')
  writeFileSync(certPath, cert + '\n')
  return { certPath, keyPath }
}

export class Box {
  private proc: ChildProcess | null = null
  log = ''
  exited: number | null = null

  constructor(readonly name: string, private readonly config: unknown, private readonly dir: string) {}

  async start(timeoutMs = 10000): Promise<void> {
    const file = join(this.dir, `${this.name}.json`)
    writeFileSync(file, JSON.stringify(this.config, null, 2))
    const proc = spawn(singBoxPath(), ['run', '-c', file, '-D', this.dir], { stdio: ['ignore', 'pipe', 'pipe'] })
    this.proc = proc
    const onData = (d: Buffer): void => { this.log += d.toString() }
    proc.stdout!.on('data', onData)
    proc.stderr!.on('data', onData)
    proc.on('exit', (code) => { this.exited = code ?? -1 })
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      if (/sing-box started/.test(this.log)) return
      if (this.exited !== null) throw new Error(`${this.name}: sing-box завершился с кодом ${this.exited}\n${this.log}`)
      await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error(`${this.name}: не запустился за ${timeoutMs} мс\n${this.log}`)
  }

  async stop(): Promise<void> {
    const p = this.proc
    if (!p || this.exited !== null) return
    p.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => { p.kill('SIGKILL'); resolve() }, 3000)
      p.once('exit', () => { clearTimeout(t); resolve() })
    })
  }
}

/** «Интернет» для теста: маленький HTTP-сервер, который отвечает своим именем. */
export async function startTarget(reply: string): Promise<{ port: number; close: () => Promise<void> }> {
  const port = await freePort()
  const srv = createHttpServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(reply) })
  await new Promise<void>((r) => srv.listen(port, '127.0.0.1', r))
  return { port, close: () => new Promise<void>((r) => { srv.closeAllConnections?.(); srv.close(() => r()) }) }
}

/** Запрос через HTTP-прокси (наш mixed-вход): так делает браузер в режиме «системный прокси». */
export function httpViaProxy(proxyPort: number, url: string, timeoutMs = 8000): Promise<{ status: number; body: string }> {
  const u = new URL(url)
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: proxyPort, method: 'GET', path: url, headers: { Host: u.host, Connection: 'close' }, agent: false, timeout: timeoutMs }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (body += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    req.on('timeout', () => req.destroy(new Error('таймаут')))
    req.on('error', reject)
    req.end()
  })
}

/** «Чёрная дыра»: принимает соединения и молчит — так ведёт себя сервер, который завис. */
export async function startBlackHole(): Promise<{ port: number; close: () => Promise<void> }> {
  const sockets = new Set<import('node:net').Socket>()
  const srv = createNetServer((s) => {
    sockets.add(s)
    s.on('error', () => undefined)
    s.on('close', () => sockets.delete(s))
  })
  const port = await new Promise<number>((r) => srv.listen(0, '127.0.0.1', () => r((srv.address() as { port: number }).port)))
  return { port, close: () => new Promise<void>((r) => { for (const s of sockets) s.destroy(); srv.close(() => r()) }) }
}
