// Точка входа приложения: окно, шифрование системой, связь окна с контроллером.
import { app, BrowserWindow, clipboard, ipcMain, Notification, safeStorage, shell, nativeTheme } from 'electron'
import { join } from 'node:path'
import brand from '../brand.json'
import { IPC, INVOKABLE } from '../shared/api'
import { AppController, type Host } from './controller'
import { Elevation } from './platform/elevation'
import type { Sealer } from './store'

// Название задаётся в одном месте — brand.json. Папку данных привязываем к неизменному id,
// чтобы смена названия не «теряла» настройки и ключи.
app.setName(brand.name)
const isDev = !app.isPackaged
// Только для разработки и автотестов (в собранной программе эти переменные игнорируются):
// своя папка данных, чтобы тесты не трогали настоящие настройки.
app.setPath('userData', isDev && process.env.TROPA_USER_DATA ? process.env.TROPA_USER_DATA : join(app.getPath('appData'), brand.id))

const startedHidden = process.argv.includes('--hidden')

// Предохранитель: непредвиденная ошибка не должна показывать системное окно с ошибкой и замораживать программу.
// Ошибка записывается в журнал (без секретов), а программа продолжает работать.
process.on('uncaughtException', (e) => {
  try { controller?.log.add(`Непредвиденная ошибка: ${e instanceof Error ? e.message : String(e)}`) } catch { /* ничего */ }
})
process.on('unhandledRejection', (e) => {
  try { controller?.log.add(`Непредвиденная ошибка (обещание): ${e instanceof Error ? e.message : String(e)}`) } catch { /* ничего */ }
})

let win: BrowserWindow | null = null
let controller: AppController | null = null
let quitting = false
/** Появится вместе с трей-значком (этап 4). Пока значка нет — крестик закрывает программу. */
let trayReady = false

const sealer: Sealer = {
  available: () => safeStorage.isEncryptionAvailable(),
  seal: (plain) => safeStorage.encryptString(plain).toString('base64'),
  open: (sealed) => safeStorage.decryptString(Buffer.from(sealed, 'base64'))
}

function enginePath(): string {
  const exe = process.platform === 'win32' ? 'sing-box.exe' : 'sing-box'
  if (app.isPackaged) return join(process.resourcesPath, 'engine', exe)
  return join(__dirname, '..', 'bin', `${process.platform}-${process.arch}`, exe)
}

function bundledRulesPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'rules') : join(__dirname, '..', 'resources', 'rules')
}

function iconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '..', 'resources', 'icon.png')
}

const elevation = new Elevation(`${brand.id}-elevated`)

const host: Host = {
  platform: process.platform,
  appVersion: app.getVersion(),
  readClipboard: () => clipboard.readText(),
  notify: (title, body) => {
    // Программа для Windows. На Linux (только для разработки) без службы уведомлений показ может навсегда «заморозить» программу — там уведомлений нет.
    if (process.platform !== 'win32') return
    // Показываем отложенно, чтобы окно успело получить новое состояние раньше.
    setTimeout(() => {
      try {
        if (Notification.isSupported()) new Notification({ title, body, silent: true }).show()
      } catch { /* уведомление — не главное */ }
    }, 50)
  },
  windowAction: (action) => {
    if (!win) return
    if (action === 'minimize') win.minimize()
    else if (action === 'close') win.close()
    else win.hide()
  },
  quit: () => {
    quitting = true
    app.quit()
  },
  isAdmin: () => elevation.isElevated()
}

function createWindow(): BrowserWindow {
  const dark = nativeTheme.shouldUseDarkColors
  const w = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 880,
    minHeight: 620,
    show: false,
    backgroundColor: dark ? '#0b1020' : '#eef3fb',
    title: brand.name,
    icon: iconPath(),
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'win32' ? 'hidden' : 'default',
    titleBarOverlay: process.platform === 'win32' ? { color: '#00000000', symbolColor: dark ? '#cfd6ee' : '#2b3350', height: 40 } : false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: isDev
    }
  })
  w.removeMenu()

  // окно показывает только своё содержимое: никаких переходов и всплывающих окон
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  w.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://') && !(isDev && url.startsWith(process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173'))) e.preventDefault()
  })

  w.once('ready-to-show', () => {
    if (!startedHidden) w.show()
  })
  w.on('close', (e) => {
    if (quitting) return
    const settings = controller?.store.settings
    // «Свернуть в трей» только когда значок в трее реально есть, иначе окно пропало бы без возможности вернуть его
    if (trayReady && settings?.closeToTray && process.platform === 'win32') {
      e.preventDefault()
      w.hide()
    } else {
      e.preventDefault()
      void controller?.quit()
    }
  })

  if (isDev && process.env.VITE_DEV_SERVER_URL) void w.loadURL(process.env.VITE_DEV_SERVER_URL)
  else void w.loadFile(join(__dirname, '..', 'dist', 'index.html'))
  return w
}

function registerIpc(c: AppController): void {
  const allowed = new Set<string>(INVOKABLE)
  ipcMain.handle(IPC.invoke, async (event, method: string, ...args: unknown[]) => {
    // принимаем команды только от нашего окна
    if (!win || event.sender !== win.webContents) throw new Error('forbidden')
    if (!allowed.has(method)) throw new Error(`unknown method ${method}`)
    const fn = (c as unknown as Record<string, (...a: unknown[]) => unknown>)[method]
    if (typeof fn !== 'function') throw new Error(`unknown method ${method}`)
    return fn.apply(c, args)
  })
  c.onState((s) => win?.webContents.send(IPC.state, s))
  c.onStats((s) => win?.webContents.send(IPC.stats, s))
  c.onToast((t) => win?.webContents.send(IPC.toast, t))
  c.onNavigate((p) => win?.webContents.send(IPC.navigate, p))
}

// Одна копия программы: вторая просто показывает окно первой.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  void app.whenReady().then(async () => {
    controller = new AppController(
      host,
      { userDir: app.getPath('userData'), engineExe: enginePath(), bundledRulesDir: bundledRulesPath() },
      sealer
    )
    await controller.init()
    registerIpc(controller)
    win = createWindow()
    app.on('activate', () => win?.show())
  })

  app.on('before-quit', (e) => {
    if (quitting && controller) {
      // даём движку и системным настройкам спокойно вернуться в исходное состояние
      const c = controller
      controller = null
      e.preventDefault()
      void c.shutdown().finally(() => {
        quitting = true
        app.exit(0)
      })
    } else {
      quitting = true
    }
  })

  app.on('window-all-closed', () => {
    /* приложение живёт в трее; выход — явной командой */
  })
}

void shell
void trayReady
