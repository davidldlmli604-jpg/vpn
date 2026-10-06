/// <reference lib="dom" />
// Настоящее приложение: запускаем Electron, нажимаем кнопки как человек, гоним трафик через настоящий движок.
// «Сервер» — настоящий sing-box на 127.0.0.1 (проверка без настоящего ключа поставщика).
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import { Box, freePort, httpViaProxy, removeDir, startTarget, tempDir } from '../helpers/loopback'
import { UUID } from '../fixtures'

const ROOT = resolve(__dirname, '..', '..')
// скриншоты настоящего окна по умолчанию уходят во временную папку; в docs/screenshots — только если задать SHOTS_DIR
const SHOTS = process.env.SHOTS_DIR ?? join(require('node:os').tmpdir(), 'tropa-e2e-shots')
const REPLY = 'ответ-через-настоящее-приложение'
const b64url = (s: string): string => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

let userData: string
let target: { port: number; close: () => Promise<void> }
let server: Box
let serverPort: number
let app: ElectronApplication
let win: Page
let key: string
let dir: string
const LOG = process.env.E2E_LOG
const step = (m: string): void => { if (LOG) require('node:fs').appendFileSync(LOG, `${new Date().toISOString().slice(11, 23)} ${m}\n`) }

async function launchApp(userDataDir: string, extra: { args?: string[]; env?: Record<string, string> } = {}): Promise<{ app: ElectronApplication; win: Page }> {
  const application = await electron.launch({
    executablePath: join(ROOT, 'node_modules', 'electron', 'dist', 'electron'),
    // флаги: окно без оконного менеджера считалось бы скрытым, и кадры (а с ними и анимации) не рисовались бы
    args: ['--no-sandbox', '--disable-gpu', '--no-proxy-server', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion', ROOT, ...(extra.args ?? [])],
    env: { ...process.env, TROPA_USER_DATA: userDataDir, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', ...(extra.env ?? {}) } as Record<string, string>,
    timeout: 60000
  })
  // Только для этой проверки на Linux (там нет связки ключей): упрощённое хранилище. В Windows используется настоящее шифрование системы.
  await application.evaluate(({ safeStorage }) => safeStorage.setUsePlainTextEncryption(true))
  const window = await application.firstWindow()
  window.on('pageerror', (e) => console.error('ошибка окна:', e.message))
  return { app: application, win: window }
}

/** Папка данных, в которой мастер первого запуска уже пройден (чтобы остальные проверки сразу видели главный экран). */
function seedUserData(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true })
  writeFileSync(join(dirPath, 'data.json'), JSON.stringify({ version: 1, settings: { wizardDone: true }, servers: [], subscriptions: [], rulesUpdatedAt: null, runtime: {} }))
}

async function launch(): Promise<void> {
  const r = await launchApp(userData)
  app = r.app
  win = r.win
  await win.waitForSelector('.sidebar', { timeout: 30000 })
}

/** Снимок окна средствами самого Electron: Playwright «ждёт тишины» от вечных анимаций и может зависнуть. */
async function shot(name: string): Promise<void> {
  const b64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(b64, 'base64'))
}

async function waitStatus(text: string, ms = 30000): Promise<void> {
  await win.waitForFunction((t) => document.querySelector('.mini-status__title')?.textContent === t, text, { timeout: ms, polling: 200 })
}

beforeAll(async () => {
  if (!existsSync(join(ROOT, 'dist-electron', 'main.js')) || !existsSync(join(ROOT, 'dist', 'index.html'))) throw new Error('Сначала соберите приложение: npm run build')
  mkdirSync(SHOTS, { recursive: true })
  dir = tempDir('tropa-e2e-')
  userData = join(dir, 'userdata')
  seedUserData(userData)
  target = await startTarget(REPLY)
  serverPort = await freePort()
  server = new Box('server', {
    log: { level: 'info' },
    inbounds: [{ type: 'shadowsocks', tag: 'in', listen: '127.0.0.1', listen_port: serverPort, method: 'aes-256-gcm', password: 'e2e-secret-pw' }],
    outbounds: [{ type: 'direct', tag: 'direct' }],
    route: { rules: [{ action: 'route', outbound: 'direct', override_address: '127.0.0.1', override_port: target.port }], final: 'direct' }
  }, dir)
  await server.start()
  key = `ss://${b64url('aes-256-gcm:e2e-secret-pw')}@127.0.0.1:${serverPort}#${encodeURIComponent('🇳🇱 Нидерланды · тест')}`
  await launch()
}, 120000)

afterAll(async () => {
  await app?.close().catch(() => undefined)
  await server?.stop()
  await target?.close()
  if (dir) removeDir(dir)
})

