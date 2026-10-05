// Хранилище данных: настройки, список серверов, подписки.
// Ключи (ссылки и параметры подключения) лежат в файле только в зашифрованном виде:
// шифрование делает система (в Windows — DPAPI, привязка к вашей учётной записи).
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ParsedServer, Outbound, SubscriptionInfo } from '../core'
import { maskKey } from '../core'
import { DEFAULT_SETTINGS, mergeSettings } from '../shared/defaults'
import type { LatencyState, ServerView, Settings, SubscriptionView } from '../shared/types'

export interface Sealer {
  available(): boolean
  seal(plain: string): string
  open(sealed: string): string
}

export interface ServerRecord {
  id: string
  name: string
  protocol: string
  host: string
  port: number
  countryCode: string | null
  favorite: boolean
  subscriptionId: string | null
  /** Зашифрованное: { outbound, rawLink }. */
  sealed: string
  /** Отпечаток для поиска повторов (необратимый). */
  fingerprint: string
  warnings: string[]
  addedAt: number
}

export interface SubscriptionRecord {
  id: string
  name: string
  /** Зашифрованный адрес подписки (в нём часто бывает секретный токен). */
  sealedUrl: string
  displayUrl: string
  updatedAt: number | null
  info: SubscriptionInfo | null
  error: string | null
  intervalHours: number
}

interface Persisted {
  version: 1
  settings: Settings
  servers: ServerRecord[]
  subscriptions: SubscriptionRecord[]
  rulesUpdatedAt: number | null
  /** Для настройки «прежний вид системного прокси» и подобного. */
  runtime: Record<string, unknown>
}

export class SecureStorageError extends Error {
  constructor() {
    super('secure-storage-unavailable')
  }
}

export function fingerprintOf(outbound: Outbound): string {
  const stable = JSON.stringify(outbound, Object.keys(outbound).sort())
  return createHash('sha256').update(stable).digest('hex').slice(0, 20)
}

export function newId(): string {
  return randomBytes(5).toString('hex')
}

