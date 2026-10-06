// Тестовый «бэкенд» — ТОЛЬКО для просмотра оформления в обычном браузере (npm run ui).
// В настоящем приложении не используется: там окно общается с настоящим движком.
import type { ToastMessage, VpnApi } from '@shared/api'
import { DEFAULT_SETTINGS, mergeSettings } from '@shared/defaults'
import type { AddResult, AppState, CheckReport, CheckStep, RunningApp, ServerView, Settings, StatsSample, SubscriptionView } from '@shared/types'

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
    wizardDone: q.get('wizard') !== '1',
    theme: (q.get('theme') as Settings['theme']) ?? 'dark',
    palette: (q.get('palette') as Settings['palette']) ?? 'aurora',
    mode: (q.get('mode') as Settings['mode']) ?? 'proxy',
    motion: (q.get('motion') as Settings['motion']) ?? 'full',
    killSwitch: q.get('ks') === '1'
  })
  const empty = q.get('empty') === '1'
  const servers: ServerView[] = empty
    ? []
    : SAMPLE.map(([name, cc, protocol, host], i) => ({
        id: `s${i + 1}`, name, protocol, host, port: 443, countryCode: cc, favorite: i === 0 || i === 2, subscriptionId: i < 4 && q.get('subs') !== '0' ? 'sub1' : null,
        latency: i === 5 ? { error: 'нет ответа' } : { ms: [38, 61, 74, 142, 233, 0][i]! }, canQr: i !== 3, warnings: [], addedAt: Date.now() - i * 86400000
      }))
  if (!empty) settings = { ...settings, selectedServerId: 's1' }

  const subs: SubscriptionView[] = empty || q.get('subs') === '0' ? [] : [
    { id: 'sub1', name: 'Быстрый VPN', displayUrl: 'https://sub.fastvpn.example/…', updatedAt: Date.now() - 12 * 60_000, serverCount: 4, info: { upload: 12 * 2 ** 30, download: 122 * 2 ** 30, total: 200 * 2 ** 30, expireAt: Date.now() + 41 * 86400_000 }, error: null, refreshing: false },
    ...(q.get('subs') === 'err' ? [{ id: 'sub2', name: 'Запасной', displayUrl: 'https://backup.example/…', updatedAt: Date.now() - 3 * 86400_000, serverCount: 0, info: null, error: 'Сайт подписки не отвечает. Проверьте интернет и попробуйте позже. Если сайт у вас заблокирован — включите VPN через другой ключ и повторите.', refreshing: false } as SubscriptionView] : [])
  ]

  let app: AppState = {
    conn: { status: 'off', error: null, serverId: null, since: null, reconnect: null, degraded: false, mode: null, blocked: false },
    exit: { checking: false, countryCode: null, countryName: null, ip: null, error: null },
    servers,
    subscriptions: subs,
    check: null,
    settings,
    system: {
      platform: 'win32', appVersion: '0.1.0', isAdmin: false, elevationReady: false,
      singbox: { found: true, version: '1.14.2', path: 'engine/sing-box.exe' }, secureStorage: true,
      rules: { updatedAt: null, count: 31, updating: false, bundledOnly: true }, startedHidden: false, killSwitchActive: false,
      update: { status: q.get('update') === 'ready' ? 'ready' : 'latest', version: q.get('update') === 'ready' ? '0.2.5' : null, percent: q.get('update') === 'ready' ? 100 : 0, error: null, checkedAt: Date.now() - 40 * 60_000 }
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
    app = { ...app, check: null, exit: { checking: false, countryCode: null, countryName: null, ip: null, error: null } }
    setConn({ status: 'off', since: null, error: null })
  }

  const STEPS: Array<[CheckStep['id'], string, CheckStep['status'], string]> = [
    ['server', 'Связь с сервером', 'ok', 'Сервер отвечает за 41 мс.'],
    ['address', 'Ваш адрес в интернете', 'ok', 'Сайты видят вас из страны: Нидерланды.'],
    ['dns', 'Поиск адресов сайтов (DNS)', q.get('check') === 'warn' ? 'warn' : 'ok', q.get('check') === 'warn' ? 'Защита от утечки DNS выключена: адреса сайтов ищет ваш интернет-провайдер, и ему видно, какие сайты вы открываете. Включите «Защиту от утечки DNS» в настройках.' : 'Адреса сайтов ищутся через VPN — провайдер не видит, какие сайты вы открываете.'],
    ['ru-direct', 'Российские сайты напрямую', 'ok', 'Российский сайт открылся напрямую за 23 мс — мимо VPN, как и должно быть.']
  ]
  const report = (done: number, finished: boolean): CheckReport => {
    const steps: CheckStep[] = STEPS.map(([id, title, status, detail], i) => (i < done ? { id, title, status, detail } : i === done && !finished ? { id, title, status: 'running', detail: '' } : { id, title, status: 'pending', detail: '' }))
    const warn = steps.find((x) => x.status === 'warn')
    return { startedAt: Date.now(), finished, steps, verdict: finished ? (warn ? 'warn' : 'ok') : null, summary: finished ? (warn ? `В целом работает, но есть замечание. ${warn.detail}` : 'Всё работает. Интернет идёт через Нидерланды, а российские сайты открываются напрямую — быстро и без лишних входов.') : '' }
  }
  async function runCheck(): Promise<void> {
    if (app.conn.status !== 'on') return
    for (let i = 0; i <= STEPS.length; i++) {
      app = { ...app, check: report(i, i === STEPS.length) }
      emit()
      if (i < STEPS.length) await new Promise((r) => setTimeout(r, 650))
    }
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

    pingServers: async (ids) => {
      const targets = app.servers.filter((x) => !ids || ids.includes(x.id))
      app = { ...app, servers: app.servers.map((x) => (targets.some((t) => t.id === x.id) ? { ...x, latency: 'testing' } : x)) }
      emit()
      for (const t of targets) {
        await new Promise((r) => setTimeout(r, 350 + Math.random() * 500))
        const bad = t.id === 's6'
        const ms = [38, 61, 74, 142, 233][Number(t.id.slice(1)) - 1] ?? 90 + Math.round(Math.random() * 120)
        app = { ...app, servers: app.servers.map((x) => (x.id === t.id ? { ...x, latency: bad ? { error: 'нет ответа' } : { ms } } : x)) }
        emit()
      }
    },
    refreshSubscription: async (id) => {
      app = { ...app, subscriptions: app.subscriptions.map((x) => (x.id === id ? { ...x, refreshing: true } : x)) }
      emit()
      await new Promise((r) => setTimeout(r, 1300))
      const fail = id === 'sub2'
      app = { ...app, subscriptions: app.subscriptions.map((x) => (x.id === id ? { ...x, refreshing: false, updatedAt: fail ? x.updatedAt : Date.now() } : x)) }
      emit()
      return fail ? { ok: false, message: 'Сайт подписки не отвечает.' } : { ok: true, message: 'Список серверов актуален: изменений нет.' }
    },
    renameSubscription: async (id, name) => { app = { ...app, subscriptions: app.subscriptions.map((x) => (x.id === id ? { ...x, name } : x)) }; emit() },
    removeSubscription: async (id) => { app = { ...app, subscriptions: app.subscriptions.filter((x) => x.id !== id), servers: app.servers.filter((x) => x.subscriptionId !== id) }; emit() },
    getQr: async (kind, id) => {
      const { default: QRCode } = await import('qrcode')
      const text = kind === 'server' ? `vless://00000000-0000-4000-8000-000000000000@${app.servers.find((x) => x.id === id)?.host ?? 'example.net'}:443?security=reality&sni=example.com#demo` : 'https://sub.fastvpn.example/api/v1/demo-token'
      return { ok: true, dataUrl: await QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 2, width: 440 }), title: kind === 'server' ? 'Ключ' : 'Подписка' }
    },
    runCheck: () => runCheck(),
    clearCheck: async () => { app = { ...app, check: null }; emit() },

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
    resetAdvanced: async () => { app = { ...app, settings: mergeSettings({ ...app.settings, advanced: DEFAULT_SETTINGS.advanced }) }; emit(); toast('success', 'Настройки для специалиста сброшены к стандартным.') },
    getLogs: async () => ['12:01:07 [программа] Подключение при запуске программы', '12:01:09 [движок] INFO inbound/mixed[mixed-in]: tcp server started at 127.0.0.1:7890', '12:01:09 [движок] INFO sing-box started (0.31s)', '12:01:10 [программа] Событие: connected', '12:01:24 [программа] Проверка «всё ли работает»: ok'],
    clearLogs: async () => undefined,
    getConfigPreview: async () => ({ note: 'Так будут выглядеть настройки при подключении · режим «Браузер и программы» · сервер «Нидерланды · Амстердам». Секреты скрыты; порты управления подставятся при запуске.', json: JSON.stringify({ log: { level: 'info' }, dns: { final: 'dns-remote' }, inbounds: [{ type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: 7890 }], outbounds: [{ type: 'vless', tag: 'proxy', server: 'nl-1.example.net', server_port: 443, uuid: '••••••••' }, { type: 'direct', tag: 'direct' }], route: { final: 'proxy' } }, null, 2) }),
    copyText: async () => undefined,
    recoverInternet: async () => {
      await new Promise((r) => setTimeout(r, 600))
      app = { ...app, conn: { ...app.conn, status: 'off', blocked: false, error: null } }
      emit()
      return { ok: true, message: 'Готово: VPN выключен, все ограничения сняты. Если интернета всё равно нет — проверьте роутер или провайдера.' }
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

    checkForUpdates: async () => {
      app = { ...app, system: { ...app.system, update: { ...app.system.update, status: 'checking' } } }
      emit()
      await new Promise((r) => setTimeout(r, 1200))
      app = { ...app, system: { ...app.system, update: { ...app.system.update, status: 'latest', checkedAt: Date.now() } } }
      emit()
      toast('success', 'У вас последняя версия.')
    },
    installUpdate: async () => toast('info', 'В просмотре оформления обновление не ставится.'),
    windowAction: async () => undefined,
    quit: async () => undefined
  }

  // сцены для скриншотов: ?scene=on / connecting / error
  const scene = q.get('scene')
  if (scene === 'on') void connect('s1')
  if (scene === 'check') void connect('s1').then(() => new Promise((r) => setTimeout(r, 400))).then(() => runCheck())
  if (scene === 'blocked') { app = { ...app, conn: { ...app.conn, status: 'connecting', serverId: 's1', mode: settings.mode, blocked: true, reconnect: { attempt: 2, nextInMs: 3000 }, error: { code: 'exited', title: 'Подключение оборвалось', text: '' } } } }
  if (scene === 'connecting') { app = { ...app, conn: { ...app.conn, status: 'connecting', serverId: 's1', mode: settings.mode } } }
  if (scene === 'error') { app = { ...app, conn: { ...app.conn, status: 'error', serverId: 's1', error: { code: 'server-silent', title: 'Сервер не отвечает', text: 'Возможно, ключ устарел или введён с ошибкой. Если ключ точно рабочий, попробуйте другой сервер из списка или повторите позже.' } } } }
  return api
}