describe('настоящее приложение', () => {
  it('при первом запуске ключа нет: большая кнопка предлагает вставить ключ', async () => {
    expect(await win.locator('.power__label').innerText()).toMatch(/вставить ключ/i)
    expect(await win.locator('.hero__title').innerText()).toContain('Нужен ключ')
    await shot('real-1-first-run')
  })

  it('«Вставить ключ» берёт ключ из буфера, добавляет сервер и сразу подключает', async () => {
    step('clipboard')
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), key)
    step('click')
    await win.locator('.power__face').click({ force: true })
    step('wait toast')
    await win.waitForSelector('.toast', { timeout: 10000 })
    expect(await win.locator('.toast').first().innerText()).toContain('Ключ добавлен')
    step('wait on')
    await waitStatus('Работает', 30000)
    step('on!')
    // заголовок меняется плавно (старый уходит, новый появляется) — ждём, а не проверяем мгновенно
    await win.waitForFunction(() => document.querySelector('.hero__title')?.textContent?.includes('Работает'), null, { timeout: 10000, polling: 200 })
    // название без флага-эмодзи и со страной по названию
    expect(await win.locator('.server-hero__name').innerText()).toBe('Нидерланды · тест')
    await win.waitForTimeout(2500)
    await shot('real-2-connected')
  })

  it('трафик действительно идёт через движок приложения', async () => {
    // порт по умолчанию 7890; если был занят, приложение выбрало другой — узнаем из журнала движка
    const port = await findMixedPort()
    const r = await httpViaProxy(port, 'http://203.0.113.7:8080/')
    expect(r.body).toBe(REPLY)
    await win.waitForFunction(() => /\d/.test(document.querySelector('.tile__value')?.textContent ?? ''), null, { timeout: 15000, polling: 200 })
  })

  it('скорость и график оживают', async () => {
    const port = await findMixedPort()
    for (let i = 0; i < 6; i++) await httpViaProxy(port, 'http://203.0.113.7:8080/' + i)
    await win.waitForTimeout(1500)
    const tiles = await win.locator('.tile__value').allInnerTexts()
    expect(tiles.length).toBeGreaterThanOrEqual(4)
  })

  it('отключение возвращает «Выключено» и закрывает порт', async () => {
    const port = await findMixedPort()
    await win.locator('.power__face').click({ force: true })
    await waitStatus('Выключено', 15000)
    await expect(httpViaProxy(port, 'http://203.0.113.7:8080/', 1500)).rejects.toBeTruthy()
  })

  it('ключ в файле данных лежит только в зашифрованном виде', async () => {
    await new Promise((r) => setTimeout(r, 800))
    const text = readFileSync(join(userData, 'data.json'), 'utf8')
    for (const secret of ['e2e-secret-pw', 'ss://', Buffer.from('aes-256-gcm:e2e-secret-pw').toString('base64').slice(0, 20), UUID]) expect(text).not.toContain(secret)
    expect(text).toContain('"sealed"')
  })

  it('после перезапуска сервер на месте, выбран и подключается снова', async () => {
    await app.close()
    await launch()
    expect(await win.locator('.mini-status__sub').innerText()).toContain('Нидерланды')
    await win.locator('.power__face').click({ force: true })
    await waitStatus('Работает', 30000)
    await win.locator('.power__face').click({ force: true })
    await waitStatus('Выключено', 15000)
  })

  it('неверный ключ: понятная ошибка простыми словами', async () => {
    await win.getByRole('button', { name: 'Серверы' }).first().click({ force: true })
    await win.waitForSelector('.server')
    // добавляем второй сервер с неправильным паролем и выбираем его
    const bad = `ss://${b64url('aes-256-gcm:НЕВЕРНЫЙ-ПАРОЛЬ')}@127.0.0.1:${serverPort}#${encodeURIComponent('Сломанный')}`
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), bad)
    await win.getByRole('button', { name: /Вставить ключ/ }).first().click({ force: true })
    await win.waitForSelector('.server:has-text("Сломанный")')
    await win.locator('.server:has-text("Сломанный")').click({ force: true })
    await win.getByRole('button', { name: 'Главная' }).first().click({ force: true })
    await win.locator('.power__face').click({ force: true })
    await win.waitForFunction(() => document.querySelector('.hero__title')?.textContent?.includes('Сервер не отвечает'), null, { timeout: 60000, polling: 200 })
    expect(await win.locator('.hero__sub').innerText()).toMatch(/ключ устарел или введён с ошибкой/)
    await shot('real-3-error')
  })

  it('мусор в буфере: человеческое сообщение, ничего не сломалось', async () => {
    await win.getByRole('button', { name: 'Серверы' }).first().click({ force: true })
    await app.evaluate(({ clipboard }) => clipboard.writeText('привет, это не ключ'), undefined)
    await win.getByRole('button', { name: /Вставить ключ/ }).first().click({ force: true })
    await win.waitForFunction(() => Array.from(document.querySelectorAll('.toast')).some((t) => t.textContent?.includes('Это не похоже на ключ')), null, { timeout: 8000, polling: 200 })
  })
})


