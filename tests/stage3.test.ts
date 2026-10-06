// Этап 3: проверка задержки, подписки, QR-код, кнопка «Проверить, всё ли работает».
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import { join } from 'node:path'
import { parseInput, type ParsedServer } from '../core'
import { AppController } from '../electron/controller'
import { ERR_BAD_KEY, ERR_NO_ANSWER, measureLatencies, measureOne, type LatencyResult } from '../electron/engine/latency'
import { runSelfCheck, type CheckDeps } from '../electron/services/selfcheck'
import { subscriptionDue, fetchSubscription, type SubscriptionFetch } from '../electron/services/subscriptions'
import type { CheckReport } from '../shared/types'
import { DataStore, type Sealer } from '../electron/store'
import { fakeHost } from './helpers/fakeHost'
import { Box, freePort, removeDir, startBlackHole, startTarget, tempDir } from './helpers/loopback'
import { singBoxPath } from './helpers/singbox'

const b64 = (s: string): string => Buffer.from(s).toString('base64')
const sealer: Sealer = { available: () => true, seal: (p) => 'S:' + Buffer.from(p).toString('base64'), open: (s) => Buffer.from(s.slice(2), 'base64').toString() }
const PROBE = ['http://cp.cloudflare.com/generate_204']
const RULES = join(__dirname, '..', 'resources', 'rules')

let dir: string
let target: { port: number; close: () => Promise<void> }
let server: Box
let serverPort: number

/** Ключ на наш «сервер» (он стоит на этом же компьютере и отвечает как интернет). */
const keyFor = (name: string, port = serverPort, password = 'pw'): string => `ss://${b64(`aes-256-gcm:${password}`)}@127.0.0.1:${port}#${encodeURIComponent(name)}`
const outboundOf = (key: string): Record<string, unknown> => {
  const p = parseInput(key)
  if (p.kind !== 'servers') throw new Error('ключ не разобрался')
  return p.servers[0]!.outbound
}

beforeAll(async () => {
  dir = tempDir('tropa-s3-')
  target = await startTarget('ok-stage3')
  serverPort = await freePort()
  server = new Box('server', {
    log: { level: 'info' },
    inbounds: [{ type: 'shadowsocks', tag: 'in', listen: '127.0.0.1', listen_port: serverPort, method: 'aes-256-gcm', password: 'pw' }],
    outbounds: [{ type: 'direct', tag: 'direct' }],
    route: { rules: [{ action: 'route', outbound: 'direct', override_address: '127.0.0.1', override_port: target.port }], final: 'direct' }
  }, dir)
  await server.start()
}, 60000)

afterAll(async () => {
  await server?.stop()
  await target?.close()
  if (dir) removeDir(dir)
})

describe('проверка задержки серверов', () => {
  it('рабочий сервер получает задержку, мёртвый — «нет ответа», битый ключ — «не подходит»; остальных битый не ломает', async () => {
    const closed = await freePort() // порт, на котором никто не слушает
    const results = new Map<string, LatencyResult>()
    const work = join(dir, 'lat-1')
    await measureLatencies(
      [
        { id: 'good', outbound: outboundOf(keyFor('рабочий')) },
        { id: 'dead', outbound: outboundOf(keyFor('мёртвый', closed)) },
        { id: 'broken', outbound: { type: 'shadowsocks', server: '127.0.0.1', server_port: 1, method: 'rot13', password: 'x' } },
        { id: 'good2', outbound: outboundOf(keyFor('рабочий-2')) }
      ],
      { engineExe: singBoxPath(), workDir: work, probeUrls: PROBE, budgetMs: 4000, onResult: (id, r) => results.set(id, r) }
    )
    expect(results.size).toBe(4)
    const good = results.get('good')!
    expect('ms' in good && good.ms > 0 && good.ms < 3000).toBe(true)
    expect('ms' in results.get('good2')!).toBe(true)
    expect(results.get('dead')).toEqual({ error: ERR_NO_ANSWER })
    expect(results.get('broken')).toEqual({ error: ERR_BAD_KEY })
    // временный файл с секретами не остался на диске
    expect(readdirSync(work).filter((f) => f.startsWith('probe-'))).toEqual([])
  }, 60000)

  it('прерывание: временный движок останавливается, недоделанные серверы результата не получают', async () => {
    // «чёрная дыра»: принимает соединение и молчит — проверка ждала бы до конца отведённого времени
    const hole = await startBlackHole()
    const holePort = hole.port
    const ac = new AbortController()
    const results = new Map<string, LatencyResult>()
    const t0 = Date.now()
    setTimeout(() => ac.abort(), 1500)
    await measureLatencies([{ id: 'hole', outbound: outboundOf(keyFor('дыра', holePort)) }], {
      engineExe: singBoxPath(), workDir: join(dir, 'lat-2'), probeUrls: PROBE, budgetMs: 30000, signal: ac.signal, onResult: (id, r) => results.set(id, r)
    })
    expect(Date.now() - t0).toBeLessThan(8000)
    expect(results.size).toBe(0)
    await hole.close()
    expect(readdirSync(join(dir, 'lat-2')).filter((f) => f.startsWith('probe-'))).toEqual([])
  }, 40000)

  it('много серверов за раз: у каждого свой вход, результаты не перепутаны', async () => {
    // каждый «сервер» — это тот же рабочий, кроме двух с неверным паролем (движок примет соединение, но пароль не подойдёт)
    const targets = Array.from({ length: 14 }, (_, i) => ({ id: `s${i}`, outbound: outboundOf(keyFor(`сервер ${i}`, serverPort, i % 5 === 3 ? 'неверный-пароль' : 'pw')) }))
    const results = new Map<string, LatencyResult>()
    await measureLatencies(targets, { engineExe: singBoxPath(), workDir: join(dir, 'lat-3'), probeUrls: PROBE, budgetMs: 4000, concurrency: 5, onResult: (id, r) => results.set(id, r) })
    expect(results.size).toBe(14)
    for (let i = 0; i < 14; i++) {
      const r = results.get(`s${i}`)!
      if (i % 5 === 3) expect(r, `s${i}`).toEqual({ error: ERR_NO_ANSWER })
      else expect('ms' in r, `s${i}`).toBe(true)
    }
  }, 90000)

  it('измерение: при полном отсутствии ответа вернёт ошибку в пределах отведённого времени', async () => {
    const t0 = Date.now()
    const r = await measureOne(await freePort(), PROBE, 1200)
    expect(r).toEqual({ error: ERR_NO_ANSWER })
    expect(Date.now() - t0).toBeLessThan(3000)
  })
})

