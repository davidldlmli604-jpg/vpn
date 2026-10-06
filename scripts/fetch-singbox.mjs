// Скачивает официальный sing-box, сверяет SHA-256 и раскладывает в bin/<платформа>/.
//   node scripts/fetch-singbox.mjs                  — для текущей системы
//   node scripts/fetch-singbox.mjs --target win32-x64
// За прокси: NODE_USE_ENV_PROXY=1 HTTPS_PROXY=... node scripts/fetch-singbox.mjs
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, copyFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const table = JSON.parse(readFileSync(resolve(root, 'scripts/singbox-checksums.json'), 'utf8'))

const argTarget = process.argv.includes('--target') ? process.argv[process.argv.indexOf('--target') + 1] : null
const target = argTarget ?? `${process.platform}-${process.arch}`
const force = process.argv.includes('--force')
const asset = table.assets[target]
if (!asset) {
  console.error(`Для платформы «${target}» готовой сборки в таблице нет. Доступно: ${Object.keys(table.assets).join(', ')}`)
  process.exit(1)
}

const outDir = resolve(root, 'bin', target)
const exeName = target.startsWith('win32') ? 'sing-box.exe' : 'sing-box'
const exePath = join(outDir, exeName)
const stamp = join(outDir, '.version')

if (!force && existsSync(exePath) && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === `${table.version}:${asset.sha256}`) {
  console.log(`sing-box ${table.version} (${target}) уже на месте: ${exePath}`)
  process.exit(0)
}

function sha256(file) {
  return new Promise((res, rej) => {
    const h = createHash('sha256')
    createReadStream(file).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej)
  })
}

const work = join(tmpdir(), `tropa-singbox-${process.pid}`)
rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })
const archive = join(work, asset.file)

console.log(`Скачиваю ${asset.file} …`)
const resp = await fetch(table.baseUrl + asset.file, { redirect: 'follow' })
if (!resp.ok) {
  console.error(`Не удалось скачать: HTTP ${resp.status}`)
  process.exit(1)
}
writeFileSync(archive, Buffer.from(await resp.arrayBuffer()))

const actual = await sha256(archive)
if (actual !== asset.sha256) {
  console.error(`КОНТРОЛЬНАЯ СУММА НЕ СОВПАЛА!\n  ожидали: ${asset.sha256}\n  получили: ${actual}\nФайл не установлен.`)
  rmSync(work, { recursive: true, force: true })
  process.exit(2)
}
console.log('Контрольная сумма SHA-256 совпала.')

const unpack = resolve(work, 'unpacked')
mkdirSync(unpack, { recursive: true })
let r
if (asset.file.endsWith('.tar.gz')) r = spawnSync('tar', ['-xzf', archive, '-C', unpack], { stdio: 'inherit' })
else {
  r = spawnSync('tar', ['-xf', archive, '-C', unpack], { stdio: 'ignore' })
  if (r.status !== 0) r = spawnSync('unzip', ['-o', '-q', archive, '-d', unpack], { stdio: 'inherit' })
}
if (r.status !== 0) {
  console.error('Не удалось распаковать архив.')
  process.exit(3)
}

const inner = readdirSync(unpack).map((n) => join(unpack, n)).find((p) => existsSync(join(p, exeName)))
if (!inner) {
  console.error('В архиве не нашёлся sing-box.')
  process.exit(4)
}
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
for (const name of readdirSync(inner)) copyFileSync(join(inner, name), join(outDir, name))
if (!exeName.endsWith('.exe')) chmodSync(exePath, 0o755)
writeFileSync(stamp, `${table.version}:${asset.sha256}\n`)
rmSync(work, { recursive: true, force: true })
console.log(`Готово: ${exePath}`)
