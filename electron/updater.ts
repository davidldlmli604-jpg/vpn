// Автообновление: программа сама узнаёт о новой версии на GitHub (раздел Releases), скачивает её в фоне
// и ставит при закрытии — или сразу, по кнопке «Обновить сейчас». На GitHub ничего не отправляется:
// программа только читает список выпусков и скачивает файл установщика.
import type { UpdateInfo } from '../shared/types'

/** То, что нужно от electron-updater (в тестах — заглушка). */
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, cb: (...args: any[]) => void): unknown
}

export const UPDATE_EVERY_MS = 6 * 60 * 60 * 1000
const FIRST_CHECK_MS = 20_000

export function initialUpdate(supported: boolean): UpdateInfo {
  return { status: supported ? 'idle' : 'unsupported', version: null, percent: 0, error: null, checkedAt: null }
}

/** Ошибку обновления — человеческими словами (подробности уходят в журнал). */
export function humanUpdateError(message: string): string {
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|net::ERR|socket hang up|timeout/i.test(message)) return 'Не удалось связаться с GitHub. Проверю позже сами.'
  if (/404|No published versions|Cannot find latest|latest\.yml/i.test(message)) return 'На GitHub пока нет выпущенных версий.'
  if (/sha512|checksum/i.test(message)) return 'Скачанный файл повреждён — скачаю заново при следующей проверке.'
  return 'Не получилось проверить обновления. Попробую позже.'
}

export class UpdateService {
  state: UpdateInfo
  private timer: ReturnType<typeof setInterval> | null = null
  private first: ReturnType<typeof setTimeout> | null = null
  /** Человек нажал «Проверить» сам: результат показываем, даже если новой версии нет. */
  private manual = false
  /** Установка уже запущена — повторно не запускаем. */
  installing = false

  constructor(
    private readonly u: UpdaterLike | null,
    private readonly deps: {
      onChange: (s: UpdateInfo) => void
      log: (line: string) => void
      /** Сообщение человеку (всплывашка в окне). */
      tell: (kind: 'info' | 'success' | 'warn', text: string) => void
      /** Новая версия скачана (для уведомления Windows). */
      onReady: (version: string) => void
    }
  ) {
    this.state = initialUpdate(!!u)
    if (!u) return
    u.autoDownload = true
    // ставим сами при выходе (см. installOnQuit): штатная установка «при закрытии» не срабатывает, потому что
    // программа выходит через app.exit() после того, как аккуратно выключит VPN
    u.autoInstallOnAppQuit = false
    u.on('checking-for-update', () => this.set({ status: 'checking', error: null }))
    u.on('update-available', (info: { version?: string }) => {
      this.deps.log(`Нашлась новая версия ${info?.version ?? ''}, скачиваю`)
      this.set({ status: 'downloading', version: info?.version ?? null, percent: 0 })
    })
    u.on('update-not-available', () => {
      this.set({ status: 'latest', checkedAt: Date.now() })
      if (this.manual) this.deps.tell('success', 'У вас последняя версия.')
      this.manual = false
    })
    u.on('download-progress', (p: { percent?: number }) => {
      const percent = Math.max(0, Math.min(100, Math.round(p?.percent ?? 0)))
      if (percent !== this.state.percent) this.set({ status: 'downloading', percent })
    })
    u.on('update-downloaded', (info: { version?: string }) => {
      const version = info?.version ?? this.state.version ?? ''
      this.deps.log(`Новая версия ${version} скачана`)
      this.set({ status: 'ready', version, percent: 100, checkedAt: Date.now() })
      this.deps.tell('success', `Скачана новая версия ${version}. Она установится, когда вы закроете программу, — или нажмите «Обновить сейчас» в Настройках.`)
      this.deps.onReady(version)
      this.manual = false
    })
    u.on('error', (e: Error) => {
      const raw = e?.message ?? String(e)
      this.deps.log(`Обновление: ${raw.split('\n')[0]!.slice(0, 300)}`)
      // уже скачанная версия никуда не делась — сбой следующей проверки её не отменяет
      if (this.state.status === 'ready') return
      const text = humanUpdateError(raw)
      this.set({ status: 'error', error: text, checkedAt: Date.now() })
      if (this.manual) this.deps.tell('warn', text)
      this.manual = false
    })
  }

  private set(patch: Partial<UpdateInfo>): void {
    this.state = { ...this.state, ...patch }
    this.deps.onChange(this.state)
  }

  /** Включить/выключить фоновые проверки (настройка «Обновлять автоматически»). */
  schedule(enabled: boolean): void {
    if (this.first) clearTimeout(this.first)
    if (this.timer) clearInterval(this.timer)
    this.first = this.timer = null
    if (!enabled || !this.u) return
    this.first = setTimeout(() => void this.check(false), FIRST_CHECK_MS)
    this.timer = setInterval(() => void this.check(false), UPDATE_EVERY_MS)
  }

  async check(manual: boolean): Promise<void> {
    if (!this.u) {
      if (manual) this.deps.tell('info', 'Обновления работают только в установленной программе.')
      return
    }
    if (this.state.status === 'checking' || this.state.status === 'downloading') return
    if (this.state.status === 'ready') {
      if (manual) this.deps.tell('info', `Версия ${this.state.version} уже скачана — нажмите «Обновить сейчас».`)
      return
    }
    this.manual = manual
    try {
      await this.u.checkForUpdates()
    } catch {
      /* ошибка придёт событием 'error' */
    }
  }

  /** «Обновить сейчас»: тихая установка, после неё программа откроется сама. */
  installNow(): boolean {
    if (!this.u || this.state.status !== 'ready' || this.installing) return false
    this.installing = true
    this.u.quitAndInstall(true, true)
    return true
  }

  /** Программа закрывается, а новая версия уже скачана: ставим тихо, без повторного запуска. */
  installOnQuit(): boolean {
    if (!this.u || this.state.status !== 'ready' || this.installing) return false
    this.installing = true
    this.u.quitAndInstall(true, false)
    return true
  }

  dispose(): void {
    this.schedule(false)
  }
}
