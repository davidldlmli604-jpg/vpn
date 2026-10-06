// Типы, общие для «внутренностей» приложения (main) и окна (renderer). Только данные, никакой логики.
import type { Mode, SubscriptionInfo, TunStack } from '../core/types'
export type { Mode, SubscriptionInfo, TunStack }

export type ConnStatus = 'off' | 'connecting' | 'on' | 'error' | 'disconnecting'
export type Palette = 'aurora' | 'sunset' | 'forest'
export type ThemeMode = 'dark' | 'light' | 'system'
export type MotionLevel = 'full' | 'calm' | 'off'

export interface HumanError {
  /** Короткий заголовок: «Сервер не отвечает». */
  title: string
  /** Что случилось и что делать, простыми словами. */
  text: string
  /** Для журнала. */
  code: string
}

export interface BypassApp {
  /** Имя исполняемого файла, как его видит система: chrome.exe */
  exe: string
  /** Понятное название для показа. */
  name: string
  /** Полный путь (нужен только для иконки). */
  path?: string
}

export interface AdvancedSettings {
  /** Адрес DNS для запросов через VPN. */
  dnsRemote: string
  /** Адрес DNS для прямых запросов; «system» — как настроено в системе. */
  dnsDirect: string
  mtu: number
  mixedPort: number
  multiplex: boolean
  tunStack: TunStack
  tunIpv6: boolean
  strictRoute: boolean
  logLevel: 'warn' | 'info' | 'debug'
}

export interface Settings {
  mode: Mode
  theme: ThemeMode
  palette: Palette
  motion: MotionLevel
  bypassRu: boolean
  bypassGames: boolean
  bypassApps: BypassApp[]
  alwaysVpn: string[]
  alwaysDirect: string[]
  killSwitch: boolean
  dnsLeakProtection: boolean
  autostart: boolean
  connectOnLaunch: boolean
  autoReconnect: boolean
  notifications: boolean
  /** Шелти — собака-помощник: следит за курсором и подсказывает, что делает кнопка под мышкой. */
  assistant: boolean
  closeToTray: boolean
  /** Сама проверять и скачивать новые версии (с GitHub). */
  autoUpdate: boolean
  wizardDone: boolean
  selectedServerId: string | null
  advanced: AdvancedSettings
}

export type LatencyState = { ms: number } | { error: string } | 'testing' | null

export interface ServerView {
  id: string
  name: string
  protocol: string
  host: string
  port: number
  countryCode: string | null
  favorite: boolean
  subscriptionId: string | null
  latency: LatencyState
  /** Можно ли показать QR-код (у серверов из готового файла sing-box исходной ссылки нет). */
  canQr: boolean
  /** Предупреждения при разборе ключа. */
  warnings: string[]
  addedAt: number
}

export interface SubscriptionView {
  id: string
  name: string
  /** Адрес без секретной части: https://host/… */
  displayUrl: string
  updatedAt: number | null
  serverCount: number
  info: SubscriptionInfo | null
  error: string | null
  refreshing: boolean
}

export interface ExitInfo {
  checking: boolean
  /** Двухбуквенный код страны, под которой нас видит интернет. */
  countryCode: string | null
  countryName: string | null
  /** Адрес хранится целиком только в памяти; на экран выводится как есть — это ваш собственный выходной адрес. */
  ip: string | null
  error: string | null
}

export interface ConnState {
  status: ConnStatus
  error: HumanError | null
  serverId: string | null
  /** Когда подключились (мс). */
  since: number | null
  reconnect: { attempt: number; nextInMs: number } | null
  /** Связь с сервером пропала, а движок работает. */
  degraded: boolean
  /** Режим, в котором реально работаем сейчас. */
  mode: Mode | null
  /** Связь оборвалась, и защита намеренно держит интернет закрытым, пока VPN не вернётся. */
  blocked: boolean
}

/** Обновление программы: проверка, скачивание, готово к установке. */
export interface UpdateInfo {
  /** unsupported — обновления работают только в установленной программе (не в папке разработки и не в переносимой версии). */
  status: 'unsupported' | 'idle' | 'checking' | 'latest' | 'downloading' | 'ready' | 'error'
  /** Новая версия (когда нашлась). */
  version: string | null
  /** Сколько скачано, 0–100. */
  percent: number
  error: string | null
  checkedAt: number | null
}

export interface SystemInfo {
  platform: 'win32' | 'linux' | 'darwin'
  appVersion: string
  isAdmin: boolean
  /** Задача планировщика для запуска без вопросов уже создана. */
  elevationReady: boolean
  singbox: { found: boolean; version: string | null; path: string | null }
  secureStorage: boolean
  rules: { updatedAt: number | null; count: number; updating: boolean; bundledOnly: boolean }
  /** Приложение запущено «свернутым» (с автозапуском). */
  startedHidden: boolean
  killSwitchActive: boolean
  update: UpdateInfo
}

export interface QrResult {
  ok: boolean
  /** Картинка (data URL) — только если ok. */
  dataUrl?: string
  /** Что показано: «Ключ сервера …» / «Подписка …» (без секретов). */
  title?: string
  message?: string
}

export interface AppState {
  conn: ConnState
  exit: ExitInfo
  servers: ServerView[]
  subscriptions: SubscriptionView[]
  settings: Settings
  system: SystemInfo
  /** Ход и итог кнопки «Проверить, всё ли работает»; null — проверку ещё не запускали. */
  check: CheckReport | null
}

export interface StatsSample {
  t: number
  upBps: number
  downBps: number
  upTotal: number
  downTotal: number
  /** Задержка до сервера, мс; null — неизвестно. */
  latencyMs: number | null
}

export interface AddResult {
  ok: boolean
  /** Сколько серверов добавлено. */
  added: number
  /** Что делать дальше (например, подписка найдена и загружается). */
  kind: 'servers' | 'subscription' | 'error'
  message: string
  /** Серверы, которые не удалось прочитать (подсказки без секретов). */
  skipped: string[]
  /** id первого добавленного сервера. */
  firstId: string | null
}

export interface RunningApp {
  exe: string
  name: string
  path: string | null
  icon: string | null
}

export interface CheckStep {
  id: 'address' | 'dns' | 'ru-direct' | 'server'
  title: string
  status: 'pending' | 'running' | 'ok' | 'warn' | 'fail'
  /** Результат простыми словами. */
  detail: string
}

export interface CheckReport {
  startedAt: number
  finished: boolean
  steps: CheckStep[]
  /** Итог одной-двумя фразами. */
  summary: string
  verdict: 'ok' | 'warn' | 'fail' | null
}

export interface ConfigPreview {
  json: string
  /** Какой режим и какой сервер (без секретов). */
  note: string
}
