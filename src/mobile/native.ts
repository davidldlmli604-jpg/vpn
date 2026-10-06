// Мост к «родной» части Android-версии (android/app/src/main/java/app/tropa/vpn/TropaPlugin.kt).
// Здесь только то, что на телефоне действительно другое: VPN через систему, шифрование, буфер обмена, камера.
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export type NativeStatus = 'off' | 'connecting' | 'on' | 'disconnecting'

export interface NativeStatusEvent {
  status: NativeStatus
  /** Текст ошибки движка или системы (для журнала и разбора в человеческие слова). */
  error?: string
  /** Человек отказал в разрешении на VPN или его забрало другое VPN-приложение. */
  revoked?: boolean
}

export interface NativeStats {
  /** Сколько байт программа отправила и получила с момента включения. */
  tx: number
  rx: number
}

export interface TropaNative {
  info(): Promise<{ version: string; engineVersion: string; secure: boolean }>
  /** Данные (настройки, ключи), расшифрованные ключом из хранилища Android. null — ещё ничего не сохраняли. */
  loadData(): Promise<{ text: string | null; broken?: boolean }>
  saveData(o: { text: string }): Promise<void>
  /** Загрузка подписки средствами Android. При ошибке — исключение с code: timeout | dns | tls | cleartext | too-large | bad-url | network. */
  httpGet(o: { url: string; userAgent: string; timeoutMs: number; maxBytes: number }): Promise<{ status: number; body: string; headers: Record<string, string> }>
  /** Время установки соединения с сервером, мс (или текст ошибки). */
  tcpPing(o: { host: string; port: number; timeoutMs: number }): Promise<{ ms?: number; error?: string }>
  readClipboard(): Promise<{ text: string }>
  writeClipboard(o: { text: string }): Promise<void>
  /** Открыть камеру и прочитать QR-код. null — человек закрыл сканер. */
  scanQr(): Promise<{ text: string | null; denied?: boolean }>
  /** Запуск VPN. Сначала система может спросить разрешение; consent: false — человек отказал. */
  start(o: { config: string; serverName: string }): Promise<{ consent: boolean }>
  stop(): Promise<void>
  status(): Promise<NativeStatusEvent & { since?: number }>
  stats(): Promise<NativeStats>
  addListener(event: 'status', cb: (e: NativeStatusEvent) => void): Promise<PluginListenerHandle>
}

export const Tropa = registerPlugin<TropaNative>('Tropa')
