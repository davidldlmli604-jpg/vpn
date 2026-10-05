// Договор между окном и «внутренностями»: что окно может попросить и о чём оно узнаёт.
import type { AddResult, AppState, Settings, StatsSample } from './types'

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

  // подключение
  connect(serverId?: string): Promise<void>
  disconnect(): Promise<void>

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
  'getState', 'pasteKey', 'addKeyText', 'selectServer', 'renameServer', 'removeServer', 'toggleFavorite',
  'connect', 'disconnect', 'updateSettings', 'updateAdvanced', 'windowAction', 'quit'
] as const

declare global {
  interface Window {
    vpn?: VpnApi
  }
}
