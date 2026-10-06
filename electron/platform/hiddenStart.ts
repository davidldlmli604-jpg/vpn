// «Запуститься свёрнутым»: при автозапуске окно не должно выскакивать. Копия, перезапущенная с правами администратора,
// получает только фиксированные аргументы (`--elevated`), поэтому «спрячься» передаётся запиской в папке данных.
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const NAME = 'start-hidden'

export function markHiddenStart(userDir: string): void {
  try {
    mkdirSync(userDir, { recursive: true })
    writeFileSync(join(userDir, NAME), String(Date.now()))
  } catch { /* не страшно: окно просто покажется */ }
}

/** Прочитать и тут же удалить записку. Старше `maxAgeMs` — считается забытой (например, после аварии) и игнорируется. */
export function consumeHiddenStart(userDir: string, maxAgeMs = 90_000, now = Date.now()): boolean {
  const file = join(userDir, NAME)
  try {
    if (!existsSync(file)) return false
    const fresh = now - statSync(file).mtimeMs <= maxAgeMs
    rmSync(file, { force: true })
    return fresh
  } catch {
    return false
  }
}
