// Подписки: разбор ответа сайта подписки — общий для Windows и Android (сеть у каждой версии своя).
import { keyError, parseSubscriptionBody, parseSubscriptionUserinfo } from '../core'
import type { ParseOutcome, SubscriptionInfo } from '../core/types'

export interface SubscriptionFetch {
  outcome: ParseOutcome
  info: SubscriptionInfo | null
  title: string | null
  intervalHours: number | null
}

/** Так представляемся сайту подписки: v2rayN-подобное имя — большинство панелей отдаёт обычный список ключей. */
export const SUBSCRIPTION_USER_AGENT = 'v2rayN/7.0 Tropa'
export const SUBSCRIPTION_MAX_BYTES = 6 * 1024 * 1024

function fromBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\s+/g, ''))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

/** Названия приходят то обычным текстом, то в виде «base64:…» — приводим к человеческому виду. */
export function decodeTitle(raw: string | null | undefined): string | null {
  if (!raw) return null
  let t = raw.trim()
  if (/^base64:/i.test(t)) {
    try { t = fromBase64Utf8(t.slice(7)) } catch { return null }
  } else {
    try { t = decodeURIComponent(t) } catch { /* оставляем как есть */ }
  }
  t = t.replace(/[\u0000-\u001f]/g, '').trim()
  return t ? t.slice(0, 80) : null
}

export function filenameFromDisposition(v: string | null | undefined): string | null {
  if (!v) return null
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(v)
  const plain = /filename="?([^";]+)"?/i.exec(v)
  const raw = star?.[1] ?? plain?.[1]
  if (!raw) return null
  try { return decodeURIComponent(raw).replace(/\.(txt|json|yaml|yml)$/i, '').trim() || null } catch { return raw }
}

/** Пора ли обновлять подписку: по сроку из настроек поставщика; после неудачи не чаще раза в полчаса. */
export function subscriptionDue(rec: { updatedAt: number | null; intervalHours: number; error: string | null }, now: number, lastTry: number | undefined): boolean {
  if (lastTry !== undefined && now - lastTry < (rec.error ? 30 : 60) * 60_000) return false
  if (rec.updatedAt === null) return true
  return now - rec.updatedAt >= rec.intervalHours * 3_600_000
}

export type SubscriptionFailure = 'timeout' | 'status' | 'too-large' | 'bad-url' | 'network'

/** Человеческое объяснение, почему подписку не удалось загрузить. */
export function subscriptionErrorText(kind: SubscriptionFailure, status?: number): string {
  if (kind === 'timeout') return 'Сайт подписки не отвечает. Проверьте интернет и попробуйте позже. Если сайт у вас заблокирован — включите VPN через другой ключ и повторите.'
  if (kind === 'status') {
    if (status === 401 || status === 403) return 'Сайт подписки не пустил: возможно, ссылка устарела или срок подписки закончился.'
    if (status === 404) return 'По этой ссылке ничего нет. Проверьте, что ссылка скопирована целиком.'
    return `Сайт подписки ответил ошибкой (${status ?? '?'}). Попробуйте позже.`
  }
  if (kind === 'too-large') return 'Ответ сайта подписки слишком большой — похоже, это не подписка.'
  if (kind === 'bad-url') return 'Адрес подписки записан неверно.'
  return 'Не удалось связаться с сайтом подписки. Проверьте интернет и ссылку. Если сайт у вас заблокирован — включите VPN через другой ключ и повторите.'
}

export function subscriptionFailed(kind: SubscriptionFailure, status?: number): SubscriptionFetch {
  return { outcome: { kind: 'error', error: keyError('no-servers', undefined, subscriptionErrorText(kind, status)) }, info: null, title: null, intervalHours: null }
}

/** Ответ сайта подписки → серверы, остаток трафика, название, как часто обновлять. */
export function parseSubscriptionResponse(body: string, header: (name: string) => string | null | undefined): SubscriptionFetch {
  const outcome = parseSubscriptionBody(body)
  const info = parseSubscriptionUserinfo(header('subscription-userinfo') ?? undefined)
  const hours = Number(header('profile-update-interval'))
  return {
    outcome,
    info: Object.keys(info).length ? info : null,
    title: decodeTitle(header('profile-title')) ?? filenameFromDisposition(header('content-disposition')),
    intervalHours: Number.isFinite(hours) && hours > 0 ? Math.min(hours, 168) : null
  }
}
