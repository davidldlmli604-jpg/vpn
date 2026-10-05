// Обновляет вшитый снимок списков в resources/rules/ (список файлов — core/rulesets.json).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'core/rulesets.json'), 'utf8'))
const out = resolve(root, 'resources/rules')
mkdirSync(out, { recursive: true })

let failed = 0
for (const set of manifest.sets) {
  const url = manifest.baseUrl[set.kind] + set.file
  try {
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const buf = Buffer.from(await resp.arrayBuffer())
    if (buf.length < 8 || buf.subarray(0, 3).toString('latin1') !== 'SRS') throw new Error('это не файл правил sing-box')
    writeFileSync(join(out, set.file), buf)
    console.log(`ok   ${set.file} (${buf.length} байт)`)
  } catch (e) {
    failed++
    console.error(`FAIL ${set.file}: ${e.message}`)
  }
}
process.exit(failed ? 1 : 0)