describe('контроллер: проверка задержки', () => {
  it('в списке серверов появляется «проверяю», а потом число или «не отвечает»; повторный запрос во время проверки не дублирует', async () => {
    const dataDir = join(dir, 'ctl-1')
    const fh = fakeHost()
    const c = new AppController(fh.host, { userDir: dataDir, engineExe: singBoxPath(), bundledRulesDir: RULES }, sealer, { ruleFetch: async () => Buffer.alloc(0), probeUrls: PROBE })
    await c.init()
    const closed = await freePort()
    await c.addKeyText(keyFor('живой'))
    await c.addKeyText(keyFor('мёртвый', closed))
    const seen: string[] = []
    c.onState((s) => seen.push(s.servers.map((x) => (x.latency === 'testing' ? 'T' : x.latency === null ? '-' : 'error' in x.latency ? 'E' : 'M')).join('')))
    const first = c.pingServers()
    await new Promise((r) => setTimeout(r, 100))
    expect(c.getStateSync().servers.map((s) => s.latency)).toEqual(['testing', 'testing'])
    await c.pingServers() // уже идёт — второй запуск ничего не делает и не ломается
    await first
    const lat = c.getStateSync().servers.map((s) => s.latency)
    expect(lat[0] && typeof lat[0] === 'object' && 'ms' in lat[0]).toBe(true)
    expect(lat[1]).toEqual({ error: ERR_NO_ANSWER })
    expect(seen.some((x) => x === 'TT')).toBe(true)
    // проверка одного сервера по id
    await c.pingServers([c.getStateSync().servers[0]!.id])
    expect(c.getStateSync().servers[1]!.latency).toEqual({ error: ERR_NO_ANSWER }) // соседний не тронут
    await c.shutdown()
  }, 60000)

  it('программа закрывается во время проверки: временный движок убирается, зависших состояний нет', async () => {
    const hole = await startBlackHole()
    const holePort = hole.port
    const fh = fakeHost()
    const dataDir = join(dir, 'ctl-2')
    const c = new AppController(fh.host, { userDir: dataDir, engineExe: singBoxPath(), bundledRulesDir: RULES }, sealer, { ruleFetch: async () => Buffer.alloc(0), probeUrls: PROBE })
    await c.init()
    await c.addKeyText(keyFor('дыра', holePort))
    const running = c.pingServers()
    await new Promise((r) => setTimeout(r, 1200))
    const t0 = Date.now()
    await c.shutdown()
    await running
    expect(Date.now() - t0).toBeLessThan(8000)
    expect(c.getStateSync().servers[0]!.latency).toBeNull() // осталось «не проверен», а не вечное «проверяю»
    expect(readdirSync(join(dataDir, 'runtime')).filter((f) => f.startsWith('probe-'))).toEqual([])
    await hole.close()
  }, 40000)
})

// =====================================================================================================================
// Подписки
// =====================================================================================================================

const UUID = 'e9a5d2ee-9d2d-4747-8686-86bc19445dc5'
const UUID2 = '11111111-2222-4333-8444-555555555555'
const vless = (host: string, name: string, uuid = UUID, port = 443): string => `vless://${uuid}@${host}:${port}?encryption=none&security=tls&sni=${host}&type=ws&path=%2Fw#${encodeURIComponent(name)}`
const parsedList = (...keys: string[]): ParsedServer[] => {
  const r = parseInput(keys.join('\n'))
  if (r.kind !== 'servers') throw new Error('не разобрались ключи')
  return r.servers
}
const SECRET_TOKEN = 'токен-подписки-1234567890'
const subUrl = `https://sub.example.com/api/v1/${SECRET_TOKEN}`
const fetched = (keys: string[], over: Partial<SubscriptionFetch> = {}): SubscriptionFetch => ({ outcome: { kind: 'servers', servers: parsedList(...keys), failures: [], source: 'subscription-body' }, info: null, title: null, intervalHours: null, ...over })

function newController(name: string, over: Partial<ConstructorParameters<typeof AppController>[3]> = {}): { c: AppController; dataDir: string } {
  const dataDir = join(dir, name)
  const c = new AppController(fakeHost().host, { userDir: dataDir, engineExe: singBoxPath(), bundledRulesDir: RULES }, sealer, { ruleFetch: async () => Buffer.alloc(0), probeUrls: PROBE, ...over })
  return { c, dataDir }
}

