/// <reference lib="dom" />
// Настоящее приложение: запускаем Electron, нажимаем кнопки как человек, гоним трафик через настоящий движок.
// «Сервер» — настоящий sing-box на 127.0.0.1 (проверка без настоящего ключа поставщика).
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
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

async function launch(): Promise<void> {
  app = await electron.launch({
    executablePath: join(ROOT, 'node_modules', 'electron', 'dist', 'electron'),
    // флаги: окно без оконного менеджера считалось бы скрытым, и кадры (а с ними и анимации) не рисовались бы
    args: ['--no-sandbox', '--disable-gpu', '--no-proxy-server', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion', ROOT],
    env: { ...process.env, TROPA_USER_DATA: userData, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } as Record<string, string>,
    timeout: 60000
  })
  // Только для этой проверки на Linux (там нет связки ключей): упрощённое хранилище. В Windows используется настоящее шифрование системы.
  await app.evaluate(({ safeStorage }) => safeStorage.setUsePlainTextEncryption(true))
  win = await app.firstWindow()
  win.on('pageerror', (e) => console.error('ошибка окна:', e.message))
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
    await hoverOn('.power__face')
    await win.waitForFunction(() => /кнопк|VPN/i.test(document.querySelector('.bubble')?.textContent ?? ''), null, { timeout: 8000, polling: 200 })
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

/** Порт локального входа движка — из его рабочего конфига (пока подключено, файл лежит в папке данных). */
async function findMixedPort(): Promise<number> {
  const file = join(userData, 'runtime', 'config.json')
  const cfg = JSON.parse(readFileSync(file, 'utf8')) as { inbounds: Array<{ type: string; listen_port: number }> }
  return cfg.inbounds.find((i) => i.type === 'mixed')!.listen_port
}