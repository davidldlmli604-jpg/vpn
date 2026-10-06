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
  /** Название, как его дал поставщик (нужно, чтобы узнавать сервер, когда у него сменились ключи). */
  origName?: string
  /** Человек сам переименовал сервер: подписка его название больше не трогает. */
  nameEdited?: boolean
  /** Есть ли исходная ссылка (для QR-кода) — чтобы не расшифровывать каждый ключ при каждой перерисовке. */
  hasLink?: boolean
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
  /** Человек сам назвал подписку: название от поставщика больше не подставляется. */
  nameEdited?: boolean
  /** Серверы, которые человек удалил из подписки: при обновлении они не возвращаются. */
  ignored?: string[]
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

/** «Тип + адрес + порт + название от поставщика»: по этому признаку узнаём сервер подписки, когда у него сменились секреты. */
export function serverKey(r: { protocol: string; host: string; port: number; origName?: string; name: string }): string {
  return `${r.protocol}|${r.host.toLowerCase()}|${r.port}|${r.origName ?? r.name}`
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
        addedAt: Date.now(),
        origName: p.name,
        hasLink: !!p.rawLink
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
    rec.nameEdited = true
    this.save()
  }

  toggleFavorite(id: string): void {
    const rec = this.server(id)
    if (!rec) return
    rec.favorite = !rec.favorite
    this.save()
  }

  removeServer(id: string, forget = true): void {
    const rec = this.server(id)
    const sub = rec?.subscriptionId ? this.subscription(rec.subscriptionId) : null
    // сервер, удалённый человеком из подписки, не должен возвращаться при её обновлении
    if (rec && sub && forget) {
      sub.ignored = [...(sub.ignored ?? []), `fp:${rec.fingerprint}`, `k:${serverKey(rec)}`].slice(-1000)
    }
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
    if (typeof s.hasLink === 'boolean') return s.hasLink
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

  removeSubscription(id: string, withServers = true): void {
    const ids = this.data.servers.filter((s) => s.subscriptionId === id).map((s) => s.id)
    this.data.subscriptions = this.data.subscriptions.filter((s) => s.id !== id)
    if (withServers) for (const sid of ids) this.removeServer(sid, false)
    else for (const s of this.data.servers) if (s.subscriptionId === id) s.subscriptionId = null
    this.save()
  }

  renameSubscription(id: string, name: string): void {
    const rec = this.subscription(id)
    const clean = name.trim().slice(0, 80)
    if (!rec || !clean) return
    rec.name = clean
    rec.nameEdited = true
    this.save()
  }

  /** Итог последнего обновления: успех (error = null) или причина неудачи. */
  setSubscriptionResult(id: string, patch: { error: string | null; info?: SubscriptionInfo | null; title?: string | null; intervalHours?: number | null }): void {
    const rec = this.subscription(id)
    if (!rec) return
    rec.error = patch.error
    if (patch.error === null) {
      rec.updatedAt = Date.now()
      if (patch.info !== undefined) rec.info = patch.info
      if (patch.title && !rec.nameEdited) rec.name = patch.title
      if (patch.intervalHours) rec.intervalHours = patch.intervalHours
    }
    this.save()
  }

  /**
   * Сверка списка серверов подписки с тем, что пришло в этот раз. Что сохраняется: названия, «любимые» и выбор
   * человека — даже если поставщик сменил у сервера ключи (тогда сервер узнаётся по типу, адресу, порту и названию,
   * а новые секреты записываются на то же место). Новые серверы добавляются, исчезнувшие убираются.
   * `keep` — серверы, которые убирать нельзя (например, к ним сейчас подключены).
   */
  reconcileSubscription(id: string, parsed: ParsedServer[], keep: ReadonlySet<string> = new Set()): { added: number; removed: number; kept: number; updated: number } {
    this.requireSealer()
    const sub = this.subscription(id)
    const ignored = new Set(sub?.ignored ?? [])
    // повторы внутри самой подписки и серверы, которые человек убрал, отбрасываем
    const incoming: Array<{ p: ParsedServer; fp: string; key: string; used: boolean }> = []
    const seen = new Set<string>()
    for (const p of parsed) {
      const fp = fingerprintOf(p.outbound)
      const protocol = p.protocol === 'other' ? String(p.outbound.type ?? 'другое') : p.protocol
      const key = serverKey({ protocol, host: p.host, port: p.port, origName: p.name, name: p.name })
      if (seen.has(fp) || ignored.has(`fp:${fp}`) || ignored.has(`k:${key}`)) continue
      seen.add(fp)
      incoming.push({ p, fp, key, used: false })
    }
    const mine = this.data.servers.filter((s) => s.subscriptionId === id)
    const claimed = new Map<ServerRecord, (typeof incoming)[number]>()

    const pair = (oldKey: (r: ServerRecord) => string, newKey: (n: (typeof incoming)[number]) => string, mustBeUnique: boolean): void => {
      const oldLeft = mine.filter((r) => !claimed.has(r))
      const newLeft = incoming.filter((n) => !n.used)
      const oldBy = new Map<string, ServerRecord[]>()
      const newBy = new Map<string, Array<(typeof incoming)[number]>>()
      for (const r of oldLeft) oldBy.set(oldKey(r), [...(oldBy.get(oldKey(r)) ?? []), r])
      for (const n of newLeft) newBy.set(newKey(n), [...(newBy.get(newKey(n)) ?? []), n])
      for (const [k, olds] of oldBy) {
        const news = newBy.get(k)
        if (!news) continue
        if (mustBeUnique && (olds.length !== 1 || news.length !== 1)) continue
        for (let i = 0; i < Math.min(olds.length, news.length); i++) {
          claimed.set(olds[i]!, news[i]!)
          news[i]!.used = true
        }
      }
    }
    pair((r) => r.fingerprint, (n) => n.fp, false) // тот же сервер без изменений
    pair((r) => serverKey(r), (n) => n.key, false) // тот же сервер, но у него сменились ключи
    pair((r) => `${r.protocol}|${r.host.toLowerCase()}|${r.port}`, (n) => n.key.split('|').slice(0, 3).join('|'), true) // сменилось и название

    let updated = 0
    for (const [rec, n] of claimed) {
      const protocol = n.p.protocol === 'other' ? String(n.p.outbound.type ?? 'другое') : n.p.protocol
      if (rec.fingerprint !== n.fp) {
        rec.sealed = this.sealer.seal(JSON.stringify({ outbound: n.p.outbound, rawLink: n.p.rawLink ?? null }))
        rec.fingerprint = n.fp
        rec.hasLink = !!n.p.rawLink
        updated++
      }
      rec.protocol = protocol
      rec.host = n.p.host
      rec.port = n.p.port
      rec.warnings = n.p.warnings
      rec.countryCode = n.p.countryHint ?? rec.countryCode
      if (!rec.nameEdited) rec.name = n.p.name
      rec.origName = n.p.name
    }

    let removed = 0
    for (const rec of mine) {
      if (claimed.has(rec) || keep.has(rec.id)) continue
      this.removeServer(rec.id, false)
      removed++
    }
    const fresh = incoming.filter((n) => !n.used)
    // сервер мог быть добавлен вручную до подписки — тогда присоединяем его к подписке, а не дублируем
    const adopt: ParsedServer[] = []
    for (const n of fresh) {
      const manual = this.data.servers.find((s) => s.fingerprint === n.fp && s.subscriptionId === null)
      if (manual) manual.subscriptionId = id
      else adopt.push(n.p)
    }
    const { added } = this.addServers(adopt, id)
    this.save()
    return { added: added.length, removed, kept: claimed.size, updated }
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
