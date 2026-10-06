import type { Settings } from './types'

export const DEFAULT_SETTINGS: Settings = {
  mode: 'proxy',
  theme: 'dark',
  palette: 'aurora',
  motion: 'full',
  bypassRu: true,
  bypassGames: false,
  bypassApps: [],
  alwaysVpn: [],
  alwaysDirect: [],
  killSwitch: false,
  dnsLeakProtection: true,
  autostart: false,
  connectOnLaunch: false,
  autoReconnect: true,
  notifications: true,
  assistant: true,
  closeToTray: true,
  wizardDone: false,
  selectedServerId: null,
  advanced: {
    dnsRemote: 'https://1.1.1.1/dns-query',
    dnsDirect: 'system',
    mtu: 9000,
    mixedPort: 7890,
    multiplex: false,
    tunStack: 'mixed',
    tunIpv6: false,
    strictRoute: true,
    logLevel: 'info'
  }
}

/** Берёт сохранённые настройки и добавляет недостающие поля значениями по умолчанию (на случай старой версии файла). */
export function mergeSettings(saved: Partial<Settings> | null | undefined): Settings {
  const s = saved ?? {}
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    advanced: { ...DEFAULT_SETTINGS.advanced, ...(s.advanced ?? {}) },
    bypassApps: Array.isArray(s.bypassApps) ? s.bypassApps : [],
    alwaysVpn: Array.isArray(s.alwaysVpn) ? s.alwaysVpn : [],
    alwaysDirect: Array.isArray(s.alwaysDirect) ? s.alwaysDirect : []
  }
}
