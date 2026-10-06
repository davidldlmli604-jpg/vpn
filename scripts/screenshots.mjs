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
  { name: 'bypass', q: 'scene=off', page: 'Мимо VPN', wait: 1600, height: 1100 },
  { name: 'bypass-picker', q: 'scene=off', page: 'Мимо VPN', wait: 1400, click: 'Выбрать из запущенных', afterClick: 1200 },
  { name: 'admin-modal', q: 'scene=off', wait: 1200, click: 'Весь компьютер', afterClick: 1200 },
  { name: 'servers-sunset-light', q: 'scene=on&palette=sunset&theme=light', page: 'Серверы', wait: 1500 },
  { name: 'servers-subs', q: 'scene=off&subs=err', page: 'Серверы', wait: 4200, height: 980 },
  { name: 'servers-testing', q: 'scene=off', page: 'Серверы', wait: 3600, steps: [{ text: 'Проверить задержку' }], afterSteps: 500 },
  { name: 'qr-warning', q: 'scene=off', page: 'Серверы', wait: 1500, steps: [{ sel: '[aria-label="Действия с подпиской"]' }, { text: 'Показать QR-код' }], afterSteps: 900 },
  { name: 'qr-shown', q: 'scene=off', page: 'Серверы', wait: 1500, steps: [{ sel: '[aria-label="Действия с подпиской"]' }, { text: 'Показать QR-код' }, { text: 'Показать код' }], afterSteps: 1400 },
  { name: 'wizard-1', q: 'wizard=1&empty=1', wait: 1300, height: 800 },
  { name: 'wizard-1-added', q: 'wizard=1&empty=1', wait: 1000, height: 800, steps: [{ text: 'Вставить ключ или подписку' }], afterSteps: 900 },
  { name: 'wizard-2', q: 'wizard=1', wait: 1000, height: 800, steps: [{ text: 'Дальше' }], afterSteps: 800 },
  { name: 'wizard-3', q: 'wizard=1', wait: 1000, height: 900, steps: [{ text: 'Дальше' }, { text: 'Дальше' }], afterSteps: 900 },
  { name: 'wizard-3-on', q: 'wizard=1&palette=sunset', wait: 1000, height: 900, steps: [{ text: 'Дальше' }, { text: 'Дальше' }, { sel: '.power__face' }], afterSteps: 4200 },
  { name: 'expert-closed', q: 'scene=off', page: 'Настройки', wait: 1200, height: 1300 },
  { name: 'expert-open', q: 'scene=off', page: 'Настройки', wait: 1000, height: 1700, steps: [{ text: 'Для специалиста' }], afterSteps: 900 },
  { name: 'protection-off', q: 'scene=off', page: 'Защита', wait: 1400, height: 900 },
  { name: 'protection-on-tun', q: 'scene=off&ks=1&mode=tun', page: 'Защита', wait: 1400, height: 900 },
  { name: 'protection-on-proxy', q: 'scene=off&ks=1', page: 'Защита', wait: 1400, height: 900 },
  { name: 'home-blocked', q: 'scene=blocked&ks=1&mode=tun', wait: 1500, height: 900 },
  { name: 'check-running', q: 'scene=check', wait: 4300, height: 1000 },
  { name: 'check-ok', q: 'scene=check', wait: 7600, height: 1000 },
  { name: 'check-warn', q: 'scene=check&check=warn&palette=sunset', wait: 7600, height: 1000 },
  { name: 'check-ok-light', q: 'scene=check&theme=light&palette=forest', wait: 7600, height: 1000 }
]
const only = process.argv.slice(2)
try {
for (const s of scenes) {
  if (only.length && !only.includes(s.name)) continue
  const page = await browser.newPage({ viewport: { width: 1040, height: s.height ?? 720 }, deviceScaleFactor: 1.25 })
  page.on('pageerror', (e) => console.error(`[${s.name}] ошибка страницы:`, e.message))
  page.on('console', (m) => { if (m.type() === 'error') console.error(`[${s.name}] console:`, m.text()) })
  await page.goto(`${base}?${s.q}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
  await page.waitForSelector('.app .sidebar, .app .wizard', { timeout: 15000 })
  if (s.page) { await page.getByRole('button', { name: s.page }).first().click() }
  await page.waitForTimeout(s.wait)
  if (s.click) {
    await page.getByText(s.click).first().evaluate((el) => (el.closest('button') ?? el).click())
    await page.waitForTimeout(s.afterClick ?? 1000)
  }
  for (const st of s.steps ?? []) {
    if (st.sel) await page.locator(st.sel).first().evaluate((el) => el.click())
    else await page.getByText(st.text).first().evaluate((el) => (el.closest('button') ?? el).click())
    await page.waitForTimeout(450)
  }
  if (s.steps) await page.waitForTimeout(s.afterSteps ?? 800)
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
