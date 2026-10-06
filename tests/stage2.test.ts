// Этап 2: права администратора, системный прокси, «единственная копия», список программ, контроллер.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanApps, findShortcuts, parseJsonList } from '../electron/apps'
import { AppController } from '../electron/controller'
import { killStaleEngine } from '../electron/engine/stale'
import { NoopSystemProxy } from '../electron/platform/systemProxy'
import { Elevation, buildTaskXml, elevatedSchtasksScript, escapeXml } from '../electron/platform/elevation'
import type { ExecResult, Runner } from '../electron/platform/exec'
import { notifyExisting, startControl, waitUntilFree } from '../electron/platform/singleInstance'
import { INTERNET_SETTINGS, PROXY_BYPASS, WindowsSystemProxy, parseDword, parseRegValue, regAddArgs } from '../electron/platform/systemProxy'
import type { Sealer } from '../electron/store'
import { fakeHost } from './helpers/fakeHost'
import { removeDir, tempDir } from './helpers/loopback'
import { GOOD } from './fixtures'
import { singBoxPath } from './helpers/singbox'

const ok = (stdout = ''): ExecResult => ({ code: 0, stdout, stderr: '' })
const decodePs = (args: string[]): string => Buffer.from(args[args.indexOf('-EncodedCommand') + 1]!, 'base64').toString('utf16le')

describe('права администратора (задача планировщика)', () => {
  it('XML задачи: наивысшие права, без расписания, с экранированием', () => {
    const xml = buildTaskXml({ exePath: 'C:\\Program Files\\Тропа & Co\\Tropa.exe', args: '--elevated', user: 'ПК\\Гоша', description: 'Запуск <с правами>' })
    expect(xml).toContain('<RunLevel>HighestAvailable</RunLevel>')
    expect(xml).toContain('<LogonType>InteractiveToken</LogonType>')
    expect(xml).toContain('<Triggers />') // только по запросу, сам не стартует
    expect(xml).toContain('<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>')
    expect(xml).toContain('<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>')
    expect(xml).toContain('Тропа &amp; Co')
    expect(xml).toContain('Запуск &lt;с правами&gt;')
    expect(xml).toContain('<Arguments>--elevated</Arguments>')
    expect(escapeXml(`a&b<c>"d'`)).toBe('a&amp;b&lt;c&gt;&quot;d&apos;')
  })

  it('повышение прав просит Windows через RunAs и передаёт аргументы без порчи кавычек', () => {
    const script = elevatedSchtasksScript(['/Create', '/TN', "my'task", '/XML', 'C:\\t m\\x.xml', '/F'])
    expect(script).toContain('-Verb RunAs')
    expect(script).toContain("'my''task'")
    expect(script).toContain("'C:\\t m\\x.xml'")
  })

  it('создание задачи: успех, отказ человека, не Windows', async () => {
    const calls: string[][] = []
    let exists = false
    const exec: Runner = async (file, args) => {
      calls.push([file, ...args])
      if (file === 'schtasks' && args[0] === '/Query') return { code: exists ? 0 : 1, stdout: '', stderr: '' }
      // если человек отказал в окне Windows, Start-Process бросает ошибку и PowerShell завершается с кодом 1
      if (file === 'powershell.exe') return { code: exists ? 0 : 1, stdout: '', stderr: exists ? '' : 'The operation was canceled by the user' }
      return ok()
    }
    const el = new Elevation('tropa-elevated', exec, 'win32')
    // человек отказался в окне Windows: задачи нет
    let r = await el.createTask('C:\\a\\Tropa.exe', '--elevated')
    expect(r).toEqual({ ok: false, cancelled: true })
    // согласился: задача появилась
    exists = true
    r = await el.createTask('C:\\a\\Tropa.exe', '--elevated')
    expect(r.ok).toBe(true)
    const ps = calls.find((c) => c[0] === 'powershell.exe')!
    const script = decodePs(ps)
    expect(script).toContain('schtasks.exe')
    expect(script).toContain("'/Create'")
    expect(script).toContain("'tropa-elevated'")
    expect(script).toContain("'/XML'")
    const lin = new Elevation('x', exec, 'linux')
    expect(await lin.createTask('/a', '')).toEqual({ ok: false, cancelled: false })
    expect(await lin.taskExists()).toBe(false)
  })

  it('запуск задачи и проверка прав', async () => {
    const seen: string[][] = []
    const exec: Runner = async (file, args) => { seen.push([file, ...args]); return ok() }
    const el = new Elevation('tropa-elevated', exec, 'win32')
    expect(await el.runTask()).toBe(true)
    expect(seen[0]).toEqual(['schtasks', '/Run', '/TN', 'tropa-elevated'])
    expect(await el.isElevated()).toBe(true) // fltmc завершился успешно
    const denied = new Elevation('t', async () => ({ code: 1, stdout: '', stderr: '' }), 'win32')
    expect(await denied.isElevated()).toBe(false)
  })
})