describe('Шелти-помощник', () => {
  async function hoverOn(selector: string): Promise<void> {
    const b = await win.locator(selector).first().boundingBox()
    if (!b) throw new Error('нет элемента ' + selector)
    await win.mouse.move(b.x + b.width / 2 - 30, b.y + b.height / 2 - 30)
    await win.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 })
  }

  it('собака на месте, а при наведении на кнопку объясняет, что она делает', async () => {
    await win.getByRole('button', { name: 'Главная' }).first().click({ force: true })
    await win.waitForSelector('.power__face')
    expect(await win.locator('.assistant__dog').count()).toBe(1)
    await new Promise((r) => setTimeout(r, 900)) // страница ещё «въезжает»: пока она движется, мышь попала бы мимо кнопки
    const sees = (): Promise<unknown> => win.waitForFunction(() => /кнопк|VPN/i.test(document.querySelector('.bubble')?.textContent ?? ''), null, { timeout: 4000, polling: 200 })
    await hoverOn('.power__face')
    await sees().catch(async () => { await hoverOn('.power__face'); await sees() }) // один повтор на случай, если нагруженная машина пропустила движение мыши
    expect(await win.locator('.bubble').innerText()).toContain('ШЕЛТИ')
    await shot('real-4-sheltie-hint')
  })

  it('подсказки есть у плиток, графика, режимов и пунктов меню', async () => {
    const missing = await win.evaluate(() => {
      const need = ['.tile', '.chart-card', '.exit', '.server-hero', '.nav', '.mini-status', '.segmented__item']
      return need.filter((sel) => Array.from(document.querySelectorAll(sel)).some((el) => !el.closest('[data-hint]') && !el.hasAttribute('data-hint'))).join(', ')
    })
    expect(missing).toBe('')
  })

  it('на странице серверов подсказки есть у карточки, звёздочки и кнопки вставки', async () => {
    await win.getByRole('button', { name: 'Серверы' }).first().click({ force: true })
    await win.waitForSelector('.server')
    const missing = await win.evaluate(() => ['.server', '.star', '.page__head .btn'].filter((sel) => Array.from(document.querySelectorAll(sel)).some((el) => !el.closest('[data-hint]'))).join(', '))
    expect(missing).toBe('')
  })

  it('в настройках собаку можно выключить и включить', async () => {
    await win.getByRole('button', { name: 'Настройки' }).first().click({ force: true })
    await win.waitForSelector('[aria-label="Шелти-помощник"]')
    await new Promise((r) => setTimeout(r, 800)) // страница ещё «въезжает» — ждём, пока осядет
    // переключатель может быть ниже видимой части окна: нажимаем средствами страницы
    const press = (): Promise<void> => win.locator('button[role="switch"][aria-label="Шелти-помощник"]').evaluate((el) => (el as HTMLElement).click())
    await press()
    await win.waitForFunction(() => document.querySelectorAll('.assistant__dog').length === 0, null, { timeout: 8000, polling: 200 })
    await press()
    await win.waitForFunction(() => document.querySelectorAll('.assistant__dog').length === 1, null, { timeout: 8000, polling: 200 })
  })
})