describe('подписки: сверка списка серверов (хранилище)', () => {
  const mk = (): DataStore => new DataStore(join(tempDir('tropa-store3-'), 'data.json'), sealer)
  const names = (st: DataStore): string[] => st.servers.map((s) => s.name)

  it('новые серверы добавляются, а то, что человек настроил (название, «любимый»), при обновлении не теряется', () => {
    const st = mk()
    const sub = st.addSubscription(subUrl, 'Провайдер')
    st.reconcileSubscription(sub.id, parsedList(vless('a.example.com', 'Германия'), vless('b.example.com', 'Финляндия')))
    expect(st.servers).toHaveLength(2)
    const de = st.servers.find((s) => s.host === 'a.example.com')!
    st.rename(de.id, 'Мой любимый')
    st.toggleFavorite(de.id)
    const r = st.reconcileSubscription(sub.id, parsedList(vless('a.example.com', 'Германия'), vless('b.example.com', 'Финляндия'), vless('c.example.com', 'Швеция')))
    expect(r).toMatchObject({ added: 1, removed: 0, kept: 2, updated: 0 })
    expect(st.server(de.id)).toMatchObject({ name: 'Мой любимый', favorite: true })
    expect(st.servers).toHaveLength(3)
  })

  it('поставщик сменил ключи у того же сервера: он остаётся тем же (id, имя, звёздочка), а новые ключи подхватываются', () => {
    const st = mk()
    const sub = st.addSubscription(subUrl, 'П')
    st.reconcileSubscription(sub.id, parsedList(vless('a.example.com', 'Германия', UUID)))
    const rec = st.servers[0]!
    st.toggleFavorite(rec.id)
    st.updateSettings({ selectedServerId: rec.id })
    const r = st.reconcileSubscription(sub.id, parsedList(vless('a.example.com', 'Германия', UUID2)))
    expect(r).toMatchObject({ added: 0, removed: 0, updated: 1 })
    expect(st.servers).toHaveLength(1)
    expect(st.servers[0]!.id).toBe(rec.id)
    expect(st.servers[0]!.favorite).toBe(true)
    expect(st.settings.selectedServerId).toBe(rec.id) // выбор не потерян
    expect((st.getSecret(rec.id)!.outbound as { uuid: string }).uuid).toBe(UUID2) // ключ новый
  })

  it('поставщик переименовал сервер: своё имя человека сохраняется, а без своего — берётся новое', () => {
    const st = mk()
    const sub = st.addSubscription(subUrl, 'П')
    st.reconcileSubscription(sub.id, parsedList(vless('a.example.com', 'NL-1'), vless('b.example.com', 'DE-1')))
    const nl = st.servers.find((s) => s.host === 'a.example.com')!
    st.rename(nl.id, 'Домашний')
    st.reconcileSubscription(sub.id, parsedList(vless('a.example.com', 'NL-1 быстрый'), vless('b.example.com', 'DE-1 быстрый')))
    expect(names(st).sort()).toEqual(['DE-1 быстрый', 'Домашний'])
    expect(st.servers).toHaveLength(2) // не размножились
  })

  it('исчезнувшие из подписки серверы убираются, но тот, к которому сейчас подключены, остаётся', () => {
    const st = mk()
    const sub = st.addSubscription(subUrl, 'П')
    st.reconcileSubscription(sub.id, parsedList(vless('a.example.com', 'A'), vless('b.example.com', 'B'), vless('c.example.com', 'C')))
    const b = st.servers.find((s) => s.host === 'b.example.com')!
    const r = st.reconcileSubscription(sub.id, parsedList(vless('a.example.com', 'A')), new Set([b.id]))
    expect(r.removed).toBe(1)
    expect(st.servers.map((s) => s.host).sort()).toEqual(['a.example.com', 'b.example.com'])
    st.reconcileSubscription(sub.id, parsedList(vless('a.example.com', 'A'))) // подключение закончилось — теперь убирается и он
    expect(st.servers.map((s) => s.host)).toEqual(['a.example.com'])
  })

  it('сервер, удалённый человеком из подписки, при обновлении не возвращается (даже если сменились ключи)', () => {
    const st = mk()
    const sub = st.addSubscription(subUrl, 'П')
    st.reconcileSubscription(sub.id, parsedList(vless('a.example.com', 'A'), vless('bad.example.com', 'Плохой')))
    st.removeServer(st.servers.find((s) => s.host === 'bad.example.com')!.id)
    st.reconcileSubscription(sub.id, parsedList(vless('a.example.com', 'A'), vless('bad.example.com', 'Плохой')))
    expect(st.servers.map((s) => s.host)).toEqual(['a.example.com'])
    st.reconcileSubscription(sub.id, parsedList(vless('a.example.com', 'A'), vless('bad.example.com', 'Плохой', UUID2)))
    expect(st.servers.map((s) => s.host)).toEqual(['a.example.com'])
  })

  it('повторы внутри подписки не плодят серверы; вручную добавленный сервер присоединяется к подписке, а не дублируется', () => {
    const st = mk()
    st.addServers(parsedList(vless('a.example.com', 'Ручной')))
    const sub = st.addSubscription(subUrl, 'П')
    st.reconcileSubscription(sub.id, parsedList(vless('a.example.com', 'Ручной'), vless('a.example.com', 'Ручной'), vless('b.example.com', 'B')))
    expect(st.servers).toHaveLength(2)
    expect(st.servers.every((s) => s.subscriptionId === sub.id)).toBe(true)
  })

  it('название от поставщика подставляется, пока человек не дал своё; удаление подписки убирает и её серверы', () => {
    const st = mk()
    const sub = st.addSubscription(subUrl, '')
    st.reconcileSubscription(sub.id, parsedList(vless('a.example.com', 'A')))
    st.setSubscriptionResult(sub.id, { error: null, title: 'Быстрый VPN', intervalHours: 6 })
    expect(st.subscription(sub.id)).toMatchObject({ name: 'Быстрый VPN', intervalHours: 6 })
    st.renameSubscription(sub.id, 'Мой VPN')
    st.setSubscriptionResult(sub.id, { error: null, title: 'Быстрый VPN 2' })
    expect(st.subscription(sub.id)!.name).toBe('Мой VPN')
    st.setSubscriptionResult(sub.id, { error: 'сбой' })
    expect(st.subscription(sub.id)).toMatchObject({ error: 'сбой' })
    st.removeSubscription(sub.id)
    expect(st.servers).toHaveLength(0)
    expect(st.subscriptions).toHaveLength(0)
  })
})

