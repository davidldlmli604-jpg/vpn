// Тестовый «бэкенд» — ТОЛЬКО для просмотра оформления в обычном браузере (npm run ui).
// В настоящем приложении не используется: там окно общается с настоящим движком.
import type { ToastMessage, VpnApi } from '@shared/api'
import { DEFAULT_SETTINGS, mergeSettings } from '@shared/defaults'
import type { AddResult, AppState, RunningApp, ServerView, Settings, StatsSample } from '@shared/types'

const q = new URLSearchParams(location.search)

const SAMPLE: Array<[string, string, string, string]> = [
  ['Нидерланды · Амстердам', 'nl', 'vless', 'nl-1.example.net'],
  ['Германия · Франкфурт', 'de', 'vless', 'de-2.example.net'],
  ['Финляндия · Хельсинки', 'fi', 'hysteria2', 'fi-1.example.net'],
  ['США · Нью-Йорк', 'us', 'trojan', 'us-3.example.net'],
  ['Япония · Токио', 'jp', 'tuic', 'jp-1.example.net'],
  ['Турция · Стамбул', 'tr', 'vmess', 'tr-1.example.net']
]

function sampleApps(...rows: Array<[string, string]>): RunningApp[] {
  return rows.map(([name, exe]) => ({ name, exe, path: `C:\\Program Files\\${name}\\${exe}`, icon: null }))
}

