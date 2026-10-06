// Значок в трее (возле часов): состояние подключения одним взглядом и быстрые действия.
// Здесь нет прямой зависимости от Electron: нужные классы приходят извне (в тестах — подставные).
import { join } from 'node:path'
import type { ConnState } from '../shared/types'

export type TrayStatus = 'off' | 'connecting' | 'on' | 'error'

export function trayStatusOf(conn: ConnState): TrayStatus {
  if (conn.status === 'on') return conn.degraded ? 'error' : 'on'
  if (conn.status === 'connecting') return conn.blocked ? 'error' : 'connecting'
  if (conn.status === 'error') return 'error'
  return 'off'
}

export function statusWords(conn: ConnState): string {
  if (conn.status === 'on') return conn.degraded ? 'нет связи с сервером' : 'работает'
  if (conn.status === 'connecting') return conn.reconnect ? (conn.blocked ? 'связь оборвалась, интернет закрыт защитой' : 'связь оборвалась, подключаюсь снова') : 'подключаюсь'
  if (conn.status === 'error') return conn.blocked ? 'интернет закрыт защитой' : 'ошибка подключения'
  if (conn.status === 'disconnecting') return 'отключаю'
  return 'выключено'
}

export function trayTooltip(name: string, conn: ConnState, serverName: string | null): string {
  const server = (conn.status === 'on' || conn.status === 'connecting') && serverName ? ` · ${serverName}` : ''
  return `${name}: ${statusWords(conn)}${server}`
}

export interface TrayMenuItem {
  label?: string
  type?: 'separator'
  enabled?: boolean
  click?: () => void
}

export interface TrayActions {
  toggle(): void
  showWindow(): void
  quit(): void
}

export function buildTrayMenu(name: string, conn: ConnState, serverName: string | null, hasServers: boolean, actions: TrayActions): TrayMenuItem[] {
  const busy = conn.status === 'disconnecting'
  const toggleLabel = conn.status === 'on' ? 'Выключить VPN' : conn.status === 'connecting' ? 'Отменить подключение' : 'Включить VPN'
  const items: TrayMenuItem[] = [
    { label: trayTooltip(name, conn, serverName), enabled: false },
    { type: 'separator' }
  ]
  // без ключей включать нечего — пункт ведёт в окно, где можно вставить ключ
  if (!hasServers && conn.status !== 'on') items.push({ label: 'Сначала добавьте ключ…', click: actions.showWindow })
  else items.push({ label: toggleLabel, enabled: !busy, click: actions.toggle })
  items.push({ label: 'Открыть окно', click: actions.showWindow }, { type: 'separator' }, { label: 'Выйти', click: actions.quit })
  return items
}

/** То, что нужно от Electron: заменяется в тестах. */
export interface TrayLike {
  setToolTip(t: string): void
  setImage(img: unknown): void
  setContextMenu(menu: unknown): void
  on(event: 'click' | 'double-click' | 'right-click', cb: () => void): void
  destroy(): void
}
export interface TrayDeps {
  createTray(icon: unknown): TrayLike
  createMenu(items: TrayMenuItem[]): unknown
  loadIcon(path: string): unknown
  iconDir: string
  name: string
  actions: TrayActions
  /** Окно сейчас на экране? Нужно, чтобы нажатие по значку то показывало окно, то прятало. */
  isWindowVisible(): boolean
  hideWindow(): void
}

export class TrayController {
  private tray: TrayLike | null = null
  private shown: TrayStatus | null = null
  private lastMenuKey = ''

  constructor(private readonly d: TrayDeps) {}

  get ready(): boolean {
    return this.tray !== null
  }

  private icon(status: TrayStatus): unknown {
    return this.d.loadIcon(join(this.d.iconDir, `${status}.png`))
  }

  /** Создаёт значок. Возвращает false, если системе не удалось его показать (тогда окно закрывается как обычно). */
  create(conn: ConnState, serverName: string | null, hasServers: boolean): boolean {
    try {
      const status = trayStatusOf(conn)
      this.tray = this.d.createTray(this.icon(status))
      this.shown = status
      this.tray.on('click', () => (this.d.isWindowVisible() ? this.d.hideWindow() : this.d.actions.showWindow()))
      this.tray.on('double-click', () => this.d.actions.showWindow())
      this.update(conn, serverName, hasServers)
      return true
    } catch {
      this.tray = null
      return false
    }
  }

  update(conn: ConnState, serverName: string | null, hasServers: boolean): void {
    const t = this.tray
    if (!t) return
    const status = trayStatusOf(conn)
    if (status !== this.shown) {
      t.setImage(this.icon(status))
      this.shown = status
    }
    t.setToolTip(trayTooltip(this.d.name, conn, serverName))
    // меню пересобираем только когда оно действительно изменилось
    const key = `${conn.status}|${conn.degraded}|${conn.blocked}|${!!conn.reconnect}|${serverName ?? ''}|${hasServers}`
    if (key !== this.lastMenuKey) {
      this.lastMenuKey = key
      t.setContextMenu(this.d.createMenu(buildTrayMenu(this.d.name, conn, serverName, hasServers, this.d.actions)))
    }
  }

  destroy(): void {
    try { this.tray?.destroy() } catch { /* уже уничтожен */ }
    this.tray = null
  }
}
