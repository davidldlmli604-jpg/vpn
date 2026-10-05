import { parseSubscriptionBody, parseSubscriptionUserinfo, keyError, type ParseOutcome, type SubscriptionInfo } from '../../core'
import { httpGetWithFallback, HttpError } from './http'

export interface SubscriptionFetch {
  outcome: ParseOutcome
  info: SubscriptionInfo | null
  title: string | null
  intervalHours: number | null
}

/** Названия приходят то обычным текстом, то в виде «base64:…» — приводим к человеческому виду. */
function decodeTitle(raw: string | undefined): string | null {
  if (!raw) return null
  let t = raw.trim()
  if (/^base64:/i.test(t)) {
    try { t = Buffer.from(t.slice(7), 'base64').toString('utf8') } catch { return null }
  } else {
    try { t = decodeURIComponent(t) } catch { /* оставляем как есть */ }
  }
  t = t.replace(/[\u0000-\u001f]/g, '').trim()
  return t ? t.slice(0, 80) : null
}

function filenameFromDisposition(v: string | undefined): string | null {
  if (!v) return null
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(v)
  const plain = /filename="?([^";]+)"?/i.exec(v)
  const raw = star?.[1] ?? plain?.[1]
  if (!raw) return null
  try { return decodeURIComponent(raw).replace(/\.(txt|json|yaml|yml)$/i, '').trim() || null } catch { return raw }
}

/** Человеческое объяснение, почему подписку не удалось загрузить. */
export function subscriptionNetworkError(e: unknown): string {
  if (e instanceof HttpError) {
    if (e.kind === 'timeout') return 'Сайт подписки не отвечает. Проверьте интернет и попробуйте позже.'
    if (e.kind === 'status') {
      if (e.status === 401 || e.status === 403) return 'Сайт подписки не пустил: возможно, ссылка устарела или срок подписки закончился.'
      if (e.status === 404) return 'По этой ссылке ничего нет. Проверьте, что ссылка скопирована целиком.'
      return `Сайт подписки ответил ошибкой (${e.status}). Попробуйте позже.`
    }
    if (e.kind === 'too-large') return 'Ответ сайта подписки слишком большой — похоже, это не подписка.'
    if (e.kind === 'bad-url') return 'Адрес подписки записан неверно.'
  }
  return 'Не удалось связаться с сайтом подписки. Проверьте интернет и ссылку.'
}

export async function fetchSubscription(url: string, proxyPort: number | null): Promise<SubscriptionFetch> {
  try {
    // v2rayN-подобное имя клиента: так большинство панелей отдаёт обычный список ключей (а не формат другого клиента)
    const r = await httpGetWithFallback(url, { timeoutMs: 20000, headers: { 'User-Agent': 'v2rayN/7.0 Tropa' }, maxBytes: 6 * 1024 * 1024 }, proxyPort)
    if (r.status < 200 || r.status >= 300) throw new HttpError(`HTTP ${r.status}`, 'status', r.status)
    const outcome = parseSubscriptionBody(r.body.toString('utf8'))
    const info = parseSubscriptionUserinfo(first(r.headers['subscription-userinfo']))
    const hours = Number(first(r.headers['profile-update-interval']))
    return {
      outcome,
      info: Object.keys(info).length ? info : null,
      title: decodeTitle(first(r.headers['profile-title'])) ?? filenameFromDisposition(first(r.headers['content-disposition'])),
      intervalHours: Number.isFinite(hours) && hours > 0 ? Math.min(hours, 168) : null
    }
  } catch (e) {
    return { outcome: { kind: 'error', error: keyError('no-servers', undefined, subscriptionNetworkError(e)) }, info: null, title: null, intervalHours: null }
  }
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}
