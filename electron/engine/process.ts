// Запуск и остановка sing-box как отдельной программы. Свой сетевой код не пишем.
import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'

export interface EngineExit {
  code: number | null
  signal: string | null
}

const ANSI = /\x1b\[[0-9;]*m/g

export class SingBoxProcess extends EventEmitter {
  private proc: ChildProcess | null = null
  private tail = ''
  /** Последние строки журнала движка (без цветовых кодов). */
  readonly lines: string[] = []
  exited: EngineExit | null = null

  constructor(private readonly exe: string, private readonly configPath: string, private readonly cwd: string, private readonly maxLines = 3000) {
    super()
  }

  get pid(): number | undefined {
    return this.proc?.pid
  }

  start(): void {
    const proc = spawn(this.exe, ['run', '-c', this.configPath, '-D', this.cwd], {
      cwd: this.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    this.proc = proc
    const onData = (chunk: Buffer): void => {
      this.tail += chunk.toString('utf8')
      let nl: number
      while ((nl = this.tail.indexOf('\n')) !== -1) {
        const line = this.tail.slice(0, nl).replace(/\r$/, '').replace(ANSI, '')
        this.tail = this.tail.slice(nl + 1)
        if (line.trim()) this.push(line)
      }
    }
    proc.stdout!.on('data', onData)
    proc.stderr!.on('data', onData)
    proc.on('error', (err) => {
      this.push(`FATAL не удалось запустить движок: ${err.message}`)
      this.exited = { code: -1, signal: null }
      this.emit('exit', this.exited)
    })
    proc.on('exit', (code, signal) => {
      if (this.tail.trim()) this.push(this.tail.replace(ANSI, '').trim())
      this.tail = ''
      this.exited = { code, signal }
      this.emit('exit', this.exited)
    })
  }

  private push(line: string): void {
    this.lines.push(line)
    if (this.lines.length > this.maxLines) this.lines.splice(0, this.lines.length - this.maxLines)
    this.emit('line', line)
  }

  /** Последние n строк одним текстом — для разбора причины сбоя. */
  recent(n = 80): string {
    return this.lines.slice(-n).join('\n')
  }

  /** Останавливает движок. На Windows завершение жёсткое — система сама уберёт туннель и маршруты. */
  async stop(timeoutMs = 4000): Promise<void> {
    const p = this.proc
    if (!p || this.exited) return
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        try { p.kill('SIGKILL') } catch { /* уже завершён */ }
        resolve()
      }, timeoutMs)
      p.once('exit', () => {
        clearTimeout(t)
        resolve()
      })
      try { p.kill() } catch { clearTimeout(t); resolve() }
    })
  }
}