describe('«Мимо VPN» в настоящем окне', () => {
  const runtimeConfig = (): { route: { rules: Array<Record<string, unknown>>; rule_set?: unknown[] } } => JSON.parse(readFileSync(join(userData, 'runtime', 'config.json'), 'utf8'))
  const press = (selector: string): Promise<void> => win.locator(selector).first().evaluate((el) => (el as HTMLElement).click())

  it('выбираем рабочий сервер и открываем страницу', async () => {
    await win.getByRole('button', { name: 'Серверы' }).first().click({ force: true })
    await win.waitForSelector('.server')
    await win.locator('.server:has-text("Нидерланды")').evaluate((el) => (el as HTMLElement).click())
    await win.getByRole('button', { name: 'Мимо VPN' }).first().click({ force: true })
    await win.waitForSelector('.rules-status')
    await new Promise((r) => setTimeout(r, 700))
    expect(await win.locator('.rules-status').innerText()).toContain('вшитые')
    await shot('real-5-bypass')
  })

  it('программа из списка запущенных попадает в «мимо VPN», игровой набор включается', async () => {
    await press('button:has-text("Выбрать из запущенных")')
    await win.waitForSelector('.picker__row', { timeout: 20000 })
    await win.locator('.picker input, input[placeholder="Поиск по названию"]').first().fill('sing-box')
    await win.waitForSelector('.picker__row:has-text("sing-box")')
    await win.locator('.picker__row:has-text("sing-box")').first().evaluate((el) => (el as HTMLElement).click())
    await win.locator('.modal .btn--primary').evaluate((el) => (el as HTMLElement).click())
    await win.waitForSelector('.app-chip:has-text("sing-box")')
    await win.locator('button[role="switch"][aria-label="Игры и лаунчеры"]').evaluate((el) => (el as HTMLElement).click())
    await win.waitForFunction(() => document.querySelector('button[role="switch"][aria-label="Игры и лаунчеры"]')?.getAttribute('aria-checked') === 'true', null, { timeout: 5000, polling: 200 })
  })

  it('свои списки приводятся в порядок: адрес со страницей, кириллица, звёздочка, IP', async () => {
    const [vpnBox, directBox] = await win.locator('.textarea').all()
    await vpnBox!.fill('https://www.Пример.рф/страница?x=1\nblocked-but-ru.ru')
    await vpnBox!.evaluate((el) => (el as HTMLTextAreaElement).blur())
    await directBox!.fill('*.my-bank.example.org, 203.0.113.99, мусор!!!')
    await directBox!.evaluate((el) => (el as HTMLTextAreaElement).blur())
    await win.waitForFunction(() => (document.querySelectorAll('.textarea')[0] as HTMLTextAreaElement).value.includes('xn--'), null, { timeout: 5000, polling: 200 })
    expect(await vpnBox!.inputValue()).toBe('xn--e1afmkfd.xn--p1ai\nblocked-but-ru.ru')
    expect(await directBox!.inputValue()).toBe('my-bank.example.org\n203.0.113.99/32')
    expect(await win.locator('.domlist__foot .badge').allInnerTexts()).toEqual([expect.stringContaining('мусор')]) // «не понял: мусор!!!» подсказано человеку
  })

  it('после подключения движок получил именно эти правила', async () => {
    await win.getByRole('button', { name: 'Главная' }).first().click({ force: true })
    await win.waitForSelector('.power__face')
    await new Promise((r) => setTimeout(r, 600))
    await press('.power__face')
    await waitStatus('Работает', 30000)
    const cfg = runtimeConfig()
    const rules = cfg.route.rules
    const find = (pred: (r: Record<string, unknown>) => boolean): Record<string, unknown> | undefined => rules.find(pred)
    // российские сайты напрямую: зоны + наборы
    expect(find((r) => Array.isArray(r.domain_suffix) && (r.domain_suffix as string[]).includes('xn--p1ai') && r.outbound === 'direct')).toBeTruthy()
    expect(cfg.route.rule_set!.length).toBe(31)
    // программы мимо VPN: выбранная + игровой набор
    const proc = find((r) => Array.isArray(r.process_name))!
    expect(proc.outbound).toBe('direct')
    expect(proc.process_name).toEqual(expect.arrayContaining(['sing-box', 'steam.exe', 'Steam.exe'.toLowerCase()]))
    // свои списки: «всегда через VPN» главнее .ru и стоит раньше
    const vpnRule = find((r) => Array.isArray(r.domain_suffix) && (r.domain_suffix as string[]).includes('xn--e1afmkfd.xn--p1ai'))!
    expect(vpnRule.outbound).toBe('proxy')
    const ruZone = find((r) => Array.isArray(r.domain_suffix) && (r.domain_suffix as string[]).includes('xn--p1ai') && r.outbound === 'direct')!
    expect(rules.indexOf(vpnRule)).toBeLessThan(rules.indexOf(ruZone))
    expect(find((r) => Array.isArray(r.ip_cidr) && (r.ip_cidr as string[]).includes('203.0.113.99/32'))!.outbound).toBe('direct')
    // домашняя сеть — всегда напрямую
    expect(find((r) => r.ip_is_private === true)!.outbound).toBe('direct')
  })

  it('выключаем «российские сайты напрямую»: подключение само перезапускается с новыми правилами', async () => {
    await win.getByRole('button', { name: 'Мимо VPN' }).first().click({ force: true })
    await win.waitForSelector('button[role="switch"][aria-label="Российские сайты напрямую"]')
    await new Promise((r) => setTimeout(r, 600))
    await press('button[role="switch"][aria-label="Российские сайты напрямую"]')
    await win.waitForFunction(() => document.querySelector('button[role="switch"][aria-label="Российские сайты напрямую"]')?.getAttribute('aria-checked') === 'false', null, { timeout: 5000, polling: 200 })
    // ждём, пока перезапустится: файл настроек обновится и без наборов правил
    const t0 = Date.now()
    let n = -1
    while (Date.now() - t0 < 20000) {
      try { n = (runtimeConfig().route.rule_set ?? []).length } catch { n = -1 }
      if (n === 0) break
      await new Promise((r) => setTimeout(r, 300))
    }
    expect(n).toBe(0)
    await waitStatus('Работает', 20000)
    const r = await httpViaProxy(JSON.parse(readFileSync(join(userData, 'runtime', 'config.json'), 'utf8')).inbounds.find((i: { type: string }) => i.type === 'mixed').listen_port, 'http://203.0.113.7:8080/')
    expect(r.body).toBe(REPLY) // и после перезапуска трафик идёт
    await win.getByRole('button', { name: 'Главная' }).first().click({ force: true })
    await win.waitForSelector('.power__face')
    await new Promise((res) => setTimeout(res, 600))
    await press('.power__face')
    await waitStatus('Выключено', 15000)
  })

  it('закрытие программы при включённом VPN: движок остановлен, настройки прокси не остались', async () => {
    await press('.power__face')
    await waitStatus('Работает', 30000)
    const port = JSON.parse(readFileSync(join(userData, 'runtime', 'config.json'), 'utf8')).inbounds.find((i: { type: string }) => i.type === 'mixed').listen_port as number
    const t0 = Date.now()
    await app.close()
    expect(Date.now() - t0).toBeLessThan(15000) // закрылась быстро, не «зависла»
    await expect(httpViaProxy(port, 'http://203.0.113.7:8080/', 1500)).rejects.toBeTruthy() // порт закрыт — движок не остался в фоне
    expect(existsSync(join(userData, 'runtime', 'config.json'))).toBe(false) // файл с секретами удалён
    await launch() // чтобы общий «afterAll» мог закрыть приложение как обычно
  })
})