describe('подписки: срок обновления', () => {
  const H = 3_600_000
  const rec = (o: Partial<{ updatedAt: number | null; intervalHours: number; error: string | null }> = {}) => ({ updatedAt: null as number | null, intervalHours: 12, error: null as string | null, ...o })
  it('ни разу не обновлялась — пора; свежая — не пора; просрочена — пора', () => {
    const now = Date.now()
    expect(subscriptionDue(rec(), now, undefined)).toBe(true)
    expect(subscriptionDue(rec({ updatedAt: now - 2 * H }), now, undefined)).toBe(false)
    expect(subscriptionDue(rec({ updatedAt: now - 13 * H }), now, undefined)).toBe(true)
    expect(subscriptionDue(rec({ updatedAt: now - 7 * H, intervalHours: 6 }), now, undefined)).toBe(true) // срок поставщика
  })
  it('после попытки не долбим сайт слишком часто: час при успехе, полчаса после неудачи', () => {
    const now = Date.now()
    expect(subscriptionDue(rec({ updatedAt: now - 20 * H }), now, now - 10 * 60_000)).toBe(false)
    expect(subscriptionDue(rec({ updatedAt: now - 20 * H }), now, now - 61 * 60_000)).toBe(true)
    expect(subscriptionDue(rec({ error: 'сбой' }), now, now - 20 * 60_000)).toBe(false)
    expect(subscriptionDue(rec({ error: 'сбой' }), now, now - 31 * 60_000)).toBe(true)
  })
})

describe('подписки: загрузка по сети (настоящий http на этом компьютере)', () => {
  let web: HttpServer
  let base = ''
  let mode = 'ok'
  beforeAll(async () => {
    web = createHttpServer((req, res) => {
      const keys = [vless('a.example.com', 'Германия'), vless('b.example.com', 'Финляндия')].join('\n')
      if (req.url === '/redirect') { res.writeHead(302, { location: '/sub' }); res.end(); return }
      if (mode === '403') { res.writeHead(403); res.end('nope'); return }
      if (mode === '404') { res.writeHead(404); res.end('nope'); return }
      if (mode === 'html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body>Войдите в личный кабинет</body></html>'); return }
      if (mode === 'clash') { res.writeHead(200); res.end('proxies:\n  - name: a\n    type: vless\n'); return }
      if (mode === 'empty') { res.writeHead(200); res.end(''); return }
      res.writeHead(200, {
        'content-type': 'text/plain',
        'subscription-userinfo': 'upload=1073741824; download=2147483648; total=10737418240; expire=1893456000',
        'profile-title': 'base64:' + Buffer.from('Быстрый VPN').toString('base64'),
        'profile-update-interval': '6'
      })
      res.end(Buffer.from(keys).toString('base64'))
    })
    await new Promise<void>((r) => web.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(web.address() as { port: number }).port}`
  })
  afterAll(async () => { web.closeAllConnections(); await new Promise<void>((r) => web.close(() => r())) })

  it('читает серверы, остаток трафика, срок, название и период обновления из заголовков', async () => {
    mode = 'ok'
    const f = await fetchSubscription(`${base}/sub`, null)
    expect(f.outcome.kind).toBe('servers')
    if (f.outcome.kind === 'servers') expect(f.outcome.servers.map((s) => s.name)).toEqual(['Германия', 'Финляндия'])
    expect(f.info).toEqual({ upload: 1073741824, download: 2147483648, total: 10737418240, expireAt: 1893456000000 })
    expect(f.title).toBe('Быстрый VPN')
    expect(f.intervalHours).toBe(6)
  })

  it('переходит по перенаправлению', async () => {
    mode = 'ok'
    const f = await fetchSubscription(`${base}/redirect`, null)
    expect(f.outcome.kind).toBe('servers')
  })

  it.each([
    ['403', 'не пустил'],
    ['404', 'ничего нет'],
    ['html', 'не нашлось ключей'],
    ['clash', 'формате Clash'],
    ['empty', 'пустая']
  ])('ошибка «%s» объясняется человеческими словами', async (m, part) => {
    mode = m
    const f = await fetchSubscription(`${base}/sub`, null)
    expect(f.outcome.kind).toBe('error')
    if (f.outcome.kind === 'error') expect(f.outcome.error.message).toContain(part)
  })

  it('сайт недоступен: понятное сообщение с подсказкой про блокировку', async () => {
    const dead = await freePort()
    const f = await fetchSubscription(`http://127.0.0.1:${dead}/sub`, null)
    expect(f.outcome.kind).toBe('error')
    if (f.outcome.kind === 'error') expect(f.outcome.error.message).toContain('заблокирован')
  })
})