/** Адрес подписки без секретной части — для показа на экране. */
export function displayUrlOf(url: string): string {
  try {
    const m = /^(https?:\/\/[^/?#]+)/i.exec(url.trim())
    return m ? `${m[1]}/…` : 'подписка'
  } catch {
    return 'подписка'
  }
}

export class DataStore {
  private data: Persisted
  private timer: NodeJS.Timeout | null = null
  /** Задержки и прочее временное — в файл не пишется. */
  private latency = new Map<string, LatencyState>()
  loadNote: string | null = null

  constructor(private readonly file: string, private readonly sealer: Sealer) {
    this.data = this.load()
  }

  private empty(): Persisted {
    return { version: 1, settings: { ...DEFAULT_SETTINGS, advanced: { ...DEFAULT_SETTINGS.advanced } }, servers: [], subscriptions: [], rulesUpdatedAt: null, runtime: {} }
  }

  private load(): Persisted {
    if (!existsSync(this.file)) return this.empty()
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Persisted>
      return {
        version: 1,
        settings: mergeSettings(raw.settings),
        servers: Array.isArray(raw.servers) ? raw.servers : [],
        subscriptions: Array.isArray(raw.subscriptions) ? raw.subscriptions : [],
        rulesUpdatedAt: raw.rulesUpdatedAt ?? null,
        runtime: raw.runtime && typeof raw.runtime === 'object' ? raw.runtime : {}
      }
    } catch {
      // файл повреждён: откладываем его в сторону и начинаем с чистого листа, не теряя шанса починить вручную
      try { renameSync(this.file, `${this.file}.broken-${Date.now()}`) } catch { /* ничего */ }
      this.loadNote = 'Файл с вашими данными оказался повреждён, поэтому программа начала с чистого листа. Старый файл сохранён рядом.'
      return this.empty()
    }
  }

  /** Сохранение с небольшой задержкой и без риска получить «половину файла». */
  save(immediate = false): void {
    if (this.timer) clearTimeout(this.timer)
    const write = (): void => {
      this.timer = null
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 })
      renameSync(tmp, this.file)
    }
    if (immediate) write()
    else this.timer = setTimeout(write, 300)
  }

  flush(): void {
    if (this.timer) this.save(true)
  }

  // ---------------------------------------------------------------- настройки

  get settings(): Settings {
    return this.data.settings
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.data.settings = mergeSettings({ ...this.data.settings, ...patch })
    this.save()
    return this.data.settings
  }

  updateAdvanced(patch: Partial<Settings['advanced']>): Settings {
    this.data.settings = mergeSettings({ ...this.data.settings, advanced: { ...this.data.settings.advanced, ...patch } })
    this.save()
    return this.data.settings
  }

  get rulesUpdatedAt(): number | null {
    return this.data.rulesUpdatedAt
  }
  set rulesUpdatedAt(v: number | null) {
    this.data.rulesUpdatedAt = v
    this.save()
  }

  runtimeGet<T>(key: string): T | null {
    return (this.data.runtime[key] as T | undefined) ?? null
  }
  runtimeSet(key: string, value: unknown): void {
    if (value === null || value === undefined) delete this.data.runtime[key]
    else this.data.runtime[key] = value
    this.save(true)
  }

  // ---------------------------------------------------------------- серверы

  /** Доступно ли системное шифрование (без него ключи не сохраняются). */
  get secureAvailable(): boolean {
    return this.sealer.available()
  }

  private requireSealer(): void {
    if (!this.sealer.available()) throw new SecureStorageError()
  }

  /** Добавляет серверы; повторы (тот же ключ) не дублируются. Возвращает записи, которые действительно появились. */
  addServers(parsed: ParsedServer[], subscriptionId: string | null = null): { added: ServerRecord[]; duplicates: number } {
    this.requireSealer()
    const added: ServerRecord[] = []
    let duplicates = 0
    for (const p of parsed) {
      const fp = fingerprintOf(p.outbound)
      if (this.data.servers.some((s) => s.fingerprint === fp)) {
        duplicates++
        continue
      }
      const rec: ServerRecord = {
        id: newId(),
        name: p.name,
        protocol: p.protocol === 'other' ? String(p.outbound.type ?? 'другое') : p.protocol,
        host: p.host,
        port: p.port,
        countryCode: p.countryHint ?? null,
        favorite: false,
        subscriptionId,
        sealed: this.sealer.seal(JSON.stringify({ outbound: p.outbound, rawLink: p.rawLink ?? null })),
        fingerprint: fp,
        warnings: p.warnings,
        addedAt: Date.now()
      }
      this.data.servers.push(rec)
      added.push(rec)
    }
    this.save()
    return { added, duplicates }
  }

  server(id: string): ServerRecord | null {
    return this.data.servers.find((s) => s.id === id) ?? null
  }

  get servers(): ServerRecord[] {
    return this.data.servers
  }

  getSecret(id: string): { outbound: Outbound; rawLink?: string } | null {
    const rec = this.server(id)
    if (!rec) return null
    try {
      const obj = JSON.parse(this.sealer.open(rec.sealed)) as { outbound: Outbound; rawLink: string | null }
      return { outbound: obj.outbound, ...(obj.rawLink ? { rawLink: obj.rawLink } : {}) }
    } catch {
      return null
    }
  }

  rename(id: string, name: string): void {
    const rec = this.server(id)
    const clean = name.trim().slice(0, 80)
    if (!rec || !clean) return
    rec.name = clean
    this.save()
  }

  toggleFavorite(id: string): void {
    const rec = this.server(id)
    if (!rec) return
    rec.favorite = !rec.favorite
    this.save()
  }

  removeServer(id: string): void {
    this.data.servers = this.data.servers.filter((s) => s.id !== id)
    this.latency.delete(id)
    if (this.data.settings.selectedServerId === id) this.data.settings.selectedServerId = null
    this.save()
  }

  setLatency(id: string, v: LatencyState): void {
    this.latency.set(id, v)
  }

  views(): ServerView[] {
    return this.data.servers.map((s) => {
      return {
        id: s.id,
        name: s.name,
        protocol: s.protocol,
        host: s.host,
        port: s.port,
        countryCode: s.countryCode,
        favorite: s.favorite,
        subscriptionId: s.subscriptionId,
        latency: this.latency.get(s.id) ?? null,
        canQr: this.hasRawLink(s),
        warnings: s.warnings ?? [],
        addedAt: s.addedAt
      }
    })
  }

  private hasRawLink(s: ServerRecord): boolean {
    try {
      const o = JSON.parse(this.sealer.open(s.sealed)) as { rawLink: string | null }
      return !!o.rawLink
    } catch {
      return false
    }
  }

  // ---------------------------------------------------------------- подписки

  get subscriptions(): SubscriptionRecord[] {
    return this.data.subscriptions
  }

  subscription(id: string): SubscriptionRecord | null {
    return this.data.subscriptions.find((s) => s.id === id) ?? null
  }

  addSubscription(url: string, name: string): SubscriptionRecord {
    this.requireSealer()
    const existing = this.data.subscriptions.find((s) => this.openUrl(s) === url)
    if (existing) return existing
    const rec: SubscriptionRecord = {
      id: newId(),
      name: name.trim().slice(0, 80) || displayUrlOf(url).replace(/^https?:\/\//, '').replace(/\/…$/, ''),
      sealedUrl: this.sealer.seal(url),
      displayUrl: displayUrlOf(url),
      updatedAt: null,
      info: null,
      error: null,
      intervalHours: 12
    }
    this.data.subscriptions.push(rec)
    this.save()
    return rec
  }

  openUrl(s: SubscriptionRecord): string | null {
    try { return this.sealer.open(s.sealedUrl) } catch { return null }
  }

  removeSubscription(id: string, withServers: boolean): void {
    this.data.subscriptions = this.data.subscriptions.filter((s) => s.id !== id)
    if (withServers) {
      const ids = this.data.servers.filter((s) => s.subscriptionId === id).map((s) => s.id)
      for (const sid of ids) this.removeServer(sid)
    } else {
      for (const s of this.data.servers) if (s.subscriptionId === id) s.subscriptionId = null
    }
    this.save()
  }

  /**
   * Сверка списка серверов подписки с тем, что пришло в этот раз:
   * новые добавляем, исчезнувшие убираем, у оставшихся сохраняем имя, «любимых» и выбор человека.
   */
  reconcileSubscription(id: string, parsed: ParsedServer[]): { added: number; removed: number; kept: number } {
    this.requireSealer()
    const fps = new Map(parsed.map((p) => [fingerprintOf(p.outbound), p]))
    const current = this.data.servers.filter((s) => s.subscriptionId === id)
    let removed = 0
    for (const rec of current) {
      if (!fps.has(rec.fingerprint)) {
        this.removeServer(rec.id)
        removed++
      }
    }
    const have = new Set(current.map((s) => s.fingerprint))
    const fresh = parsed.filter((p) => !have.has(fingerprintOf(p.outbound)))
    // сервер мог быть добавлен вручную до подписки — тогда присоединяем его к подписке, а не дублируем
    const adopt: ParsedServer[] = []
    for (const p of fresh) {
      const fp = fingerprintOf(p.outbound)
      const manual = this.data.servers.find((s) => s.fingerprint === fp)
      if (manual) manual.subscriptionId = id
      else adopt.push(p)
    }
    const { added } = this.addServers(adopt, id)
    this.save()
    return { added: added.length, removed, kept: current.length - removed }
  }

  subscriptionViews(refreshing: Set<string>): SubscriptionView[] {
    return this.data.subscriptions.map((s) => ({
      id: s.id,
      name: s.name,
      displayUrl: s.displayUrl,
      updatedAt: s.updatedAt,
      serverCount: this.data.servers.filter((x) => x.subscriptionId === s.id).length,
      info: s.info,
      error: s.error,
      refreshing: refreshing.has(s.id)
    }))
  }
}

export { maskKey }