describe('«Серверы»: подписка, задержка, QR-код и проверка в настоящем окне', () => {
  let web: HttpServer
  let subUrl = ''
  let subMode: 'two' | 'three' | '403' = 'two'
  const press = (selector: string): Promise<void> => win.locator(selector).first().evaluate((el) => (el as HTMLElement).click())
  const pressText = (text: string): Promise<void> => win.getByText(text, { exact: false }).first().evaluate((el) => ((el.closest('button') ?? el) as HTMLElement).click())
  const ssKey = (host: string, port: number, name: string): string => `ss://${b64url('aes-256-gcm:e2e-secret-pw')}@${host}:${port}#${encodeURIComponent(name)}`

  beforeAll(async () => {
    const dead = await freePort() // порт, на котором никого нет
    const dead2 = await freePort()
    web = createHttpServer((req, res) => {
      if (subMode === '403') { res.writeHead(403); res.end('forbidden'); return }
      const keys = [ssKey('localhost', serverPort, 'Подписка · быстрый'), ssKey('127.0.0.1', dead, 'Подписка · мёртвый')]
      if (subMode === 'three') keys.push(ssKey('127.0.0.1', dead2, 'Подписка · новый'))
      res.writeHead(200, { 'subscription-userinfo': 'upload=1073741824; download=3221225472; total=10737418240; expire=1893456000', 'profile-title': 'E2E VPN', 'profile-update-interval': '6' })
      res.end(Buffer.from(keys.join('\n')).toString('base64'))
    })
    await new Promise<void>((r) => web.listen(0, '127.0.0.1', r))
    subUrl = `http://127.0.0.1:${(web.address() as { port: number }).port}/sub/секретный-токен`
  })
  afterAll(async () => { web?.closeAllConnections(); await new Promise<void>((r) => web?.close(() => r())) })

  it('ссылка на подписку из буфера: появляется карточка подписки с остатком трафика и серверы из неё', async () => {
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), subUrl)
    await win.getByRole('button', { name: 'Серверы' }).first().click({ force: true })
    await win.waitForSelector('.server')
    await new Promise((r) => setTimeout(r, 800))
    await pressText('Вставить ключ или подписку')
    await win.waitForSelector('.sub', { timeout: 15000 })
    expect(await win.locator('.sub__name').first().innerText()).toBe('E2E VPN')
    expect(await win.locator('.sub__usage').first().innerText()).toContain('использовано 4 ГБ из 10 ГБ')
    await win.waitForFunction(() => document.querySelectorAll('.server').length === 4, null, { timeout: 8000, polling: 200 }) // два прежних (один из них «Сломанный» с прошлых проверок) и два из подписки
    // секретная часть ссылки на экране не показывается
    expect(await win.locator('body').innerText()).not.toContain('секретный-токен')
    await new Promise((r) => setTimeout(r, 900))
    await shot('real-6-subscription')
  })

  it('«Проверить задержку»: рабочие серверы получают миллисекунды, мёртвый — «не отвечает»', async () => {
    // автоматическая проверка при заходе на страницу могла уже идти — дожидаемся тишины, затем запускаем сами
    await win.waitForFunction(() => document.querySelectorAll('.server .badge .spinner').length === 0, null, { timeout: 30000, polling: 200 })
    await pressText('Проверить задержку')
    try {
      await win.waitForFunction(() => {
        const cards = Array.from(document.querySelectorAll('.server'))
        return cards.length === 4 && cards.every((c) => /мс|не отвечает/.test(c.textContent ?? ''))
      }, null, { timeout: 40000, polling: 300 })
    } catch (e) {
      console.log('КАРТОЧКИ', JSON.stringify(await win.locator('.server').allInnerTexts()))
      throw e
    }
    const texts = await win.locator('.server').allInnerTexts()
    expect(texts.filter((t) => /\d+ мс/.test(t))).toHaveLength(2) // «Нидерланды · тест» и «Подписка · быстрый»
    expect(texts.filter((t) => t.includes('не отвечает'))).toHaveLength(2) // «Сломанный» и «Подписка · мёртвый»
    await shot('real-7-latency')
  })

  it('«Быстрые сверху» меняет порядок: мёртвый сервер уходит вниз', async () => {
    await pressText('Быстрые сверху')
    await new Promise((r) => setTimeout(r, 1200))
    const cards = await win.locator('.server').allInnerTexts()
    expect(cards[0]).toMatch(/\d+ мс/) // быстрые наверху
    expect(cards[cards.length - 1]).toContain('не отвечает') // молчащие внизу
    await pressText('Как добавлены')
  })

  it('QR-код: сначала предупреждение, ключ показывается только по нажатию, после закрытия не остаётся', async () => {
    await press('[aria-label="Действия с подпиской"]')
    await pressText('Показать QR-код')
    await win.waitForSelector('.modal')
    expect(await win.locator('.modal').innerText()).toContain('Любой, кто его отсканирует')
    expect(await win.locator('.qr__img').count()).toBe(0) // код ещё не показан
    await pressText('Показать код')
    await win.waitForSelector('.qr__img', { timeout: 10000 })
    const size = await win.locator('.qr__img').evaluate(async (el) => {
      const img = el as HTMLImageElement
      await img.decode()
      return img.naturalWidth
    })
    expect(size).toBeGreaterThan(200)
    await shot('real-8-qr')
    await pressText('Закрыть')
    await win.waitForFunction(() => document.querySelectorAll('.modal').length === 0, null, { timeout: 5000, polling: 200 })
    expect(await win.locator('.qr__img').count()).toBe(0)
  })

  it('обновление подписки: новый сервер появляется, а при ошибке сайта серверы остаются и видна понятная пометка', async () => {
    subMode = 'three'
    await press('[aria-label="Обновить подписку"]')
    await win.waitForFunction(() => document.querySelectorAll('.server').length === 5, null, { timeout: 10000, polling: 200 }) // поставщик добавил сервер — он появился сам
    subMode = '403'
    await new Promise((r) => setTimeout(r, 500))
    await press('[aria-label="Обновить подписку"]')
    await win.waitForSelector('.sub__error', { timeout: 10000 })
    expect(await win.locator('.sub__error').innerText()).toContain('не пустил')
    expect(await win.locator('.server').count()).toBe(5) // серверы на месте (вместе с новым)
    await shot('real-9-sub-error')
    subMode = 'two'
    await press('[aria-label="Обновить подписку"]')
    await win.waitForFunction(() => document.querySelectorAll('.sub__error').length === 0, null, { timeout: 10000, polling: 200 })
  })

  it('«Проверить, всё ли работает»: шаги идут по очереди, в конце — итог словами', async () => {
    await win.locator('.server:has-text("быстрый")').evaluate((el) => (el as HTMLElement).click())
    await win.getByRole('button', { name: 'Главная' }).first().click({ force: true })
    await win.waitForSelector('.power__face')
    await new Promise((r) => setTimeout(r, 600))
    await press('.power__face')
    await waitStatus('Работает', 30000)
    await win.waitForSelector('.check', { timeout: 10000 })
    await pressText('Проверить, всё ли работает')
    await win.waitForSelector('.check__step', { timeout: 10000 })
    // внешних сайтов (определение страны, ya.ru) в этой проверке нет, поэтому часть шагов закончится замечанием — это нормально;
    // главное: ход виден, итог пришёл, а связь с сервером подтверждена
    await win.waitForSelector('.check__summary', { timeout: 100000 })
    const steps = await win.locator('.check__step').evaluateAll((els) => els.map((e) => ({ status: e.getAttribute('data-status'), text: (e as HTMLElement).innerText })))
    expect(steps).toHaveLength(4)
    expect(steps[0]!.status).toBe('ok')
    expect(steps.every((x) => ['ok', 'warn', 'fail'].includes(x.status!))).toBe(true)
    expect((await win.locator('.check__text').innerText()).length).toBeGreaterThan(20)
    await new Promise((r) => setTimeout(r, 1200))
    await shot('real-10-check')
    // закрытие результата
    await press('[aria-label="Закрыть результат"]')
    await win.waitForSelector('.check__ask', { timeout: 5000 })
    await press('.power__face')
    await waitStatus('Выключено', 15000)
  })

  it('удаление подписки убирает и её серверы; ручной сервер остаётся', async () => {
    await win.getByRole('button', { name: 'Серверы' }).first().click({ force: true })
    await win.waitForSelector('.sub')
    await new Promise((r) => setTimeout(r, 700))
    await press('[aria-label="Действия с подпиской"]')
    await pressText('Удалить')
    await win.waitForSelector('.modal')
    await win.locator('.modal .btn--danger').evaluate((el) => (el as HTMLElement).click())
    await win.waitForFunction(() => document.querySelectorAll('.sub').length === 0, null, { timeout: 8000, polling: 200 })
    await win.waitForFunction(() => document.querySelectorAll('.server').length === 2, null, { timeout: 8000, polling: 200 }) // остались два «ручных»
  })
})

