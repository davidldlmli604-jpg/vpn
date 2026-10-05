import { abort } from '../errors'
import type { ParsedServer } from '../types'
import { base64ToText, compact, safeDecodeURIComponent } from '../util/text'
import { splitShareLink, requireHostPort, normalizeServerPort } from './shareLink'

const CIPHERS = new Set([
  'none', 'plain',
  'aes-128-gcm', 'aes-192-gcm', 'aes-256-gcm',
  'chacha20-ietf-poly1305', 'xchacha20-ietf-poly1305',
  '2022-blake3-aes-128-gcm', '2022-blake3-aes-256-gcm', '2022-blake3-chacha20-poly1305',
  'aes-128-ctr', 'aes-192-ctr', 'aes-256-ctr',
  'aes-128-cfb', 'aes-192-cfb', 'aes-256-cfb',
  'rc4-md5', 'chacha20-ietf', 'xchacha20'
])
const CIPHER_ALIASES: Record<string, string> = {
  'chacha20-poly1305': 'chacha20-ietf-poly1305',
  'xchacha20-poly1305': 'xchacha20-ietf-poly1305'
}

function normalizeCipher(raw: string): string {
  const m = raw.trim().toLowerCase()
  const alias = CIPHER_ALIASES[m] ?? m
  if (!CIPHERS.has(alias)) abort('unsupported-cipher', m.slice(0, 40))
  return alias
}

function splitMethodPassword(text: string): { method: string; password: string } {
  const at = text.indexOf(':')
  if (at <= 0) abort('bad-secret', 'нет пары «шифр:пароль»')
  return { method: text.slice(0, at), password: text.slice(at + 1) }
}

export function parseShadowsocks(link: string): ParsedServer {
  const raw = link.trim()
  const body = raw.slice('ss://'.length)
  const noFrag = body.split('#')[0] ?? ''
  let name = ''
  const hashAt = body.indexOf('#')
  if (hashAt !== -1) name = safeDecodeURIComponent(body.slice(hashAt + 1))

  let method: string
  let password: string
  let host: string
  let port: number
  let query: Record<string, string> = {}

  if (!noFrag.includes('@')) {
    // Старый вид: ss://base64(method:password@host:port)
    const decoded = base64ToText(noFrag.split('?')[0] ?? '')
    if (decoded === null) abort('bad-encoding', 'не base64')
    const at = decoded.lastIndexOf('@')
    if (at === -1) abort('broken', 'внутри base64 нет «@»')
    const mp = splitMethodPassword(decoded.slice(0, at))
    method = mp.method
    password = mp.password
    const hp = splitShareLink('ss://' + decoded.slice(at + 1))
    const r = requireHostPort(hp)
    host = r.host
    port = r.port
  } else {
    const parts = splitShareLink(raw)
    const r = requireHostPort(parts)
    host = r.host
    port = r.port
    query = parts.query
    const ui = parts.userinfo
    if (ui.includes(':') && !/^[A-Za-z0-9+/_=-]+$/.test(ui)) {
      // Пароль записан открытым текстом (так делают для шифров 2022)
      const mp = splitMethodPassword(ui)
      method = mp.method
      password = mp.password
    } else {
      const decoded = base64ToText(ui)
      if (decoded !== null && decoded.includes(':')) {
        const mp = splitMethodPassword(decoded)
        method = mp.method
        password = mp.password
      } else if (ui.includes(':')) {
        const mp = splitMethodPassword(ui)
        method = mp.method
        password = mp.password
      } else abort('bad-encoding', 'не удалось прочитать шифр и пароль')
    }
    if (!name) name = parts.fragment
  }

  if (!host) abort('missing-host')
  normalizeServerPort(port)
  if (!password) abort('missing-secret', 'нет пароля')
  const cipher = normalizeCipher(method)

  const outbound: Record<string, unknown> = { type: 'shadowsocks', server: host, server_port: port, method: cipher, password }
  const warnings: string[] = []
  if (query.plugin) {
    const semi = query.plugin.indexOf(';')
    const pluginName = (semi === -1 ? query.plugin : query.plugin.slice(0, semi)).trim().toLowerCase()
    const opts = semi === -1 ? '' : query.plugin.slice(semi + 1)
    if (pluginName === 'obfs-local' || pluginName === 'simple-obfs') {
      outbound.plugin = 'obfs-local'
      if (opts) outbound.plugin_opts = opts
    } else if (pluginName === 'v2ray-plugin') {
      outbound.plugin = 'v2ray-plugin'
      if (opts) outbound.plugin_opts = opts
    } else {
      abort('unsupported-feature', `плагин ${pluginName.slice(0, 30)}`, `Дополнение «${pluginName.slice(0, 30)}» к Shadowsocks движок не поддерживает.`)
    }
  }
  return { protocol: 'shadowsocks', name, host, port, outbound: compact(outbound), rawLink: raw, warnings }
}
