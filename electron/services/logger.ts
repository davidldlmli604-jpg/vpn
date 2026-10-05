// Журнал приложения. Все строки проходят через очистку: ключи, пароли и идентификаторы на экран и в файл не попадают.
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { redactLogLine } from '../../core'

export class AppLog {
  private lines: string[] = []
  private readonly max = 2000
  onLine: (line: string) => void = () => undefined

  constructor(private readonly file: string | null) {
    if (file) mkdirSync(dirname(file), { recursive: true })
  }

  add(text: string, source: 'app' | 'engine' = 'app'): void {
    const clean = redactLogLine(text)
    const stamp = new Date().toLocaleTimeString('ru-RU', { hour12: false })
    const line = `${stamp} ${source === 'engine' ? '[движок]' : '[программа]'} ${clean}`
    this.lines.push(line)
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max)
    this.onLine(line)
    if (this.file) {
      try {
        if (existsSync(this.file) && statSync(this.file).size > 1_000_000) renameSync(this.file, this.file + '.old')
        appendFileSync(this.file, `${new Date().toISOString()} ${line}\n`)
      } catch { /* журнал не должен ронять программу */ }
    }
  }

  get all(): string[] {
    return this.lines.slice()
  }

  clear(): void {
    this.lines = []
  }
}