describe('вставка по Ctrl+V', () => {
  it('нажатие Ctrl+V в окне (не в поле ввода) добавляет скопированный ключ; в поле ввода вставка остаётся обычной', async () => {
    const before = await win.locator('.server').count()
    // другой адрес (localhost), чтобы это не был повтор уже добавленного ключа
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), `ss://${b64url('aes-256-gcm:e2e-secret-pw')}@localhost:${serverPort}#${encodeURIComponent('Вставлен по Ctrl+V')}`)
    await win.locator('.page__title').click({ force: true }) // фокус в окне, но не в поле ввода
    await win.keyboard.press('Control+V')
    await win.waitForFunction((n) => document.querySelectorAll('.server').length === n + 1, before, { timeout: 8000, polling: 200 })
    expect(await win.locator('.server__name').allInnerTexts()).toContain('Вставлен по Ctrl+V')
    // на странице «Мимо VPN» есть поля ввода: там Ctrl+V вставляет текст в поле и сервер не добавляется
    await app.evaluate(({ clipboard }) => clipboard.writeText('ss://подделка'))
    await win.getByRole('button', { name: 'Мимо VPN' }).first().click({ force: true })
    await win.waitForSelector('.textarea')
    await new Promise((r) => setTimeout(r, 700))
    await win.locator('.textarea').first().focus()
    await win.keyboard.press('Control+V')
    await new Promise((r) => setTimeout(r, 800))
    expect(await win.locator('.textarea').first().inputValue()).toContain('ss://подделка') // вставилось в поле, как обычно
    expect((await win.locator('.toast').allInnerTexts()).join(' ')).not.toContain('не похоже на ключ') // и ключом не сочлось
    await win.getByRole('button', { name: 'Серверы' }).first().click({ force: true })
    await win.waitForSelector('.server')
    expect(await win.locator('.server').count()).toBe(before + 1)
  })
})