describe('подписки: контроллер', () => {
  it('ссылка на подписку из буфера: серверы добавляются, первый выбирается, секретная часть ссылки нигде не видна', async () => {
    const calls: Array<number | null> = []
    const { c, dataDir } = newController('sub-1', {
      fetchSubscription: async (_u, port) => { calls.push(port); return fetched([vless('a.example.com', 'Германия'), vless('b.example.com', 'Финляндия')], { title: 'Быстрый VPN', info: { total: 100, download: 40 }, intervalHours: 6 }) }
    })
    await c.init()
    const r = await c.addKeyText(subUrl)
    expect(r).toMatchObject({ ok: true, kind: 'subscription', added: 2 })
    expect(r.message).toContain('Быстрый VPN')
    const st = c.getStateSync()
    expect(st.subscriptions).toHaveLength(1)
    expect(st.subscriptions[0]).toMatchObject({ name: 'Быстрый VPN', serverCount: 2, error: null, displayUrl: 'https://sub.example.com/…', info: { total: 100, download: 40 } })
    expect(st.servers.map((s) => s.subscriptionId)).toEqual([st.subscriptions[0]!.id, st.subscriptions[0]!.id])
    expect(st.settings.selectedServerId).toBe(st.servers[0]!.id)
    // секретная часть адреса не попадает ни в состояние окна, ни в файл данных, ни в журнал
    expect(JSON.stringify(st)).not.toContain(SECRET_TOKEN)
    c.store.flush()
    expect(readFileSync(join(dataDir, 'data.json'), 'utf8')).not.toContain(SECRET_TOKEN)
    expect(readFileSync(join(dataDir, 'logs', 'app.log'), 'utf8')).not.toContain(SECRET_TOKEN)
    expect(calls).toEqual([null]) // VPN не включён — идём напрямую
    await c.shutdown()
  })

  it('та же ссылка второй раз — это обновление, а не вторая подписка', async () => {
    let n = 0
    const { c } = newController('sub-2', { fetchSubscription: async () => fetched(n++ === 0 ? [vless('a.example.com', 'A')] : [vless('a.example.com', 'A'), vless('b.example.com', 'B')]) })
    await c.init()
    await c.addKeyText(subUrl)
    const r = await c.addKeyText(subUrl)
    expect(r.message).toContain('уже есть')
    expect(c.getStateSync().subscriptions).toHaveLength(1)
    expect(c.getStateSync().servers).toHaveLength(2)
    await c.shutdown()
  })

  it('сайт подписки не ответил при добавлении: человеческая ошибка, ничего лишнего не сохранено', async () => {
    const { c } = newController('sub-3', { fetchSubscription: async () => ({ outcome: { kind: 'error', error: { code: 'no-servers', message: 'Сайт подписки не отвечает.' } }, info: null, title: null, intervalHours: null }) })
    await c.init()
    const r = await c.addKeyText(subUrl)
    expect(r).toMatchObject({ ok: false, kind: 'error', message: 'Сайт подписки не отвечает.' })
    expect(c.getStateSync().subscriptions).toHaveLength(0)
    await c.shutdown()
  })

  it('сбой при обновлении не стирает серверы: появляется пометка об ошибке, а после удачного обновления она пропадает', async () => {
    let fail = false
    const { c } = newController('sub-4', {
      fetchSubscription: async () => fail
        ? { outcome: { kind: 'error', error: { code: 'no-servers', message: 'Подписка пустая. Возможно, срок её действия закончился.' } }, info: null, title: null, intervalHours: null }
        : fetched([vless('a.example.com', 'A'), vless('b.example.com', 'B')])
    })
    await c.init()
    await c.addKeyText(subUrl)
    const id = c.getStateSync().subscriptions[0]!.id
    fail = true
    const bad = await c.refreshSubscription(id)
    expect(bad.ok).toBe(false)
    expect(c.getStateSync().servers).toHaveLength(2) // серверы на месте
    expect(c.getStateSync().subscriptions[0]!.error).toContain('пустая')
    fail = false
    expect((await c.refreshSubscription(id)).ok).toBe(true)
    expect(c.getStateSync().subscriptions[0]!.error).toBeNull()
    await c.shutdown()
  })

  it('во время обновления у подписки стоит отметка «обновляется»', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    let first = true
    const { c } = newController('sub-5', { fetchSubscription: async () => { if (!first) await gate; first = false; return fetched([vless('a.example.com', 'A')]) } })
    await c.init()
    await c.addKeyText(subUrl)
    const id = c.getStateSync().subscriptions[0]!.id
    const run = c.refreshSubscription(id)
    expect(c.getStateSync().subscriptions[0]!.refreshing).toBe(true)
    release()
    await run
    expect(c.getStateSync().subscriptions[0]!.refreshing).toBe(false)
    await c.shutdown()
  })

  it('выбранный сервер исчез из подписки: выбирается тот, что с тем же адресом, а не «ничего»', async () => {
    let step = 0
    const { c } = newController('sub-6', {
      fetchSubscription: async () => fetched(step++ === 0 ? [vless('a.example.com', 'A'), vless('b.example.com', 'B')] : [vless('b.example.com', 'B'), vless('c.example.com', 'C')])
    })
    await c.init()
    await c.addKeyText(subUrl)
    const b = c.getStateSync().servers.find((s) => s.host === 'b.example.com')!
    await c.selectServer(c.getStateSync().servers.find((s) => s.host === 'a.example.com')!.id)
    await c.refreshSubscription(c.getStateSync().subscriptions[0]!.id)
    const sel = c.getStateSync().settings.selectedServerId
    expect(sel).toBeTruthy()
    expect(c.getStateSync().servers.some((s) => s.id === sel)).toBe(true)
    expect(c.getStateSync().servers.map((s) => s.host).sort()).toEqual(['b.example.com', 'c.example.com'])
    expect(c.getStateSync().servers.find((s) => s.id === b.id)).toBeTruthy()
    await c.shutdown()
  })

  it('фоновое обновление берёт только те подписки, которым пора', async () => {
    const seen: string[] = []
    const { c } = newController('sub-7', { fetchSubscription: async (u) => { seen.push(u); return fetched([vless(u.includes('one') ? 'a.example.com' : 'b.example.com', 'S')]) } })
    await c.init()
    await c.addKeyText('https://one.example.com/t1')
    await c.addKeyText('https://two.example.com/t2')
    seen.length = 0
    await c.refreshDueSubscriptions() // только что обновлялись — не пора
    expect(seen).toEqual([])
    // «прошло 13 часов»
    for (const s of c.store.subscriptions) s.updatedAt = Date.now() - 13 * 3_600_000
    c.store.subscriptions[1]!.updatedAt = Date.now() - 1000
    ;(c as unknown as { lastSubTry: Map<string, number> }).lastSubTry.clear()
    await c.refreshDueSubscriptions()
    expect(seen).toEqual(['https://one.example.com/t1'])
    await c.shutdown()
  })

  it('удаление подписки убирает её серверы, ручные остаются', async () => {
    const { c } = newController('sub-8', { fetchSubscription: async () => fetched([vless('a.example.com', 'A')]) })
    await c.init()
    await c.addKeyText(keyFor('Ручной'))
    await c.addKeyText(subUrl)
    expect(c.getStateSync().servers).toHaveLength(2)
    await c.removeSubscription(c.getStateSync().subscriptions[0]!.id)
    expect(c.getStateSync().subscriptions).toHaveLength(0)
    expect(c.getStateSync().servers.map((s) => s.name)).toEqual(['Ручной'])
    await c.shutdown()
  })

  it('без системного шифрования подписка не сохраняется (ссылка — тоже секрет)', async () => {
    const noSeal: Sealer = { available: () => false, seal: () => { throw new Error('нельзя') }, open: () => '' }
    const c = new AppController(fakeHost().host, { userDir: join(dir, 'sub-9'), engineExe: singBoxPath(), bundledRulesDir: RULES }, noSeal, { ruleFetch: async () => Buffer.alloc(0), fetchSubscription: async () => fetched([vless('a.example.com', 'A')]) })
    await c.init()
    const r = await c.addKeyText(subUrl)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('защитить')
    await c.shutdown()
  })
})

