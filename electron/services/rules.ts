// Списки правил для российских сайтов и адресов: вшитый снимок + автоматическое обновление.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { RULESETS, type RuleSetFile } from '../../core'

export interface RulesDeps {
  /** Папка с обновляемыми списками (в данных пользователя). */
  userDir: string
  /** Вшитые списки (рядом с программой). */
  bundledDir: string
  fetch(url: string): Promise<Buffer>
  getUpdatedAt(): number | null
  setUpdatedAt(t: number): void
  now?: () => number
  log(line: string): void
}

const MAX_AGE_MS = 3 * 24 * 3600 * 1000

/** Файл правил sing-box начинается с «SRS» и байта версии. */
export function looksLikeRuleSet(buf: Buffer): boolean {
  return buf.length > 16 && buf.subarray(0, 3).toString('latin1') === 'SRS'
}

export class RuleSets {
  updating = false
  constructor(private readonly d: RulesDeps) {
    mkdirSync(d.userDir, { recursive: true })
  }

  private tagOf(file: string): string {
    return file.replace(/\.srs$/, '')
  }

  /** Копирует вшитые файлы, которых ещё нет у пользователя. */
  seed(): void {
    for (const s of RULESETS.sets) {
      const dst = join(this.d.userDir, s.file)
      const src = join(this.d.bundledDir, s.file)
      if (!existsSync(dst) && existsSync(src)) copyFileSync(src, dst)
    }
  }

  private valid(path: string): boolean {
    try {
      return statSync(path).size > 16 && looksLikeRuleSet(readFileSync(path).subarray(0, 8))
    } catch {
      return false
    }
  }

  /** Основной набор (скачанный, если исправен) и запасной (вшитый). */
  files(): { primary: RuleSetFile[]; fallback: RuleSetFile[] } {
    const primary: RuleSetFile[] = []
    const fallback: RuleSetFile[] = []
    for (const s of RULESETS.sets) {
      const user = join(this.d.userDir, s.file)
      const bundled = join(this.d.bundledDir, s.file)
      const role = s.role as RuleSetFile['role']
      const tag = this.tagOf(s.file)
      if (existsSync(bundled)) fallback.push({ tag, path: bundled, role })
      if (this.valid(user)) primary.push({ tag, path: user, role })
      else if (existsSync(bundled)) primary.push({ tag, path: bundled, role })
    }
    return { primary, fallback }
  }

  status(): { updatedAt: number | null; count: number; updating: boolean; bundledOnly: boolean } {
    const at = this.d.getUpdatedAt()
    return { updatedAt: at, count: this.files().primary.length, updating: this.updating, bundledOnly: at === null }
  }

  needsUpdate(): boolean {
    const at = this.d.getUpdatedAt()
    return at === null || (this.d.now?.() ?? Date.now()) - at > MAX_AGE_MS
  }

  async update(): Promise<{ updated: number; failed: number }> {
    if (this.updating) return { updated: 0, failed: 0 }
    this.updating = true
    let updated = 0
    let failed = 0
    try {
      for (const s of RULESETS.sets) {
        const url = (RULESETS.baseUrl as Record<string, string>)[s.kind] + s.file
        try {
          const buf = await this.d.fetch(url)
          if (!looksLikeRuleSet(buf)) throw new Error('это не набор правил')
          const dst = join(this.d.userDir, s.file)
          const tmp = dst + '.tmp'
          writeFileSync(tmp, buf)
          renameSync(tmp, dst)
          updated++
        } catch (e) {
          failed++
          this.d.log(`Список ${s.file} не обновился: ${(e as Error).message}`)
        }
      }
      if (updated > 0) this.d.setUpdatedAt((this.d.now?.() ?? Date.now()))
      this.d.log(`Списки правил: обновлено ${updated}, не удалось ${failed}`)
    } finally {
      this.updating = false
    }
    return { updated, failed }
  }
}
