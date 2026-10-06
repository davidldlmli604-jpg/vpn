// Убирает движок, забытый после аварийного завершения программы. Чужие процессы не трогаем:
// сначала убеждаемся, что под этим номером действительно наш sing-box.
import { readlinkSync } from 'node:fs'
import { basename } from 'node:path'
import { run, type Runner } from '../platform/exec'

export async function killStaleEngine(pid: number, platform: NodeJS.Platform, engineExe: string, exec: Runner = run): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 4 || pid === process.pid) return false
  const wanted = engineExe.split(/[\\/]/).pop()!.toLowerCase()
  if (platform === 'win32') {
    const r = await exec('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { timeoutMs: 10000 })
    if (!r.stdout.toLowerCase().includes(wanted)) return false
    const k = await exec('taskkill', ['/PID', String(pid), '/F', '/T'], { timeoutMs: 10000 })
    return k.code === 0
  }
  try {
    const exe = readlinkSync(`/proc/${pid}/exe`)
    if (basename(exe).toLowerCase() !== wanted) return false
    process.kill(pid, 'SIGKILL')
    return true
  } catch {
    return false
  }
}
