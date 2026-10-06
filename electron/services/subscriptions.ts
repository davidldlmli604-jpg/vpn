// Загрузка подписки на Windows (сеть Node, при необходимости — через наш VPN). Разбор ответа — общий: shared/subscriptions.ts.
import { parseSubscriptionResponse, subscriptionErrorText, subscriptionFailed, SUBSCRIPTION_MAX_BYTES, SUBSCRIPTION_USER_AGENT, type SubscriptionFetch } from '../../shared/subscriptions'
import { httpGetWithFallback, HttpError } from './http'

export { subscriptionDue, type SubscriptionFetch } from '../../shared/subscriptions'

/** Человеческое объяснение, почему подписку не удалось загрузить. */
export function subscriptionNetworkError(e: unknown): string {
  if (e instanceof HttpError && (e.kind === 'timeout' || e.kind === 'status' || e.kind === 'too-large' || e.kind === 'bad-url')) return subscriptionErrorText(e.kind, e.status)
  return subscriptionErrorText('network')
}

export async function fetchSubscription(url: string, proxyPort: number | null): Promise<SubscriptionFetch> {
  try {
    const r = await httpGetWithFallback(url, { timeoutMs: 20000, headers: { 'User-Agent': SUBSCRIPTION_USER_AGENT }, maxBytes: SUBSCRIPTION_MAX_BYTES }, proxyPort)
    if (r.status < 200 || r.status >= 300) throw new HttpError(`HTTP ${r.status}`, 'status', r.status)
    return parseSubscriptionResponse(r.body.toString('utf8'), (name) => first(r.headers[name]))
  } catch (e) {
    if (e instanceof HttpError && (e.kind === 'timeout' || e.kind === 'status' || e.kind === 'too-large' || e.kind === 'bad-url')) return subscriptionFailed(e.kind, e.status)
    return subscriptionFailed('network')
  }
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}
