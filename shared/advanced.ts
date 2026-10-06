// Проверка настроек «Для специалиста»: неверное значение не принимается, человеку объясняют почему.
import { parseDnsSpec } from '../core/config/dnsSpec'
import { DEFAULT_SETTINGS } from './defaults'
import type { AdvancedSettings } from './types'

export const MTU_RANGE: [number, number] = [1280, 9000]
export const PORT_RANGE: [number, number] = [1024, 65535]

const STACKS = ['mixed', 'system', 'gvisor'] as const
const LEVELS = ['warn', 'info', 'debug'] as const

export interface AdvancedCheck {
  /** Готовые к применению настройки: принятые значения изменены, остальные прежние. */
  value: AdvancedSettings
  /** Что не принято и почему — простыми словами (по одной фразе на поле). */
  problems: string[]
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

export function checkAdvanced(patch: Partial<AdvancedSettings>, current: AdvancedSettings): AdvancedCheck {
  const value: AdvancedSettings = { ...current }
  const problems: string[] = []

  if (patch.mtu !== undefined) {
    if (isInt(patch.mtu) && patch.mtu >= MTU_RANGE[0] && patch.mtu <= MTU_RANGE[1]) value.mtu = patch.mtu
    else problems.push(`Размер пакета (MTU) должен быть целым числом от ${MTU_RANGE[0]} до ${MTU_RANGE[1]}. Оставил ${current.mtu}.`)
  }
  if (patch.mixedPort !== undefined) {
    if (isInt(patch.mixedPort) && patch.mixedPort >= PORT_RANGE[0] && patch.mixedPort <= PORT_RANGE[1]) value.mixedPort = patch.mixedPort
    else problems.push(`Порт должен быть целым числом от ${PORT_RANGE[0]} до ${PORT_RANGE[1]}. Оставил ${current.mixedPort}.`)
  }
  if (patch.dnsRemote !== undefined) {
    const text = patch.dnsRemote.trim()
    const spec = parseDnsSpec(text)
    if (!spec || spec.type === 'local') problems.push('Не понял адрес DNS для запросов через VPN. Подойдёт, например, https://1.1.1.1/dns-query, tls://dns.google или 8.8.8.8. Оставил прежний.')
    else value.dnsRemote = text
  }
  if (patch.dnsDirect !== undefined) {
    const text = patch.dnsDirect.trim()
    if (!parseDnsSpec(text)) problems.push('Не понял адрес DNS для прямых запросов. Напишите «system» (как в системе) или адрес, например 77.88.8.8. Оставил прежний.')
    else value.dnsDirect = text.toLowerCase() === 'local' ? 'system' : text
  }
  if (patch.tunStack !== undefined) {
    if ((STACKS as readonly string[]).includes(patch.tunStack)) value.tunStack = patch.tunStack
    else problems.push('Неизвестный сетевой стек туннеля.')
  }
  if (patch.logLevel !== undefined) {
    if ((LEVELS as readonly string[]).includes(patch.logLevel)) value.logLevel = patch.logLevel
    else problems.push('Неизвестный уровень подробности журнала.')
  }
  for (const k of ['multiplex', 'tunIpv6', 'strictRoute'] as const) {
    if (patch[k] !== undefined) {
      if (typeof patch[k] === 'boolean') value[k] = patch[k]!
      else problems.push('Выключатель принимает только «включено» или «выключено».')
    }
  }
  return { value, problems }
}

export const DEFAULT_ADVANCED: AdvancedSettings = DEFAULT_SETTINGS.advanced
