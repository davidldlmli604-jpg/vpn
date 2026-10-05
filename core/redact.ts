// Скрытие секретов: ключи не должны попадать целиком ни на экран, ни в журнал.

const SECRET_FIELDS = new Set([
  'uuid', 'password', 'private_key', 'pre_shared_key', 'psk', 'secret', 'token', 'auth_str', 'auth', 'key', 'short_id', 'public_key', 'obfs_password', 'username'
])
const MASK = '••••••••'

/** Короткий безопасный вид ключа для экрана: схема и адрес сервера, без секретной части. */
export function maskKey(link: string): string {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(.*)$/.exec(link.trim())
  if (!m) return MASK
  const rest = m[2]!
  const at = rest.lastIndexOf('@')
  if (at === -1) return `${m[1]!.toLowerCase()}://${MASK}`
  const hostPart = rest.slice(at + 1).split(/[?#/]/)[0]!
  return `${m[1]!.toLowerCase()}://${MASK}@${hostPart}`
}

/** Копия конфига, в которой все секретные поля заменены. Для показа в разделе «Для специалиста». */
export function redactConfig<T>(value: T): T {
  const walk = (v: unknown, key?: string): unknown => {
    if (Array.isArray(v)) return v.map((x) => walk(x, key))
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = walk(x, k)
      return out
    }
    if (key && SECRET_FIELDS.has(key) && typeof v === 'string' && v.length > 0) return MASK
    return v
  }
  return walk(value) as T
}

const UUID_RE = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g
const LINK_RE = /\b(vless|vmess|trojan|ss|hysteria2|hy2|tuic|anytls):\/\/\S+/gi
const URL_TOKEN_RE = /(https?:\/\/[^\s/?#]+)(\/[^\s]*)?/gi
const KV_RE = /\b(password|passwd|secret|token|uuid|auth|key|psk|public_key|private_key)(["']?\s*[:=]\s*["']?)([^\s"',}&]+)/gi

/** Чистит строку журнала: ключи, идентификаторы, пароли и «хвосты» ссылок. */
export function redactLogLine(line: string): string {
  return line
    .replace(LINK_RE, (m) => maskKey(m))
    .replace(UUID_RE, '••••-uuid-••••')
    .replace(KV_RE, (_m, k: string, sep: string) => `${k}${sep}${MASK}`)
    .replace(URL_TOKEN_RE, (_m, origin: string, rest?: string) => (rest && rest.length > 1 ? `${origin}/…` : origin))
}
