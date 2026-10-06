// Рисует значки приложения и трея из одного SVG и собирает icon.ico.
// Запуск: node scripts/make-icons.mjs   (нужен Chromium из Playwright)
import { chromium } from 'playwright-core'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'resources')
mkdirSync(join(out, 'tray'), { recursive: true })

// Кольцо с разрывом сверху и точкой-узлом. В состоянии «работает» кольцо замкнуто.
const C = 128, CY = 132, R = 78
const pt = (deg) => [C + R * Math.sin((deg * Math.PI) / 180), CY - R * Math.cos((deg * Math.PI) / 180)].map((n) => n.toFixed(1))
const ring = (a, b, { closed = false, dot = true } = {}) => {
  const [x1, y1] = pt(40)
  const [x2, y2] = pt(-40)
  const path = closed
    ? `<circle cx="${C}" cy="${CY}" r="${R}" fill="none" stroke="url(#g)" stroke-width="22"/>`
    : `<path d="M ${x1} ${y1} A ${R} ${R} 0 1 1 ${x2} ${y2}" fill="none" stroke="url(#g)" stroke-width="22" stroke-linecap="round"/>`
  const node = dot ? `<circle cx="${C}" cy="${closed ? CY : CY - R - 4}" r="${closed ? 20 : 15}" fill="url(#g)"/>` : ''
  return `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>${path}${node}`
}

const appSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#16204a"/><stop offset="1" stop-color="#090d1f"/></linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#2de2c7" stop-opacity="0.35"/><stop offset="1" stop-color="#2de2c7" stop-opacity="0"/></radialGradient>
  </defs>
  <rect x="8" y="8" width="240" height="240" rx="56" fill="url(#bg)"/>
  <circle cx="128" cy="132" r="104" fill="url(#glow)"/>
  <g>${ring('#35f0cf', '#8b7bff')}</g>
</svg>`

const trayStates = {
  off: ['#9aa4c7', '#7480a8', { dot: false }],
  connecting: ['#ffd36b', '#ffa94d', {}],
  on: ['#35f0cf', '#3fd6ff', { closed: true }],
  error: ['#ff7a8a', '#ff4d6a', {}]
}
const traySvg = (a, b, o) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">${ring(a, b, o)}</svg>`

const browser = await chromium.launch({ executablePath: existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined, args: ['--no-sandbox'] })
const page = await browser.newPage({ deviceScaleFactor: 1 })

async function png(svg, size) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`)
  return await page.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
}

writeFileSync(join(out, 'icon.png'), await png(appSvg, 512))
const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = []
for (const s of sizes) pngs.push([s, await png(appSvg, s)])

// icon.ico: набор PNG внутри контейнера ICO
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4)
let offset = 6 + 16 * pngs.length
const entries = []
for (const [s, buf] of pngs) {
  const e = Buffer.alloc(16)
  e.writeUInt8(s >= 256 ? 0 : s, 0); e.writeUInt8(s >= 256 ? 0 : s, 1); e.writeUInt8(0, 2); e.writeUInt8(0, 3)
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(buf.length, 8); e.writeUInt32LE(offset, 12)
  entries.push(e); offset += buf.length
}
writeFileSync(join(out, 'icon.ico'), Buffer.concat([header, ...entries, ...pngs.map(([, b]) => b)]))
writeFileSync(join(out, 'icon.svg'), appSvg)

for (const [state, [a, b, o]] of Object.entries(trayStates)) {
  writeFileSync(join(out, 'tray', `${state}.png`), await png(traySvg(a, b, o), 32))
  writeFileSync(join(out, 'tray', `${state}@2x.png`), await png(traySvg(a, b, o), 64))
}
await browser.close()
console.log('Готово: resources/icon.png, icon.ico, icon.svg, tray/*.png')