// =====================================================================================================================
// QR-код
// =====================================================================================================================

/** Размер PNG из заголовка (ширина и высота). */
const pngSize = (dataUrl: string): { w: number; h: number } => {
  const buf = Buffer.from(dataUrl.split(',')[1]!, 'base64')
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a') // подпись PNG
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

describe('QR-код', () => {
  it('ключ сервера и адрес подписки превращаются в картинку; разные ключи — разные картинки', async () => {
    const { c } = newController('qr-1', { fetchSubscription: async () => fetched([vless('a.example.com', 'A')]) })
    await c.init()
    await c.addKeyText(vless('one.example.com', 'Первый'))
    await c.addKeyText(vless('two.example.com', 'Второй'))
    const [one, two] = c.getStateSync().servers
    const a = await c.getQr('server', one!.id)
    const b = await c.getQr('server', two!.id)
    expect(a.ok && b.ok).toBe(true)
    expect(a.dataUrl!.startsWith('data:image/png;base64,')).toBe(true)
    expect(a.title).toBe('Ключ «Первый»')
    const { w, h } = pngSize(a.dataUrl!)
    expect(w).toBe(h)
    expect(w).toBeGreaterThan(200)
    expect(a.dataUrl).not.toBe(b.dataUrl)
    await c.addKeyText(subUrl)
    const sub = await c.getQr('subscription', c.getStateSync().subscriptions[0]!.id)
    expect(sub.ok).toBe(true)
    expect(sub.title).toContain('Подписка')
    // в название и в журнал сам ключ не попадает
    expect(JSON.stringify([a.title, b.title, sub.title])).not.toContain(UUID)
    expect(readFileSync(join(dir, 'qr-1', 'logs', 'app.log'), 'utf8')).not.toContain(UUID)
    await c.shutdown()
  })

  it('сервер из готового файла настроек (исходной ссылки нет) — честный отказ, а не пустая картинка', async () => {
    const { c } = newController('qr-2')
    await c.init()
    const json = JSON.stringify({ outbounds: [{ type: 'trojan', tag: 'Файл', server: 'tr.example.com', server_port: 443, password: 'pw', tls: { enabled: true, server_name: 'tr.example.com' } }] })
    expect((await c.addKeyText(json)).ok).toBe(true)
    const rec = c.getStateSync().servers[0]!
    expect(rec.canQr).toBe(false)
    const r = await c.getQr('server', rec.id)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('нет исходной ссылки')
    expect((await c.getQr('server', 'нет-такого')).ok).toBe(false)
    expect((await c.getQr('subscription', 'нет-такой')).ok).toBe(false)
    await c.shutdown()
  })

  it('слишком длинный ключ не помещается — понятное сообщение', async () => {
    const { c } = newController('qr-3')
    await c.init()
    const long = `vless://${UUID}@long.example.com:443?encryption=none&security=tls&type=ws&path=${encodeURIComponent('/' + 'a'.repeat(2400))}#Длинный`
    await c.addKeyText(long)
    const r = await c.getQr('server', c.getStateSync().servers[0]!.id)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('слишком длинный')
    await c.shutdown()
  })
})

// =====================================================================================================================
// «Проверить, всё ли работает»
// =====================================================================================================================

describe('проверка «всё ли работает»: логика на подставных ответах', () => {
  const good = (over: Partial<CheckDeps> = {}): CheckDeps => ({
    mode: 'proxy', serverName: 'Нидерланды', serverCountry: 'NL', bypassRu: true, dnsLeakProtection: true,
    probe: async () => 80,
    fetchExit: async () => ({ ip: '203.0.113.7', countryCode: 'NL', countryName: 'Нидерланды', error: null }),
    fetchRealExit: async () => ({ ip: '198.51.100.5', countryCode: 'RU', countryName: 'Россия', error: null }),
    dnsResolverIp: async () => '172.69.0.1',
    countryOf: async () => 'NL',
    ruDirect: async () => ({ ms: 40, chain: 'direct' }),
    onUpdate: () => undefined,
    ...over
  })
  const statuses = (r: CheckReport): string => r.steps.map((s) => s.status).join(',')

  it('всё хорошо: четыре зелёных шага и довольная фраза', async () => {
    const r = await runSelfCheck(good())
    expect(statuses(r)).toBe('ok,ok,ok,ok')
    expect(r.verdict).toBe('ok')
    expect(r.finished).toBe(true)
    expect(r.summary).toContain('Всё работает')
    expect(r.summary).toContain('Нидерланды')
  })

  it('ход проверки виден по шагам: сначала всё ждёт, потом шаги идут по очереди', async () => {
    const seen: string[] = []
    await runSelfCheck(good({ onUpdate: (r) => seen.push(statuses(r)) }))
    expect(seen[0]).toBe('pending,pending,pending,pending')
    expect(seen).toContain('running,pending,pending,pending')
    expect(seen).toContain('ok,running,pending,pending')
    expect(seen[seen.length - 1]).toBe('ok,ok,ok,ok')
  })

  it('сервер молчит: проблема, итог со словами про другой сервер', async () => {
    const r = await runSelfCheck(good({ probe: async () => null, fetchExit: async () => ({ ip: null, countryCode: null, countryName: null, error: 'нет ответа' }) }))
    expect(r.verdict).toBe('fail')
    expect(r.steps[0]!.status).toBe('fail')
    expect(r.summary).toContain('не отвечает')
    expect(r.summary).toContain('другой сервер')
  })

  it('медленный сервер — замечание, а не поломка', async () => {
    const r = await runSelfCheck(good({ probe: async () => 900 }))
    expect(r.steps[0]!.status).toBe('warn')
    expect(r.verdict).toBe('warn')
  })

  it('адрес из России при сервере не в России — замечание; если сервер и правда в России — всё нормально', async () => {
    const ru = { ip: '198.51.100.9', countryCode: 'RU', countryName: 'Россия', error: null }
    const warn = await runSelfCheck(good({ fetchExit: async () => ru }))
    expect(warn.steps[1]!.status).toBe('warn')
    expect(warn.steps[1]!.detail).toContain('мимо VPN')
    const fine = await runSelfCheck(good({ fetchExit: async () => ru, serverCountry: 'RU', countryOf: async () => 'RU' }))
    expect(fine.steps[1]!.status).toBe('ok')
  })

  it('в режиме «Браузер и программы» совпадение с настоящим адресом — провал; в туннеле настоящий адрес не сравнивается', async () => {
    const same = { ip: '203.0.113.7', countryCode: 'NL', countryName: 'Нидерланды', error: null }
    const proxy = await runSelfCheck(good({ fetchRealExit: async () => same }))
    expect(proxy.steps[1]!.status).toBe('fail')
    expect(proxy.summary).toContain('адрес не изменился')
    let asked = false
    const tun = await runSelfCheck(good({ mode: 'tun', fetchRealExit: async () => { asked = true; return same } }))
    expect(asked).toBe(false) // в туннеле программа сама идёт через VPN — «настоящего» адреса получить нельзя, не сравниваем
    expect(tun.steps[1]!.status).toBe('ok')
  })

  it('служба определения адреса недоступна, а сервер отвечает — только предупреждение', async () => {
    const r = await runSelfCheck(good({ fetchExit: async () => ({ ip: null, countryCode: null, countryName: null, error: 'x' }) }))
    expect(r.steps[1]!.status).toBe('warn')
    expect(r.steps[1]!.detail).toContain('ещё не значит')
  })

  it('DNS: провайдер видит запросы — предупреждение с подсказкой включить защиту; при включённой защите — «попробуйте переподключиться»', async () => {
    const off = await runSelfCheck(good({ dnsLeakProtection: false, countryOf: async () => 'RU' }))
    expect(off.steps[2]!.status).toBe('warn')
    expect(off.steps[2]!.detail).toContain('Включите «Защиту от утечки DNS»')
    const on = await runSelfCheck(good({ dnsLeakProtection: true, countryOf: async () => 'RU' }))
    expect(on.steps[2]!.status).toBe('warn')
    expect(on.steps[2]!.detail).toContain('защита DNS включена')
    const unknown = await runSelfCheck(good({ dnsResolverIp: async () => null }))
    expect(unknown.steps[2]!.status).toBe('warn')
  })

  it('российский сайт: напрямую — хорошо; через VPN — замечание; не открылся — замечание; настройка выключена — так и задумано', async () => {
    expect((await runSelfCheck(good())).steps[3]!.detail).toContain('напрямую')
    const viaVpn = await runSelfCheck(good({ ruDirect: async () => ({ ms: 90, chain: 'proxy' }) }))
    expect(viaVpn.steps[3]!.status).toBe('warn')
    expect(viaVpn.steps[3]!.detail).toContain('Мимо VPN')
    expect((await runSelfCheck(good({ ruDirect: async () => ({ ms: null, chain: null }) }))).steps[3]!.status).toBe('warn')
    let asked = false
    const off = await runSelfCheck(good({ bypassRu: false, ruDirect: async () => { asked = true; return { ms: 1, chain: 'proxy' } } }))
    expect(asked).toBe(false) // выключено — и не трогаем российский сайт
    expect(off.steps[3]!.status).toBe('ok')
    expect(off.summary).not.toContain('российские сайты открываются напрямую')
  })

  it('отмена посреди проверки: дальше шаги не выполняются', async () => {
    let cancelled = false
    let dnsAsked = false
    const r = await runSelfCheck(good({ probe: async () => { cancelled = true; return 50 }, isCancelled: () => cancelled, dnsResolverIp: async () => { dnsAsked = true; return null } }))
    expect(dnsAsked).toBe(false)
    expect(r.finished).toBe(false)
  })
})

describe('проверка «всё ли работает»: на настоящем движке', () => {
  /** Движок отвечает на «адрес сайтов» и знает «российский» сайт ya.ru — всё это на этом же компьютере, без интернета. */
  const withLocalDns = (config: Record<string, unknown>): Record<string, unknown> => {
    const dns = config.dns as { servers: unknown[]; rules: unknown[] }
    dns.servers.push({ type: 'hosts', tag: 'dns-hosts', predefined: { 'whoami.akamai.net': '203.0.113.5', 'ya.ru': '127.0.0.1' } })
    dns.rules.unshift({ domain: ['whoami.akamai.net', 'ya.ru'], action: 'route', server: 'dns-hosts' })
    ;(config.route as Record<string, unknown>).default_domain_resolver = 'dns-hosts'
    return config
  }
  const fakeProxy = { supported: true, set: async () => undefined, clear: async () => undefined, pointsTo: async () => false }
  async function waitOn(c: AppController): Promise<void> {
    const t0 = Date.now()
    while (c.getStateSync().conn.status !== 'on') {
      if (c.getStateSync().conn.status === 'error' || Date.now() - t0 > 25000) throw new Error('не подключились: ' + JSON.stringify(c.getStateSync().conn.error))
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  const make = (name: string, ruUrl: string, over: Record<string, unknown> = {}) => newController(name, {
    systemProxy: fakeProxy,
    configTransform: withLocalDns,
    fetchExit: async (port) => (port === null ? { ip: '198.51.100.5', countryCode: 'RU', countryName: 'Россия', error: null } : { ip: '203.0.113.7', countryCode: 'NL', countryName: 'Нидерланды', error: null }),
    countryOf: async () => 'NL',
    ruCheckUrl: ruUrl,
    ...over
  })

  it('весь путь: сервер, адрес, DNS движка, российский сайт идёт напрямую (по данным самого движка)', async () => {
    const { c } = make('chk-1', `http://ya.ru:${target.port}/`)
    await c.init()
    await c.addKeyText(keyFor('Нидерланды'))
    await c.connect()
    await waitOn(c)
    await c.runCheck()
    const rep = c.getStateSync().check!
    expect(rep.finished).toBe(true)
    expect(rep.steps.map((s) => `${s.id}:${s.status}`)).toEqual(['server:ok', 'address:ok', 'dns:ok', 'ru-direct:ok'])
    expect(rep.steps[3]!.detail).toContain('напрямую')
    expect(rep.verdict).toBe('ok')
    // повторный запуск ничего не ломает, закрытие результата работает
    await c.clearCheck()
    expect(c.getStateSync().check).toBeNull()
    await c.disconnect()
    await c.shutdown()
  }, 60000)

  it('российский сайт, который по правилам идёт через VPN (не .ru), — замечание', async () => {
    // пример.test не в зонах .ru/.рф/.su и не в наборах, поэтому идёт через сервер
    const { c } = make('chk-2', `http://example.test:${target.port}/`)
    await c.init()
    await c.addKeyText(keyFor('Нидерланды'))
    await c.connect()
    await waitOn(c)
    await c.runCheck()
    const ru = c.getStateSync().check!.steps[3]!
    expect(ru.status).toBe('warn')
    expect(ru.detail).toContain('через VPN')
    await c.shutdown()
  }, 60000)

  it('DNS: движок отвечает адресом российского узла и защита выключена — человек получает совет', async () => {
    const { c } = make('chk-3', `http://ya.ru:${target.port}/`, { countryOf: async () => 'RU' })
    await c.init()
    await c.addKeyText(keyFor('Нидерланды'))
    await c.updateSettings({ dnsLeakProtection: false })
    await c.connect()
    await waitOn(c)
    await c.runCheck()
    const dns = c.getStateSync().check!.steps[2]!
    expect(dns.status).toBe('warn')
    expect(dns.detail).toContain('провайдер')
    await c.shutdown()
  }, 60000)

  it('VPN выключен: проверять нечего — понятное сообщение; при отключении результат пропадает', async () => {
    const { c } = make('chk-4', `http://ya.ru:${target.port}/`)
    await c.init()
    await c.runCheck()
    expect(c.getStateSync().check).toMatchObject({ finished: true, verdict: 'fail', summary: expect.stringContaining('включите VPN') })
    await c.addKeyText(keyFor('Нидерланды'))
    await c.connect()
    await waitOn(c)
    await c.runCheck()
    expect(c.getStateSync().check!.finished).toBe(true)
    await c.disconnect()
    expect(c.getStateSync().check).toBeNull() // подключение закончилось — результат уже ни о чём
    await c.shutdown()
  }, 60000)
})
