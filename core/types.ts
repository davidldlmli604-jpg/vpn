// Общие типы модуля core. Здесь нет ничего, что привязано к Electron, Node или браузеру.

/** Описание одного исходящего подключения в формате sing-box (без поля tag — его проставляет сборщик). */
export type Outbound = Record<string, unknown>

export type Protocol =
  | 'vless'
  | 'vmess'
  | 'trojan'
  | 'shadowsocks'
  | 'hysteria2'
  | 'tuic'
  | 'anytls'
  | 'other'

/** Один сервер, разобранный из ключа. */
export interface ParsedServer {
  protocol: Protocol
  /** Название для показа человеку (без флагов-эмодзи, они не рисуются в Windows). */
  name: string
  host: string
  port: number
  outbound: Outbound
  /** Исходная ссылка — нужна, чтобы показать QR-код. У серверов из готового файла sing-box её нет. */
  rawLink?: string
  /** Двухбуквенный код страны, если удалось угадать по названию. */
  countryHint?: string
  /** Предупреждения простыми словами (например, «часть настроек не поддерживается движком»). */
  warnings: string[]
}

export type KeyErrorCode =
  | 'empty'
  | 'not-a-key'
  | 'broken'
  | 'missing-host'
  | 'missing-port'
  | 'bad-port'
  | 'missing-secret'
  | 'bad-secret'
  | 'bad-encoding'
  | 'bad-json'
  | 'unsupported-protocol'
  | 'unsupported-transport'
  | 'unsupported-cipher'
  | 'unsupported-feature'
  | 'no-servers'

export interface KeyError {
  code: KeyErrorCode
  /** Готовая фраза для человека, по-русски. */
  message: string
  /** Какая именно часть ключа (для журнала и отладки, без секретов). */
  detail?: string
}

export interface ParseFailure {
  error: KeyError
  /** Начало строки (без секретов) — чтобы человек понял, о каком ключе речь. */
  hint: string
}

export type ParseOutcome =
  | { kind: 'servers'; servers: ParsedServer[]; failures: ParseFailure[]; source: 'link' | 'list' | 'singbox-json' | 'subscription-body' }
  | { kind: 'subscription-url'; url: string }
  | { kind: 'error'; error: KeyError }

export interface SubscriptionInfo {
  /** Байт отправлено / получено / всего по тарифу. */
  upload?: number
  download?: number
  total?: number
  /** Когда истекает (миллисекунды с 1970 года). */
  expireAt?: number
}

export type TunStack = 'mixed' | 'system' | 'gvisor'
export type Mode = 'tun' | 'proxy'
