// Снимает скриншоты окна в разных состояниях и оформлениях (для проверки внешнего вида).
// Запуск: npm run screenshots [-- имя_сцены ...]
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = process.env.SHOTS_DIR ?? join(root, 'docs', 'screenshots')
mkdirSync(outDir, { recursive: true })
const PORT = 5199

const vite = spawn('npx', ['vite', '--config', 'vite.config.ts', '--mode', 'mock', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
let ready = false
vite.stdout.on('data', (d) => { if (String(d).includes('localhost')) ready = true })
for (let i = 0; i < 150 && !ready; i++) await new Promise((r) => setTimeout(r, 200))
const killVite = () => { try { process.kill(-vite.pid) } catch { /* уже остановлен */ } }
if (!ready) { killVite(); throw new Error('Vite не запустился') }

const exe = existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--no-proxy-server', '--disable-background-networking', '--disable-component-update', '--disable-sync'], timeout: 30000 })

const base = `http://localhost:${PORT}/`
const scenes = [
  { name: 'home-off', q: 'scene=off', wait: 900 },
  { name: 'home-connecting', q: 'scene=connecting', wait: 1200 },
  { name: 'home-on', q: 'scene=on&uptime=754', wait: 4800 },
  { name: 'home-error', q: 'scene=error', wait: 900 },
  { name: 'home-empty', q: 'empty=1', wait: 900 },
  { name: 'servers', q: 'scene=on', page: 'Серверы', wait: 1500 },
  { name: 'servers-empty', q: 'empty=1', page: 'Серверы', wait: 1200 },
  { name: 'settings', q: 'scene=off', page: 'Настройки', wait: 1200 },
  { name: 'home-on-sunset-dark', q: 'scene=on&palette=sunset&uptime=2210', wait: 4800 },
  { name: 'home-on-sunset-light', q: 'scene=on&palette=sunset&theme=light&uptime=2210', wait: 4800 },
  { name: 'home-on-forest-dark', q: 'scene=on&palette=forest&uptime=95', wait: 4800 },
  { name: 'home-on-forest-light', q: 'scene=on&palette=forest&theme=light&uptime=95', wait: 4800 },
  { name: 'home-off-aurora-light', q: 'scene=off&theme=light', wait: 900 },
  { name: 'sheltie-hint-power', q: 'scene=off', wait: 1500, hover: '.power__face', hoverWait: 3400 },
  { name: 'sheltie-hint-tile', q: 'scene=on&uptime=300', wait: 4500, hover: '.tile', hoverWait: 3400 },
  { name: 'sheltie-error-light', q: 'scene=error&palette=sunset&theme=light', wait: 2200 },
  { name: 'servers-sunset-light', q: 'scene=on&palette=sunset&theme=light', page: 'Серверы', wait: 1500 }
]
const only = process.argv.slice(2)
try {
for (const s of scenes) {
  if (only.length && !only.includes(s.name)) continue
  const page = await browser.newPage({ viewport: { width: 1040, height: 720 }, deviceScaleFactor: 1.25 })
  page.on('pageerror', (e) => console.error(`[${s.name}] ошибка страницы:`, e.message))
  page.on('console', (m) => { if (m.type() === 'error') console.error(`[${s.name}] console:`, m.text()) })
  await page.goto(`${base}?${s.q}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
  await page.waitForSelector('.app .sidebar', { timeout: 15000 })
  if (s.page) { await page.getByRole('button', { name: s.page }).first().click() }
  await page.waitForTimeout(s.wait)
  if (s.hover) {
    const b = await page.locator(s.hover).first().boundingBox()
    await page.mouse.move(b.x + b.width / 2 - 20, b.y + b.height / 2 - 20)
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 })
    await page.waitForTimeout(s.hoverWait ?? 2600)
  }
  await page.screenshot({ path: join(outDir, `${s.name}.png`) })
  await page.close()
  console.log('снято:', s.name)
}
} finally {
  await browser.close()
  killVite()
}
process.exit(0)
