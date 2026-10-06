// Собирает «внутренности» приложения (main и preload) в dist-electron/.
import { build, context } from 'esbuild'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const watch = process.argv.includes('--watch')

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  external: ['electron'],
  logLevel: 'info',
  alias: {
    '@core': resolve(root, 'core'),
    '@shared': resolve(root, 'shared'),
    '@brand': resolve(root, 'brand.json')
  }
}

const jobs = [
  { ...common, entryPoints: [resolve(root, 'electron/main.ts')], outfile: resolve(root, 'dist-electron/main.js') },
  { ...common, entryPoints: [resolve(root, 'electron/preload.ts')], outfile: resolve(root, 'dist-electron/preload.js') }
]

if (watch) {
  for (const job of jobs) (await context(job)).watch()
} else {
  for (const job of jobs) await build(job)
}