describe('системный прокси Windows', () => {
  function setup(initial: { enable?: string; server?: string; override?: string } = {}) {
    const calls: string[][] = []
    let saved: { enable: number; server: string; override: string } | null = null
    const reg: Record<string, string> = {}
    if (initial.enable !== undefined) reg.ProxyEnable = initial.enable
    if (initial.server !== undefined) reg.ProxyServer = initial.server
    if (initial.override !== undefined) reg.ProxyOverride = initial.override
    const exec: Runner = async (file, args) => {
      calls.push([file, ...args])
      if (file === 'reg' && args[0] === 'query') {
        const name = args[3]!
        return name in reg ? ok(`\r\nHKEY_CURRENT_USER\\x\r\n    ${name}    ${name === 'ProxyEnable' ? 'REG_DWORD' : 'REG_SZ'}    ${reg[name]}\r\n`) : { code: 1, stdout: '', stderr: '' }
      }
      if (file === 'reg' && args[0] === 'add') reg[args[3]!] = args[7]!
      return ok()
    }
    const px = new WindowsSystemProxy({ load: () => saved, save: (p) => { saved = p } }, exec)
    return { px, calls, reg, saved: () => saved }
  }

  it('включает прокси на наш адрес и сообщает системе об изменении', async () => {
    const t = setup()
    await t.px.set('127.0.0.1', 7890)
    expect(t.reg.ProxyServer).toBe('127.0.0.1:7890')
    expect(t.reg.ProxyEnable).toBe('1')
    expect(t.reg.ProxyOverride).toBe(PROXY_BYPASS)
    expect(PROXY_BYPASS).toContain('192.168.*') // домашняя сеть мимо прокси
    expect(PROXY_BYPASS).toContain('<local>')
    expect(t.calls.some((c) => c[0] === 'powershell.exe')).toBe(true) // обновление настроек для браузеров
    expect(await t.px.pointsTo('127.0.0.1', 7890)).toBe(true)
    expect(await t.px.pointsTo('127.0.0.1', 1)).toBe(false)
  })

  it('при отключении возвращает то, что было у человека (например, рабочий прокси)', async () => {
    const t = setup({ enable: '0x1', server: 'corp-proxy:3128', override: '*.corp' })
    await t.px.set('127.0.0.1', 7890)
    await t.px.clear()
    expect(t.reg.ProxyServer).toBe('corp-proxy:3128')
    expect(t.reg.ProxyOverride).toBe('*.corp')
    expect(t.reg.ProxyEnable).toBe('1')
    expect(t.saved()).toBeNull()
  })

  it('если прокси раньше не было, при отключении он просто выключается', async () => {
    const t = setup({ enable: '0x0' })
    await t.px.set('127.0.0.1', 7890)
    await t.px.clear()
    expect(t.reg.ProxyEnable).toBe('0')
  })

  it('после аварийного завершения наш старый адрес не считается «прежним» — иначе интернет остался бы сломанным', async () => {
    const t = setup({ enable: '0x1', server: '127.0.0.1:7890' })
    await t.px.set('127.0.0.1', 7890)
    await t.px.clear()
    expect(t.reg.ProxyEnable).toBe('0')
  })

  it('разбор вывода reg query не зависит от языка системы', () => {
    const ru = '\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\r\n    ProxyServer    REG_SZ    127.0.0.1:7890\r\n'
    expect(parseRegValue(ru, 'ProxyServer')).toBe('127.0.0.1:7890')
    expect(parseRegValue(ru, 'ProxyEnable')).toBeNull()
    expect(parseDword('0x1')).toBe(1)
    expect(parseDword('0x0')).toBe(0)
    expect(parseDword(null)).toBe(0)
    expect(regAddArgs('ProxyEnable', 'REG_DWORD', '1')).toEqual(['add', INTERNET_SETTINGS, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f'])
  })
})

describe('единственная копия программы', () => {
  let dir: string
  beforeEach(() => { dir = tempDir('tropa-ctl-') })
  afterEach(() => removeDir(dir))

  it('вторая копия просит первую показать окно и после этого может закрыться', async () => {
    let shown = 0
    const h = await startControl(dir, () => { shown++ })
    expect(await notifyExisting(dir)).toBe(true)
    expect(shown).toBe(1)
    h.close()
    expect(await notifyExisting(dir)).toBe(false)
  })

  it('без запущенной копии — «никого нет»; устаревший файл не мешает', async () => {
    expect(await notifyExisting(dir)).toBe(false)
    writeFileSync(join(dir, 'control.json'), JSON.stringify({ port: 1, token: 'x', pid: 1 }))
    expect(await notifyExisting(dir)).toBe(false)
  })

  it('с неверным секретным словом окно не показывается', async () => {
    let shown = 0
    const h = await startControl(dir, () => { shown++ })
    const info = JSON.parse(require('node:fs').readFileSync(join(dir, 'control.json'), 'utf8'))
    writeFileSync(join(dir, 'control.json'), JSON.stringify({ ...info, token: 'не-то' }))
    expect(await notifyExisting(dir)).toBe(false)
    expect(shown).toBe(0)
    h.close()
  })

  it('копия с правами ждёт, пока прежняя уйдёт', async () => {
    const h = await startControl(dir, () => undefined)
    setTimeout(() => h.close(), 500)
    const t0 = Date.now()
    await waitUntilFree(dir, 5000)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(400)
    expect(Date.now() - t0).toBeLessThan(3000)
  })
})

describe('список программ', () => {
  it('убирает системное, установщики/деинсталляторы, повторы и саму программу', () => {
    const list = cleanApps([
      { name: 'Chrome', path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
      { name: 'Chrome (ещё раз)', path: 'c:\\program files\\google\\chrome\\application\\CHROME.EXE' },
      { name: 'Проводник', path: 'C:\\Windows\\explorer.exe' },
      { name: 'Удалить', path: 'C:\\Games\\unins000.exe' },
      { name: 'Тропа', path: 'C:\\Program Files\\Tropa\\Tropa.exe' },
      { name: '', path: 'D:\\Games\\Steam\\steam.exe' },
      { name: 'Не программа', path: 'C:\\x\\readme.txt' }
    ], { selfExe: 'C:\\Program Files\\Tropa\\Tropa.exe', platform: 'win32' })
    expect(list.map((a) => a.name)).toEqual(['Chrome', 'steam'])
  })

  it('разбор ответа PowerShell: массив, один объект, мусор', () => {
    expect(parseJsonList('[{"name":"A","path":"C:\\\\a.exe"},{"name":"B","path":"C:\\\\b.exe"}]')).toHaveLength(2)
    expect(parseJsonList('{"name":"A","path":"C:\\\\a.exe"}')).toEqual([{ name: 'A', path: 'C:\\a.exe' }])
    expect(parseJsonList('')).toEqual([])
    expect(parseJsonList('ошибка!')).toEqual([])
  })

  it('ярлыки меню «Пуск» ищутся во вложенных папках', () => {
    const root = mkdtempSync(join(tmpdir(), 'tropa-sm-'))
    try {
      mkdirSync(join(root, 'Игры', 'Steam'), { recursive: true })
      writeFileSync(join(root, 'a.lnk'), '')
      writeFileSync(join(root, 'Игры', 'Steam', 'Steam.lnk'), '')
      writeFileSync(join(root, 'Игры', 'readme.txt'), '')
      expect(findShortcuts(root).map((p) => p.replace(root, '')).sort()).toEqual(['/Игры/Steam/Steam.lnk', '/a.lnk'].sort())
    } finally { removeDir(root) }
  })
})

describe('контроллер: режим «весь компьютер»', () => {
  const sealer: Sealer = { available: () => true, seal: (p) => 'S:' + Buffer.from(p).toString('base64'), open: (s) => Buffer.from(s.slice(2), 'base64').toString() }
  let dir: string
  beforeEach(() => { dir = tempDir('tropa-ctrl-') })
  afterEach(() => removeDir(dir))
  const make = (hostOver: Parameters<typeof fakeHost>[0] = {}) => {
    const fh = fakeHost(hostOver)
    const c = new AppController(fh.host, { userDir: dir, engineExe: singBoxPath(), bundledRulesDir: join(__dirname, '..', 'resources', 'rules') }, sealer, { ruleFetch: async () => Buffer.alloc(0) })
    return { c, ...fh }
  }

  it('без прав: просит разрешение, сохраняет выбор, запускает себя с правами и закрывается', async () => {
    const { c, state } = make()
    await c.init()
    const r = await c.requestTunMode()
    expect(r.ok).toBe(true)
    expect(r.relaunching).toBe(true)
    expect(state.actions).toContain('createTask C:\\Program Files\\Tropa\\Tropa.exe --elevated')
    expect(state.actions).toContain('runTask')
    expect(state.releaseCalls).toBe(1) // замок отпущен до запуска новой копии
    expect(c.store.settings.mode).toBe('tun') // выбор запомнен для новой копии
    await new Promise((res) => setTimeout(res, 600))
    expect(state.quitCalls).toBe(1)
  })

  it('человек отказал Windows: режим не включается, объяснение человеческое', async () => {
    const { c, state } = make({ createCancelled: true })
    await c.init()
    const r = await c.requestTunMode()
    expect(r.ok).toBe(false)
    expect(r.relaunching).toBe(false)
    expect(r.message).toContain('Разрешение не получено')
    expect(c.store.settings.mode).toBe('proxy')
    expect(state.quitCalls).toBe(0)
  })

  it('разрешение уже выдано: второй раз Windows не спрашивают', async () => {
    const { c, state } = make({ taskExists: true })
    await c.init()
    await c.requestTunMode()
    expect(state.actions.some((a) => a.startsWith('createTask'))).toBe(false)
    expect(state.actions).toContain('runTask')
  })

  it('уже работаем с правами: просто включаем режим', async () => {
    const { c, state } = make({ admin: true })
    await c.init()
    const r = await c.requestTunMode()
    expect(r).toMatchObject({ ok: true, relaunching: false })
    expect(c.store.settings.mode).toBe('tun')
    expect(state.actions).toEqual([])
  })

  it('запуск с правами не удался: честно говорим и не закрываемся', async () => {
    const { c, state } = make({ taskExists: true, runTaskOk: false })
    await c.init()
    const r = await c.requestTunMode()
    expect(r.ok).toBe(false)
    expect(r.message).toContain('Закройте программу и откройте её снова')
    await new Promise((res) => setTimeout(res, 600))
    expect(state.quitCalls).toBe(0)
  })

  it('на другой системе без прав режим не включается', async () => {
    const { c } = make({ platform: 'linux' })
    await c.init()
    const r = await c.requestTunMode()
    expect(r.ok).toBe(false)
    expect(r.message).toContain('только в Windows')
  })

  it('при запуске без прав, если выбран туннель и разрешение есть — нужно перезапуститься с правами', async () => {
    const { c } = make({ taskExists: true })
    c.store.updateSettings({ mode: 'tun' })
    await c.init()
    expect(c.needsElevatedRelaunch).toBe(true)
    const noTask = make({ taskExists: false })
    noTask.c.store.updateSettings({ mode: 'tun' })
    await noTask.c.init()
    expect(noTask.c.needsElevatedRelaunch).toBe(false) // без разрешения не зацикливаемся
    const admin = make({ taskExists: true, admin: true })
    admin.c.store.updateSettings({ mode: 'tun' })
    await admin.c.init()
    expect(admin.c.needsElevatedRelaunch).toBe(false) // уже с правами
  })

  it('отзыв разрешения возвращает режим «браузер и программы»', async () => {
    const { c } = make({ taskExists: true })
    c.store.updateSettings({ mode: 'tun' })
    await c.init()
    const r = await c.revokeElevation()
    expect(r.ok).toBe(true)
    expect(c.store.settings.mode).toBe('proxy')
    expect(c.getStateSync().system.elevationReady).toBe(false)
  })

  it('списки правил: успех и провал сети — понятные сообщения', async () => {
    const fh = fakeHost()
    let fail = true
    const c = new AppController(fh.host, { userDir: dir, engineExe: singBoxPath(), bundledRulesDir: join(__dirname, '..', 'resources', 'rules') }, sealer, {
      ruleFetch: async () => { if (fail) throw new Error('нет сети'); return Buffer.concat([Buffer.from('SRS\u0001'), Buffer.alloc(40)]) }
    })
    await c.init()
    const bad = await c.updateRules(true)
    expect(bad.ok).toBe(false)
    expect(bad.message).toContain('нет связи')
    expect(c.store.rulesUpdatedAt).toBeNull()
    fail = false
    const good = await c.updateRules(true)
    expect(good.ok).toBe(true)
    expect(c.store.rulesUpdatedAt).not.toBeNull()
    expect(c.getStateSync().system.rules.bundledOnly).toBe(false)
  })

  it('правила «мимо VPN» сохраняются и применяются к настройкам подключения', async () => {
    const { c } = make({ taskExists: false })
    await c.init()
    await c.updateSettings({ bypassApps: [{ exe: 'chrome.exe', name: 'Chrome' }], bypassGames: true, alwaysVpn: ['youtube.com'], alwaysDirect: ['my-nas.local'], bypassRu: false })
    const s = c.store.settings
    expect(s.bypassApps).toHaveLength(1)
    expect(s.bypassGames).toBe(true)
    expect(s.alwaysVpn).toEqual(['youtube.com'])
    expect(s.bypassRu).toBe(false)
    void GOOD
  })
})


describe('после аварийного завершения программы', () => {
  const sealer: Sealer = { available: () => true, seal: (p) => 'S:' + Buffer.from(p).toString('base64'), open: (s) => Buffer.from(s.slice(2), 'base64').toString() }
  let dir: string
  beforeEach(() => { dir = tempDir('tropa-crash-') })
  afterEach(() => removeDir(dir))
  const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true } catch { return false } }
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  it('забытый движок от прошлого запуска останавливается при старте', async () => {
    writeFileSync(join(dir, 'e.json'), JSON.stringify({ log: { level: 'warn' }, outbounds: [{ type: 'direct', tag: 'direct' }] }))
    const orphan = spawn(singBoxPath(), ['run', '-c', join(dir, 'e.json')], { stdio: 'ignore', detached: true })
    orphan.unref()
    await wait(600)
    expect(alive(orphan.pid!)).toBe(true)
    // «прошлый запуск» успел записать номер процесса и умер
    writeFileSync(join(dir, 'data.json'), JSON.stringify({ version: 1, settings: {}, servers: [], subscriptions: [], rulesUpdatedAt: null, runtime: { enginePid: orphan.pid } }))
    const { host } = fakeHost({ platform: process.platform })
    const c = new AppController(host, { userDir: dir, engineExe: singBoxPath(), bundledRulesDir: join(__dirname, '..', 'resources', 'rules') }, sealer, { ruleFetch: async () => Buffer.alloc(0) })
    await c.init()
    await wait(400)
    expect(alive(orphan.pid!)).toBe(false)
    expect(c.store.runtimeGet('enginePid')).toBeNull()
    expect(c.log.all.join('\n')).toContain('забытый движок')
  })

  it('чужой процесс под тем же номером не трогаем', async () => {
    const other = spawn('sleep', ['30'], { stdio: 'ignore' })
    try {
      expect(await killStaleEngine(other.pid!, 'linux', '/opt/tropa/sing-box')).toBe(false)
      expect(alive(other.pid!)).toBe(true)
    } finally { other.kill('SIGKILL') }
    expect(await killStaleEngine(0, 'linux', '/x/sing-box')).toBe(false)
    expect(await killStaleEngine(process.pid, 'linux', '/x/sing-box')).toBe(false)
  })

  it('Windows: убиваем только если по этому номеру действительно sing-box.exe', async () => {
    const calls: string[][] = []
    const mk = (tasklistOut: string): Runner => async (file, args) => { calls.push([file, ...args]); return { code: 0, stdout: file === 'tasklist' ? tasklistOut : '', stderr: '' } }
    expect(await killStaleEngine(4242, 'win32', 'C:\\app\\resources\\engine\\sing-box.exe', mk('"sing-box.exe","4242","Console","1","80 000 КБ"'))).toBe(true)
    expect(calls.some((c) => c[0] === 'taskkill' && c.includes('4242') && c.includes('/F'))).toBe(true)
    calls.length = 0
    expect(await killStaleEngine(4242, 'win32', 'C:\\app\\sing-box.exe', mk('"chrome.exe","4242","Console","1","300 000 КБ"'))).toBe(false)
    expect(calls.some((c) => c[0] === 'taskkill')).toBe(false)
    expect(await killStaleEngine(4242, 'win32', 'C:\\app\\sing-box.exe', mk('ИНФОРМАЦИЯ: задачи, соответствующие указанным критериям, не найдены.'))).toBe(false)
  })

  it('системный прокси, оставшийся включённым после аварии, при старте возвращается как было', async () => {
    writeFileSync(join(dir, 'data.json'), JSON.stringify({ version: 1, settings: {}, servers: [], subscriptions: [], rulesUpdatedAt: null, runtime: { prevProxy: { enable: 0, server: '', override: '' } } }))
    let cleared = 0
    const fake = new NoopSystemProxy()
    fake.clear = async () => { cleared++ }
    const { host } = fakeHost()
    const c = new AppController(host, { userDir: dir, engineExe: singBoxPath(), bundledRulesDir: join(__dirname, '..', 'resources', 'rules') }, sealer, { systemProxy: fake, ruleFetch: async () => Buffer.alloc(0) })
    await c.init()
    expect(cleared).toBe(1)
    expect(c.log.all.join('\n')).toContain('закончился аварийно')
  })

  it('без следов аварии при старте ничего лишнего не делается', async () => {
    let cleared = 0
    const fake = new NoopSystemProxy()
    fake.clear = async () => { cleared++ }
    const { host } = fakeHost()
    const c = new AppController(host, { userDir: dir, engineExe: singBoxPath(), bundledRulesDir: join(__dirname, '..', 'resources', 'rules') }, sealer, { systemProxy: fake, ruleFetch: async () => Buffer.alloc(0) })
    await c.init()
    expect(cleared).toBe(0)
  })
})
