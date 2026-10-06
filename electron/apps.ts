// Список программ для «Мимо VPN»: запущенные сейчас и установленные (по ярлыкам меню «Пуск»).
import { existsSync, readdirSync, readlinkSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { RunningApp } from '../shared/types'
import { powershellArgs, run, type Runner } from './platform/exec'

export interface RawApp {
  name: string
  path: string
}

const SYSTEM_DIRS = [/^[a-z]:\\windows\\/i, /^[a-z]:\\program files\\windowsapps\\/i]
const SKIP_NAMES = /^(unins\d*|uninstall|setup|install|update|updater|crashpad_handler|conhost|rundll32|msiexec)\.exe$/i

/** Убирает системные процессы, деинсталляторы и повторы; сортирует по названию. */
export function cleanApps(list: RawApp[], opts: { selfExe?: string; platform?: NodeJS.Platform } = {}): RawApp[] {
  const win = (opts.platform ?? process.platform) === 'win32'
  const seen = new Set<string>()
  const out: RawApp[] = []
  for (const a of list) {
    if (!a.path || (win && !/\.exe$/i.test(a.path))) continue
    const exe = basename(a.path.replace(/\\/g, '/'))
    if (SKIP_NAMES.test(exe)) continue
    if (win && SYSTEM_DIRS.some((re) => re.test(a.path))) continue
    if (opts.selfExe && a.path.toLowerCase() === opts.selfExe.toLowerCase()) continue
    const key = a.path.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name: (a.name || exe.replace(/\.exe$/i, '')).trim(), path: a.path })
  }
  return out.sort((x, y) => x.name.localeCompare(y.name, 'ru'))
}

export const toRunningApp = (a: RawApp, icon: string | null): RunningApp => ({
  exe: basename(a.path.replace(/\\/g, '/')),
  name: a.name,
  path: a.path,
  icon
})

const RUNNING_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Get-Process | Where-Object { $_.Path } | ForEach-Object {
  $d = $null
  try { $d = $_.MainModule.FileVersionInfo.FileDescription } catch {}
  [pscustomobject]@{ name = $(if ($d) { $d } else { $_.ProcessName }); path = $_.Path }
} | Sort-Object path -Unique | ConvertTo-Json -Compress
`

export function parseJsonList(out: string): RawApp[] {
  const t = out.trim()
  if (!t) return []
  try {
    const v = JSON.parse(t) as RawApp | RawApp[]
    return (Array.isArray(v) ? v : [v]).filter((x) => x && typeof x.path === 'string').map((x) => ({ name: String(x.name ?? ''), path: x.path }))
  } catch {
    return []
  }
}

/** Запущенные сейчас программы. */
export async function listRunning(platform: NodeJS.Platform, exec: Runner = run): Promise<RawApp[]> {
  if (platform === 'win32') {
    const r = await exec('powershell.exe', powershellArgs(RUNNING_SCRIPT), { timeoutMs: 30000 })
    return parseJsonList(r.stdout)
  }
  // Linux (только для разработки): читаем /proc
  const out: RawApp[] = []
  try {
    for (const pid of readdirSync('/proc')) {
      if (!/^\d+$/.test(pid)) continue
      try {
        const exe = readlinkSync(join('/proc', pid, 'exe'))
        out.push({ name: basename(exe), path: exe })
      } catch { /* нет доступа */ }
    }
  } catch { /* нет /proc */ }
  return out
}

/** Папки меню «Пуск» с ярлыками установленных программ. */
export function startMenuDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const dirs: string[] = []
  if (env.ProgramData) dirs.push(join(env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'))
  if (env.APPDATA) dirs.push(join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'))
  return dirs
}

export function findShortcuts(dir: string, depth = 3): string[] {
  const out: string[] = []
  const walk = (d: string, level: number): void => {
    let names: string[]
    try { names = readdirSync(d) } catch { return }
    for (const n of names) {
      const p = join(d, n)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) { if (level < depth) walk(p, level + 1) }
      else if (extname(n).toLowerCase() === '.lnk') out.push(p)
    }
  }
  if (existsSync(dir)) walk(dir, 0)
  return out
}
