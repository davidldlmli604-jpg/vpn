// Проверка задержки серверов. Один временный запуск движка на всю пачку серверов: у каждого сервера свой
// локальный вход, а запрос к нему проходит весь путь так же, как у браузера (шифрование → сервер → интернет).
// Параллельно основному подключению это безопасно: временный движок ничего не меняет в системе (ни туннеля, ни прокси).
import { spawn } from 'node:child_process'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { connect, createServer } from 'node:net'
import { join } from 'node:path'
import { buildProbeConfig, type Outbound } from '../../core'
import { PROBE_URLS, httpProbe } from './probe'
import { SingBoxProcess } from './process'

export type LatencyResult = { ms: number } | { error: string }

export interface LatencyTarget {
  id: string
  outbound: Outbound
}

export interface LatencyOptions {
  engineExe: string
  /** Рабочая папка (туда на минуту кладётся временный файл настроек). */
  workDir: string
  onResult(id: string, r: LatencyResult): void
  probeUrls?: string[]
  /** Сколько времени даём одному серверу на ответ. */
  budgetMs?: number
  /** Сколько серверов проверяем одновременно. */
  concurrency?: number
  signal?: AbortSignal
  log?(line: string): void
}

export const ERR_NO_ANSWER = 'нет ответа'
export const ERR_BAD_KEY = 'ключ не подходит'
export const ERR_ENGINE = 'движок не запустился'

/** Набор разных свободных портов (все занимаются одновременно, чтобы не выдать один и тот же дважды). */
export async function freePorts(n: number): Promise<number[]> {
  const servers = await Promise.all(
    Array.from({ length: n }, () => new Promise<ReturnType<typeof createServer>>((resolve, reject) => {
      const s = createServer()
      s.once('error', reject)
      s.listen(0, '127.0.0.1', () => resolve(s))
    }))
  )
  const ports = servers.map((s) => (s.address() as { port: number }).port)
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))))
  return ports
}

function runCheck(exe: string, file: string, cwd: string): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    let out = ''
    try {
      const p = spawn(exe, ['check', '-c', file, '-D', cwd], { windowsHide: true, cwd })
      p.stdout.on('data', (d) => (out += d))
      p.stderr.on('data', (d) => (out += d))
      const t = setTimeout(() => { try { p.kill() } catch { /* ничего */ } }, 30000)
      p.on('error', () => { clearTimeout(t); resolve({ ok: false, output: out }) })
      p.on('exit', (code) => { clearTimeout(t); resolve({ ok: code === 0, output: out }) })
    } catch {
      resolve({ ok: false, output: out })
    }
  })
}

function writeSecretFile(file: string, config: unknown): void {
  writeFileSync(file, JSON.stringify(config), { mode: 0o600 })
  try { chmodSync(file, 0o600) } catch { /* на Windows права наследуются от папки */ }
}

/** Время одного ответа через вход сервера; пробует адреса по очереди в пределах отведённого времени. */
export async function measureOne(port: number, urls: string[], budgetMs: number): Promise<LatencyResult> {
  const started = Date.now()
  const left = (): number => budgetMs - (Date.now() - started)
  for (const url of urls) {
    if (left() < 300) break
    let first: number
    try {
      first = await httpProbe(port, url, left())
    } catch {
      continue
    }
    // первый ответ включает поиск адреса и «рукопожатие» — берём лучший из двух, он ближе к реальной отзывчивости
    if (first < 2500 && left() > 300) {
      try { return { ms: Math.min(first, await httpProbe(port, url, left())) } } catch { /* хватит и первого */ }
    }
    return { ms: first }
  }
  return { error: ERR_NO_ANSWER }
}

async function waitListening(port: number, proc: SingBoxProcess, timeoutMs: number): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (proc.exited) return false
    const ok = await new Promise<boolean>((resolve) => {
      const s = connect({ host: '127.0.0.1', port })
      s.once('connect', () => { s.destroy(); resolve(true) })
      s.once('error', () => resolve(false))
    })
    if (ok) return true
    await new Promise((r) => setTimeout(r, 80))
  }
  return false
}

/**
 * Проверяет серверы и сообщает о каждом результате сразу, как он готов. На каждый сервер onResult вызывается не больше
 * одного раза; если проверку прервали (signal), недоделанные серверы остаются без результата.
 */
export async function measureLatencies(targets: LatencyTarget[], opt: LatencyOptions): Promise<void> {
  if (targets.length === 0) return
  const log = opt.log ?? (() => undefined)
  const urls = opt.probeUrls ?? PROBE_URLS
  const budget = opt.budgetMs ?? 6000
  const aborted = (): boolean => !!opt.signal?.aborted
  mkdirSync(opt.workDir, { recursive: true })
  const file = join(opt.workDir, `probe-${Math.random().toString(36).slice(2, 8)}.json`)
  let proc: SingBoxProcess | null = null
  const onAbort = (): void => { void proc?.stop(1500) }
  opt.signal?.addEventListener('abort', onAbort)
  try {
    const ports = await freePorts(targets.length)
    let live = targets.map((t, i) => ({ ...t, port: ports[i]! }))
    const toConfig = (list: typeof live): Record<string, unknown> => buildProbeConfig({ servers: list.map((x) => ({ tag: x.id, outbound: x.outbound, port: x.port })) })

    // один «плохой» ключ не должен лишать проверки все остальные: если общая проверка настроек не прошла, ищем виновников по одному
    writeSecretFile(file, toConfig(live))
    const all = await runCheck(opt.engineExe, file, opt.workDir)
    if (!all.ok) {
      log(`Проверка задержки: общий файл настроек не прошёл проверку, ищу неподходящие ключи`)
      const good: typeof live = []
      for (const t of live) {
        if (aborted()) return
        writeSecretFile(file, toConfig([t]))
        const one = await runCheck(opt.engineExe, file, opt.workDir)
        if (one.ok) good.push(t)
        else opt.onResult(t.id, { error: ERR_BAD_KEY })
      }
      live = good
      if (live.length === 0) return
      writeSecretFile(file, toConfig(live))
    }
    if (aborted()) return

    proc = new SingBoxProcess(opt.engineExe, file, opt.workDir, 200)
    proc.start()
    const ready = await waitListening(live[live.length - 1]!.port, proc, 10000)
    if (aborted()) return
    if (!ready) {
      log(`Проверка задержки: временный движок не запустился: ${proc.recent(5).slice(0, 300)}`)
      for (const t of live) opt.onResult(t.id, { error: ERR_ENGINE })
      return
    }

    // ограниченный «пул»: одновременно не больше нескольких проверок
    const queue = [...live]
    const workers = Array.from({ length: Math.min(opt.concurrency ?? 12, queue.length) }, async () => {
      for (;;) {
        const t = queue.shift()
        if (!t || aborted()) return
        const r = await measureOne(t.port, urls, budget)
        if (!aborted()) opt.onResult(t.id, r)
      }
    })
    await Promise.all(workers)
  } finally {
    opt.signal?.removeEventListener('abort', onAbort)
    await proc?.stop(2000)
    try { rmSync(file, { force: true }) } catch { /* ничего */ }
  }
}
