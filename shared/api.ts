// Договор между окном и «внутренностями»: что окно может попросить и о чём оно узнаёт.
import type { AddResult, AppState, QrResult, RunningApp, Settings, StatsSample } from './types'

export interface ToastMessage {
  id: string
  kind: 'info' | 'success' | 'warn' | 'error'
  text: string
}

export interface VpnApi {
  getState(): Promise<AppState>
  onState(cb: (s: AppState) => void): () => void
  onStats(cb: (s: StatsSample) => void): () => void
  onToast(cb: (t: ToastMessage) => void): () => void
  onNavigate(cb: (page: string) => void): () => void

  // ключи и серверы
  pasteKey(): Promise<AddResult>
  addKeyText(text: string): Promise<AddResult>
  selectServer(id: string): Promise<void>
  renameServer(id: string, name: string): Promise<void>
  removeServer(id: string): Promise<void>
  toggleFavorite(id: string): Promise<void>
  /** Проверить задержку серверов (всех, если список не указан). Результаты приходят в состоянии по мере готовности. */
  pingServers(ids?: string[]): Promise<void>

  // подписки
  /** Обновить подписку сейчас (список серверов берётся заново; названия и «любимые» сохраняются). */
  refreshSubscription(id: string): Promise<{ ok: boolean; message: string }>
  renameSubscription(id: string, name: string): Promise<void>
  /** Удаляет подписку вместе с её серверами. */
  removeSubscription(id: string): Promise<void>

  /** QR-код ключа сервера или адреса подписки (по запросу человека; сами ключи на экран не выводятся). */
  getQr(kind: 'server' | 'subscription', id: string): Promise<QrResult>

  // проверка
  /** «Проверить, всё ли работает»: ход проверки приходит в состоянии (поле check), итог — в ответе. */
  runCheck(): Promise<void>
  clearCheck(): Promise<void>

  // подключение
  connect(serverId?: string): Promise<void>
  disconnect(): Promise<void>
  /** Включить режим «весь компьютер»: при необходимости один раз попросит права администратора. */
  requestTunMode(): Promise<{ ok: boolean; message: string; relaunching: boolean }>
  /** Забрать выданное разрешение администратора (удаляет задачу планировщика). */
  revokeElevation(): Promise<{ ok: boolean; message: string }>

  // исключения
  listRunningApps(): Promise<RunningApp[]>
  listInstalledApps(): Promise<RunningApp[]>
  updateRules(): Promise<{ ok: boolean; message: string }>

  // настройки
  updateSettings(patch: Partial<Settings>): Promise<void>
  updateAdvanced(patch: Partial<Settings['advanced']>): Promise<void>

  // окно
  windowAction(action: 'minimize' | 'close' | 'hide-to-tray'): Promise<void>
  quit(): Promise<void>
}

export const IPC = {
  state: 'vpn:state',
  stats: 'vpn:stats',
  toast: 'vpn:toast',
  navigate: 'vpn:navigate',
  invoke: 'vpn:invoke'
} as const

/** Методы, которые разрешено вызывать из окна. Всё остальное «внутренности» отвергают. */
export const INVOKABLE = [
  'getState', 'pasteKey', 'addKeyText', 'selectServer', 'renameServer', 'removeServer', 'toggleFavorite', 'pingServers', 'refreshSubscription', 'renameSubscription', 'removeSubscription', 'getQr', 'runCheck', 'clearCheck',
  'connect', 'disconnect', 'requestTunMode', 'revokeElevation', 'listRunningApps', 'listInstalledApps', 'updateRules', 'updateSettings', 'updateAdvanced', 'windowAction', 'quit'
] as const

declare global {
  interface Window {
    vpn?: VpnApi
  }
}
