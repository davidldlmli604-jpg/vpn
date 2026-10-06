// Одна копия программы. Стандартная защита Electron от второго запуска не умеет «достучаться» от обычной копии
// до копии с правами администратора (Windows не пускает сообщения «вниз по уровню защиты»). Поэтому первая копия
// слушает локальный порт (только 127.0.0.1) и записывает его вместе с секретным словом в файл в папке данных.
// Вторая копия читает файл, шлёт «покажись» и закрывается. Через сеть это недоступно: порт только внутри компьютера.
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, connect, type Server } from 'node:net'
import { join } from 'node:path'

const FILE = 'control.json'

interface ControlInfo {
  port: number
  token: string
  pid: number
}

function readInfo(dir: string): ControlInfo | null {
  try {
    const j = JSON.parse(readFileSync(join(dir, FILE), 'utf8')) as ControlInfo
    return Number.isInteger(j.port) && typeof j.token === 'string' ? j : null
  } catch {
    return null
  }
}

/** Просит уже запущенную копию показать окно. true — такая копия есть и отозвалась. */
export function notifyExisting(dir: string, timeoutMs = 1200): Promise<boolean> {
  const info = readInfo(dir)
  if (!info) return Promise.resolve(false)
  return new Promise((resolve) => {
    let done = false
    const finish = (v: boolean): void => {
      if (done) return
      done = true
      sock.destroy()
      resolve(v)
    }
    const sock = connect({ host: '127.0.0.1', port: info.port })
    sock.setTimeout(timeoutMs, () => finish(false))
    sock.on('error', () => finish(false))
    sock.on('connect', () => sock.write(`show ${info.token}\n`))
    sock.on('data', (d) => finish(String(d).startsWith('ok')))
    sock.on('close', () => finish(false))
  })
}

/** Ждёт, пока прежняя копия исчезнет (нужно новой копии с правами администратора). */
export async function waitUntilFree(dir: string, maxMs: number): Promise<void> {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    if (!(await notifyExistingProbe(dir))) return
    await new Promise((r) => setTimeout(r, 250))
  }
}

/** Проверка «жива ли прежняя копия» без показа окна. */
function notifyExistingProbe(dir: string): Promise<boolean> {
  const info = readInfo(dir)
  if (!info) return Promise.resolve(false)
  return new Promise((resolve) => {
    const s = connect({ host: '127.0.0.1', port: info.port })
    s.setTimeout(600, () => { s.destroy(); resolve(false) })
    s.on('connect', () => { s.destroy(); resolve(true) })
    s.on('error', () => resolve(false))
  })
}

export interface ControlHandle {
  close(): void
}

/** Запускает «слушателя» первой копии. onShow вызывается, когда вторая копия просит показать окно. */
export function startControl(dir: string, onShow: () => void): Promise<ControlHandle> {
  const token = randomBytes(16).toString('hex')
  return new Promise((resolve, reject) => {
    const server: Server = createServer((sock) => {
      sock.setTimeout(2000, () => sock.destroy())
      sock.on('error', () => undefined)
      sock.on('data', (d) => {
        if (String(d).trim() === `show ${token}`) {
          sock.end('ok\n')
          try { onShow() } catch { /* окно могло быть уничтожено */ }
        } else sock.destroy()
      })
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      writeFileSync(join(dir, FILE), JSON.stringify({ port, token, pid: process.pid } satisfies ControlInfo), { mode: 0o600 })
      resolve({
        close: () => {
          server.close()
          try {
            if (existsSync(join(dir, FILE)) && readInfo(dir)?.token === token) rmSync(join(dir, FILE), { force: true })
          } catch { /* ничего */ }
        }
      })
    })
  })
}