describe('первый запуск: мастер из трёх шагов', () => {
  let wApp: ElectronApplication
  let w: Page
  let wData: string
  const press = (selector: string): Promise<void> => w.locator(selector).first().evaluate((el) => (el as HTMLElement).click())
  const pressText = (text: string): Promise<void> => w.getByText(text, { exact: false }).first().evaluate((el) => ((el.closest('button') ?? el) as HTMLElement).click())

  afterAll(async () => { await wApp?.close().catch(() => undefined) })

  it('при чистой установке открывается мастер, а не главный экран', async () => {
    wData = join(dir, 'userdata-wizard')
    const r = await launchApp(wData)
    wApp = r.app
    w = r.win
    await w.waitForSelector('.wizard', { timeout: 30000 })
    expect(await w.locator('.sidebar').count()).toBe(0)
    expect(await w.locator('.wizard__title').innerText()).toBe('Добавьте ключ')
    expect(await w.locator('.wizard__nav .btn').innerText()).toContain('У меня пока нет ключа') // без ключа дальше можно только «пропустить»
  })

  it('шаг 1: ключ из буфера добавляется, появляется подтверждение с названием сервера', async () => {
    await wApp.evaluate(({ clipboard }, text) => clipboard.writeText(text), key)
    await pressText('Вставить ключ или подписку')
    await w.waitForSelector('.wizard__ok', { timeout: 10000 })
    expect(await w.locator('.wizard__ok').innerText()).toContain('Нидерланды · тест')
    expect(await w.locator('.wizard__nav .btn--primary').innerText()).toContain('Дальше')
  })

  it('шаг 2: два режима, «Браузер и программы» уже выбран и подписан как рекомендуемый', async () => {
    await pressText('Дальше')
    await w.waitForSelector('.modecard')
    expect(await w.locator('.wizard__title').innerText()).toContain('Что пускать через VPN')
    expect(await w.locator('.modecard').count()).toBe(2)
    expect(await w.locator('.modecard[aria-checked="true"]').innerText()).toContain('Браузер и программы')
    expect(await w.locator('.modecard').first().innerText()).toContain('Рекомендуем для начала')
    await shot('real-11-wizard-mode')
  })

  it('шаг 3: большая кнопка включает VPN прямо в мастере, а «Начать пользоваться» открывает программу', async () => {
    await pressText('Дальше')
    await w.waitForSelector('.wizard__power')
    await new Promise((r) => setTimeout(r, 700))
    await press('.power__face')
    await w.waitForFunction(() => document.querySelector('.wizard__title')?.textContent === 'Всё работает!', null, { timeout: 30000, polling: 200 })
    await new Promise((r) => setTimeout(r, 1500))
    await pressText('Начать пользоваться')
    await w.waitForSelector('.sidebar', { timeout: 10000 })
    expect(await w.locator('.wizard').count()).toBe(0)
    await w.waitForFunction(() => document.querySelector('.mini-status__title')?.textContent === 'Работает', null, { timeout: 10000, polling: 200 })
  })

  it('мастер больше не появляется после перезапуска, а сервер и выбор на месте', async () => {
    await new Promise((r) => setTimeout(r, 800)) // настройки сохраняются с небольшой задержкой
    await wApp.close()
    const saved = JSON.parse(readFileSync(join(wData, 'data.json'), 'utf8'))
    expect(saved.settings.wizardDone).toBe(true)
    const r = await launchApp(wData)
    wApp = r.app
    w = r.win
    await w.waitForSelector('.sidebar', { timeout: 30000 })
    expect(await w.locator('.wizard').count()).toBe(0)
    expect(await w.locator('.server-hero__name').innerText()).toBe('Нидерланды · тест')
  })
})

