// Запуск для разработки: окно с «живой» перезагрузкой + настоящая оболочка Electron.
//   npm run dev
import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const procs = []
const run = (cmd, args, opts = {}) => {
  const p = spawn(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32', ...opts })
  procs.push(p)
  return p
}
const stop = () => { for (const p of procs) try { p.kill() } catch { /* уже завершён */ } process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

const vite = run('npx', ['vite', '--config', 'vite.config.ts', '--port', '5173', '--strictPort'])
await new Promise((res) => {
  vite.stdout.on('data', (d) => { process.stdout.write(d); if (String(d).includes('localhost')) res() })
})
await new Promise((res) => run('node', ['scripts/build-main.mjs']).on('exit', res))
run('node', ['scripts/build-main.mjs', '--watch'], { stdio: 'inherit' })
const electron = run('npx', ['electron', '.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: 'http://localhost:5173' } })
electron.on('exit', stop)