export function createMockApi(): VpnApi {
  let settings: Settings = mergeSettings({
    ...DEFAULT_SETTINGS,
    wizardDone: true,
    theme: (q.get('theme') as Settings['theme']) ?? 'dark',
    palette: (q.get('palette') as Settings['palette']) ?? 'aurora',
    mode: (q.get('mode') as Settings['mode']) ?? 'proxy',
    motion: (q.get('motion') as Settings['motion']) ?? 'full'
  })
  const empty = q.get('empty') === '1'
  const servers: ServerView[] = empty
    ? []
    : SAMPLE.map(([name, cc, protocol, host], i) => ({
        id: `s${i + 1}`, name, protocol, host, port: 443, countryCode: cc, favorite: i === 0 || i === 2, subscriptionId: null,
        latency: i === 5 ? { error: 'нет ответа' } : { ms: [38, 61, 74, 142, 233, 0][i]! }, canQr: i !== 3, warnings: [], addedAt: Date.now() - i * 86400000
      }))
  if (!empty) settings = { ...settings, selectedServerId: 's1' }

  let app: AppState = {
    conn: { status: 'off', error: null, serverId: null, since: null, reconnect: null, degraded: false, mode: null },
    exit: { checking: false, countryCode: null, countryName: null, ip: null, error: null },
    servers,
    subscriptions: [],
    settings,
    system: {
      platform: 'win32', appVersion: '0.1.0', isAdmin: false, elevationReady: false,
      singbox: { found: true, version: '1.14.2', path: 'engine/sing-box.exe' }, secureStorage: true,
      rules: { updatedAt: null, count: 31, updating: false, bundledOnly: true }, startedHidden: false, killSwitchActive: false
    }
  }

  const stateCbs: Array<(s: AppState) => void> = []
  const statsCbs: Array<(s: StatsSample) => void> = []
  const toastCbs: Array<(t: ToastMessage) => void> = []
  const navCbs: Array<(p: string) => void> = []
  const emit = (): void => stateCbs.forEach((cb) => cb(app))
  const toast = (kind: ToastMessage['kind'], text: string): void => toastCbs.forEach((cb) => cb({ id: Math.random().toString(36).slice(2), kind, text }))
  let timer: ReturnType<typeof setInterval> | null = null
  let upTotal = 0
  let downTotal = 0
  let phase = 0

  function startStats(): void {
    if (timer) clearInterval(timer)
    phase = 0
    const tick = (): void => {
      phase += 1
      const wave = 0.55 + 0.45 * Math.sin(phase / 5) * Math.cos(phase / 11)
      const burst = Math.random() < 0.08 ? 3 + Math.random() * 4 : 1
      const down = Math.max(20_000, (900_000 + 5_500_000 * wave * wave) * burst * (0.8 + Math.random() * 0.4))
      const up = Math.max(5_000, down * (0.06 + Math.random() * 0.05))
      downTotal += down
      upTotal += up
      statsCbs.forEach((cb) => cb({ t: Date.now(), upBps: up, downBps: down, upTotal, downTotal, latencyMs: 38 + Math.round(Math.random() * 14) }))
    }
    timer = setInterval(tick, 1000)
    for (let i = 0; i < 40; i++) tick()
  }

  function setConn(patch: Partial<AppState['conn']>): void {
    app = { ...app, conn: { ...app.conn, ...patch } }
    emit()
  }

  async function connect(id?: string): Promise<void> {
    const sid = id ?? app.settings.selectedServerId
    if (!sid) { setConn({ status: 'error', error: { code: 'no-server', title: 'Сначала добавьте ключ', text: 'Нажмите «Вставить ключ», чтобы добавить сервер.' } }); return }
    setConn({ status: 'connecting', error: null, serverId: sid, mode: app.settings.mode })
    await new Promise((r) => setTimeout(r, 2200))
    if (q.get('fail') === '1') {
      setConn({ status: 'error', error: { code: 'server-silent', title: 'Сервер не отвечает', text: 'Возможно, ключ устарел или введён с ошибкой. Если ключ точно рабочий, попробуйте другой сервер из списка или повторите позже.' } })
      return
    }
    setConn({ status: 'on', since: Date.now() - (q.get('uptime') ? Number(q.get('uptime')) * 1000 : 0) })
    app = { ...app, exit: { ...app.exit, checking: true } }
    emit()
    startStats()
    setTimeout(() => {
      const s = app.servers.find((x) => x.id === sid)
      app = { ...app, exit: { checking: false, countryCode: s?.countryCode ?? 'nl', countryName: s?.name.split(' · ')[0] ?? 'Нидерланды', ip: '203.0.113.7', error: null } }
      emit()
    }, 1200)
  }

  async function disconnect(): Promise<void> {
    setConn({ status: 'disconnecting' })
    await new Promise((r) => setTimeout(r, 500))
    if (timer) clearInterval(timer)
    app = { ...app, exit: { checking: false, countryCode: null, countryName: null, ip: null, error: null } }
    setConn({ status: 'off', since: null, error: null })
  }

  const api: VpnApi = {
    getState: async () => app,
    onState: (cb) => { stateCbs.push(cb); return () => stateCbs.splice(stateCbs.indexOf(cb), 1) && undefined },
    onStats: (cb) => { statsCbs.push(cb); return () => statsCbs.splice(statsCbs.indexOf(cb), 1) && undefined },
    onToast: (cb) => { toastCbs.push(cb); return () => toastCbs.splice(toastCbs.indexOf(cb), 1) && undefined },
    onNavigate: (cb) => { navCbs.push(cb); return () => navCbs.splice(navCbs.indexOf(cb), 1) && undefined },

    pasteKey: async (): Promise<AddResult> => {
      const n = app.servers.length + 1
      const s: ServerView = { id: `s${Date.now()}`, name: `Новый сервер ${n}`, protocol: 'vless', host: 'new.example.net', port: 443, countryCode: 'se', favorite: false, subscriptionId: null, latency: null, canQr: true, warnings: [], addedAt: Date.now() }
      app = { ...app, servers: [...app.servers, s], settings: { ...app.settings, selectedServerId: app.settings.selectedServerId ?? s.id } }
      emit()
      return { ok: true, added: 1, kind: 'servers', message: `Ключ добавлен: ${s.name}`, skipped: [], firstId: s.id }
    },
    addKeyText: async () => ({ ok: false, added: 0, kind: 'error', message: 'В режиме просмотра ключи не добавляются.', skipped: [], firstId: null }),
    selectServer: async (id) => { app = { ...app, settings: { ...app.settings, selectedServerId: id } }; emit() },
    renameServer: async (id, name) => { app = { ...app, servers: app.servers.map((s) => (s.id === id ? { ...s, name } : s)) }; emit() },
    removeServer: async (id) => { app = { ...app, servers: app.servers.filter((s) => s.id !== id) }; emit() },
    toggleFavorite: async (id) => { app = { ...app, servers: app.servers.map((s) => (s.id === id ? { ...s, favorite: !s.favorite } : s)) }; emit() },

    connect: (id) => connect(id),
    disconnect: () => disconnect(),

    updateSettings: async (patch) => { app = { ...app, settings: mergeSettings({ ...app.settings, ...patch }) }; emit(); if (patch.mode) toast('success', 'Настройки применены') },
    updateAdvanced: async (patch) => { app = { ...app, settings: mergeSettings({ ...app.settings, advanced: { ...app.settings.advanced, ...patch } }) }; emit() },

    requestTunMode: async () => {
      await new Promise((r) => setTimeout(r, 900))
      app = { ...app, settings: { ...app.settings, mode: 'tun' }, system: { ...app.system, isAdmin: true, elevationReady: true } }
      emit()
      toast('success', 'Режим «Весь компьютер» включён.')
      return { ok: true, message: 'Режим «Весь компьютер» включён.', relaunching: false }
    },
    revokeElevation: async () => {
      app = { ...app, settings: { ...app.settings, mode: 'proxy' }, system: { ...app.system, isAdmin: false, elevationReady: false } }
      emit()
      return { ok: true, message: 'Разрешение отозвано.' }
    },
    listRunningApps: async () => sampleApps(['Google Chrome', 'chrome.exe'], ['Steam', 'steam.exe'], ['Discord', 'Discord.exe'], ['Telegram Desktop', 'Telegram.exe'], ['Яндекс Музыка', 'YandexMusic.exe'], ['Spotify', 'Spotify.exe']),
    listInstalledApps: async () => sampleApps(['Epic Games Launcher', 'EpicGamesLauncher.exe'], ['Battle.net', 'Battle.net.exe'], ['Mozilla Firefox', 'firefox.exe'], ['OBS Studio', 'obs64.exe'], ['qBittorrent', 'qbittorrent.exe']),
    updateRules: async () => {
      app = { ...app, system: { ...app.system, rules: { ...app.system.rules, updating: true } } }
      emit()
      await new Promise((r) => setTimeout(r, 1500))
      app = { ...app, system: { ...app.system, rules: { updatedAt: Date.now(), count: 31, updating: false, bundledOnly: false } } }
      emit()
      toast('success', 'Списки обновлены. Применятся при следующем подключении.')
      return { ok: true, message: 'Списки обновлены.' }
    },

    windowAction: async () => undefined,
    quit: async () => undefined
  }

  // сцены для скриншотов: ?scene=on / connecting / error
  const scene = q.get('scene')
  if (scene === 'on') void connect('s1')
  if (scene === 'connecting') { app = { ...app, conn: { ...app.conn, status: 'connecting', serverId: 's1', mode: settings.mode } } }
  if (scene === 'error') { app = { ...app, conn: { ...app.conn, status: 'error', serverId: 's1', error: { code: 'server-silent', title: 'Сервер не отвечает', text: 'Возможно, ключ устарел или введён с ошибкой. Если ключ точно рабочий, попробуйте другой сервер из списка или повторите позже.' } } } }
  return api
}
