import type { VpnApi } from '@shared/api'

let cached: VpnApi | null = null

/** В приложении окно получает возможности из preload (window.vpn). В обычном браузере (для просмотра оформления) — тестовый «бэкенд». */
export async function loadApi(): Promise<VpnApi> {
  if (cached) return cached
  if (window.vpn) {
    cached = window.vpn
  } else if (import.meta.env.MODE === 'mock') {
    const { createMockApi } = await import('./dev/mockApi')
    cached = createMockApi()
  } else {
    throw new Error('Окно запущено вне приложения')
  }
  return cached
}

export function api(): VpnApi {
  if (!cached) throw new Error('API ещё не загружен')
  return cached
}
