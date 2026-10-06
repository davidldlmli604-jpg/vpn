import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const ROOT = resolve(__dirname, '..', '..')
export const RULES_DIR = join(ROOT, 'resources', 'rules')

export function singBoxPath(): string {
  const fromEnv = process.env.SINGBOX_BIN
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  const exe = process.platform === 'win32' ? 'sing-box.exe' : 'sing-box'
  const p = join(ROOT, 'bin', `${process.platform}-${process.arch}`, exe)
  if (!existsSync(p)) {
    throw new Error(`Не найден sing-box (${p}). Выполните: npm run fetch:singbox`)
  }
  return p
}

export interface CheckResult {
  ok: boolean
  output: string
}

/** Прогоняет конфиг через настоящую проверку движка: `sing-box check -c файл`. */
export function singBoxCheck(config: unknown): CheckResult {
  const dir = mkdtempSync(join(tmpdir(), 'tropa-check-'))
  try {
    const file = join(dir, 'config.json')
    writeFileSync(file, JSON.stringify(config, null, 2))
    const r = spawnSync(singBoxPath(), ['check', '-c', file], { encoding: 'utf8', cwd: dir, timeout: 30000 })
    return { ok: r.status === 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
