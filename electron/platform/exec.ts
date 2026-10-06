import { execFile } from 'node:child_process'

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

/** Запуск внешней команды без окна и без оболочки; никогда не бросает исключение. */
export function run(file: string, args: string[], opts: { timeoutMs?: number; input?: string } = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = execFile(file, args, { windowsHide: true, timeout: opts.timeoutMs ?? 20000, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? ((err as unknown as { code: number }).code) : 1) : 0
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
    if (opts.input !== undefined && child.stdin) {
      child.stdin.end(opts.input)
    }
  })
}

export type Runner = typeof run

/** PowerShell без профиля и без вопросов; сценарий передаётся в кодировке, чтобы не мучиться с кавычками. */
export function powershellArgs(script: string): string[] {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]
}