describe('запуск свёрнутым (автозапуск с Windows)', () => {
  it('с признаком «свёрнуто» окно не показывается, а программа работает; без него — показывается', async () => {
    const hiddenData = join(dir, 'userdata-hidden')
    seedUserData(hiddenData)
    // значок в трее на Linux создаётся только по специальной переменной; без значка окно показалось бы, чтобы человек не потерял программу
    const r = await launchApp(hiddenData, { args: ['--hidden'], env: { TROPA_FORCE_TRAY: '1' } })
    try {
      await new Promise((res) => setTimeout(res, 2500))
      expect(await r.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible())).toBe(false)
      // программа при этом жива и отвечает: окно можно показать «из трея»
      await r.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.show())
      await r.win.waitForSelector('.sidebar', { timeout: 10000 })
    } finally {
      await r.app.close().catch(() => undefined)
    }
    const shown = await launchApp(join(dir, 'userdata-hidden'), { env: { TROPA_FORCE_TRAY: '1' } })
    try {
      await new Promise((res) => setTimeout(res, 2000))
      expect(await shown.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible())).toBe(true)
    } finally {
      await shown.app.close().catch(() => undefined)
    }
  })

  it('свёрнутый запуск без значка в трее: окно всё равно показывается (иначе программу нельзя было бы найти)', async () => {
    const noTray = join(dir, 'userdata-notray')
    seedUserData(noTray)
    const r = await launchApp(noTray, { args: ['--hidden'] }) // на Linux без TROPA_FORCE_TRAY значка нет
    try {
      await new Promise((res) => setTimeout(res, 2000))
      expect(await r.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible())).toBe(true)
    } finally {
      await r.app.close().catch(() => undefined)
    }
  })
})

/** Порт локального входа движка — из его рабочего конфига (пока подключено, файл лежит в папке данных). */
async function findMixedPort(): Promise<number> {
  const file = join(userData, 'runtime', 'config.json')
  const cfg = JSON.parse(readFileSync(file, 'utf8')) as { inbounds: Array<{ type: string; listen_port: number }> }
  return cfg.inbounds.find((i) => i.type === 'mixed')!.listen_port
}