import { ParseAbort, keyError } from '../errors'
import { guessCountry, stripFlagEmoji } from '../country'
import type { KeyError, ParseFailure, ParseOutcome, ParsedServer } from '../types'
import { base64ToText } from '../util/text'
import { parseAnytls } from './anytls'
import { parseHysteria2 } from './hysteria2'
import { parseShadowsocks } from './shadowsocks'
import { looksLikeJson, parseSingBoxJson } from './singboxJson'
import { parseTrojan } from './trojan'
import { parseTuic } from './tuic'
import { parseVless } from './vless'
import { parseVmess } from './vmess'

const SCHEMES = ['vless', 'vmess', 'trojan', 'ss', 'hysteria2', 'hy2', 'tuic', 'anytls'] as const
const UNSUPPORTED_SCHEMES: Record<string, string> = {
  hysteria: 'Hysteria первой версии',
  ssr: 'ShadowsocksR',
  wireguard: 'WireGuard',
  wg: 'WireGuard',
  socks: 'SOCKS',
  socks5: 'SOCKS'
}
/** Ссылки-обёртки, которые «открывают» приложение клиента: достаём из них адрес подписки. */
const WRAPPERS: Array<{ re: RegExp; param?: string }> = [
  { re: /^sing-box:\/\/import-remote-profile\?/i, param: 'url' },
  { re: /^clash:\/\/install-config\?/i, param: 'url' },
  { re: /^hiddify:\/\/import\//i },
  { re: /^happ:\/\/add\//i },
  { re: /^v2rayn:\/\/install-sub\?/i, param: 'url' },
  { re: /^streisand:\/\/import\//i }
]

function schemeOf(line: string): string | null {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(line.trim())
  return m ? m[1]!.toLowerCase() : null
}

/** Разбирает одну строку со ссылкой. Бросает ParseAbort. */
export function parseLink(line: string): ParsedServer {
  const scheme = schemeOf(line)
  let server: ParsedServer
  switch (scheme) {
    case 'vless': server = parseVless(line); break
    case 'vmess': server = parseVmess(line); break
    case 'trojan': server = parseTrojan(line); break
    case 'ss': server = parseShadowsocks(line); break
    case 'hysteria2':
    case 'hy2': server = parseHysteria2(line); break
    case 'tuic': server = parseTuic(line); break
    case 'anytls': server = parseAnytls(line); break
    default:
      if (scheme && UNSUPPORTED_SCHEMES[scheme]) {
        throw new ParseAbort(keyError('unsupported-protocol', scheme, `Тип «${UNSUPPORTED_SCHEMES[scheme]}» программа пока не умеет.`))
      }
      throw new ParseAbort(keyError('not-a-key', scheme ?? undefined))
  }
  const rawName = server.name
  const name = stripFlagEmoji(rawName).trim()
  server.countryHint = guessCountry(rawName) ?? guessCountry(server.host)
  server.name = name || `${server.protocol.toUpperCase()} ${server.host}`
  return server
}

/** Начало строки для сообщений об ошибках: без секретов (только схема и адрес). */
function hintFor(line: string): string {
  const scheme = schemeOf(line)
  const afterAt = line.includes('@') ? line.slice(line.lastIndexOf('@') + 1) : line.replace(/^[a-z0-9+.-]+:\/\//i, '')
  return `${scheme ?? '?'}://…${afterAt.split(/[?#/]/)[0]!.slice(0, 40)}`
}

function toKeyError(e: unknown): KeyError {
  if (e instanceof ParseAbort) return e.keyError
  return keyError('broken', e instanceof Error ? e.message : String(e))
}

function isHttpUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim())
}

function unwrapSubscriptionLink(text: string): string | null {
  const t = text.trim()
  for (const w of WRAPPERS) {
    if (!w.re.test(t)) continue
    if (w.param) {
      const q = t.slice(t.indexOf('?') + 1).split('#')[0]!
      for (const pair of q.split('&')) {
        const eq = pair.indexOf('=')
        if (eq !== -1 && pair.slice(0, eq) === w.param) {
          try { return decodeURIComponent(pair.slice(eq + 1)) } catch { return pair.slice(eq + 1) }
        }
      }
      return null
    }
    const rest = t.replace(w.re, '')
    try { return decodeURIComponent(rest) } catch { return rest }
  }
  return null
}

function parseLines(lines: string[], source: 'link' | 'list' | 'subscription-body'): ParseOutcome {
  const servers: ParsedServer[] = []
  const failures: ParseFailure[] = []
  for (const line of lines) {
    const scheme = schemeOf(line)
    if (!scheme) continue // посторонняя строка (комментарий, служебная запись подписки)
    try {
      servers.push(parseLink(line))
    } catch (e) {
      failures.push({ error: toKeyError(e), hint: hintFor(line) })
    }
  }
  if (servers.length === 0) {
    if (failures.length === 1 && lines.length === 1) return { kind: 'error', error: failures[0]!.error }
    if (failures.length > 0) {
      return { kind: 'error', error: keyError('no-servers', undefined, `Ключей найдено: ${failures.length}, но ни один не удалось прочитать. Первая причина: ${failures[0]!.error.message}`) }
    }
    return { kind: 'error', error: keyError(lines.length ? 'not-a-key' : 'empty') }
  }
  return { kind: 'servers', servers, failures, source }
}

/** Главная точка входа: то, что человек вставил (ключ, несколько ключей, адрес подписки, файл настроек). */
export function parseInput(rawText: string): ParseOutcome {
  const text = (rawText ?? '').replace(/^﻿/, '').trim()
  if (!text) return { kind: 'error', error: keyError('empty') }

  const unwrapped = unwrapSubscriptionLink(text)
  if (unwrapped && isHttpUrl(unwrapped)) return { kind: 'subscription-url', url: unwrapped.trim() }
  if (isHttpUrl(text) && !text.includes('\n')) return { kind: 'subscription-url', url: text }

  if (looksLikeJson(text)) {
    try {
      const { servers, failures } = parseSingBoxJson(text)
      if (servers.length === 0) {
        const first = failures[0]
        return { kind: 'error', error: first ? first.error : keyError('no-servers', undefined, 'В файле нет серверов, которые можно использовать.') }
      }
      return { kind: 'servers', servers, failures, source: 'singbox-json' }
    } catch (e) {
      return { kind: 'error', error: toKeyError(e) }
    }
  }

  const lines = text.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean)
  if (lines.some((l) => schemeOf(l))) return parseLines(lines, lines.length === 1 ? 'link' : 'list')

  // Возможно, это целая подписка, закодированная в base64
  const decoded = base64ToText(text)
  if (decoded && /:\/\//.test(decoded)) return parseSubscriptionBody(decoded)
  return { kind: 'error', error: keyError('not-a-key') }
}

/** Разбор тела подписки (то, что вернул сервер по ссылке-подписке). */
export function parseSubscriptionBody(rawBody: string): ParseOutcome {
  const body = (rawBody ?? '').replace(/^﻿/, '').trim()
  if (!body) return { kind: 'error', error: keyError('no-servers', undefined, 'Подписка пустая. Возможно, срок её действия закончился.') }
  if (looksLikeJson(body)) {
    try {
      const { servers, failures } = parseSingBoxJson(body)
      if (servers.length === 0) return { kind: 'error', error: keyError('no-servers', undefined, 'В подписке нет серверов, которые можно использовать.') }
      return { kind: 'servers', servers, failures, source: 'subscription-body' }
    } catch (e) {
      return { kind: 'error', error: toKeyError(e) }
    }
  }
  let lines = body.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean)
  if (!lines.some((l) => schemeOf(l))) {
    const decoded = base64ToText(body)
    if (decoded && /:\/\//.test(decoded)) lines = decoded.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean)
    else if (/^\s*proxies:/m.test(body)) {
      return { kind: 'error', error: keyError('unsupported-feature', 'clash-yaml', 'Подписка выдаёт настройки в формате Clash. Такой формат программа пока не читает — спросите у поставщика ссылку для sing-box или v2rayN.') }
    } else return { kind: 'error', error: keyError('no-servers', undefined, 'В подписке не нашлось ключей. Возможно, ссылка устарела.') }
  }
  const out = parseLines(lines, 'subscription-body')
  if (out.kind === 'error') return { kind: 'error', error: keyError('no-servers', undefined, out.error.message) }
  return out
}

/** Заголовок Subscription-Userinfo: «upload=1; download=2; total=3; expire=1700000000». */
export function parseSubscriptionUserinfo(header: string | null | undefined): { upload?: number; download?: number; total?: number; expireAt?: number } {
  const out: { upload?: number; download?: number; total?: number; expireAt?: number } = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const [k, v] = part.split('=').map((s) => s.trim())
    if (!k || v === undefined) continue
    const n = Number(v)
    if (!Number.isFinite(n)) continue
    if (k === 'upload') out.upload = n
    else if (k === 'download') out.download = n
    else if (k === 'total') out.total = n
    else if (k === 'expire' && n > 0) out.expireAt = n * 1000
  }
  return out
}
