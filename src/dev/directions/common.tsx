// Общее для макетов: те же данные и действия, что у настоящего главного экрана. Только для выбора внешнего вида.
import { useEffect, useState } from 'react'
import type { ConnStatus, Mode, StatsSample } from '@shared/types'
import type { Mood } from '../../components/Sheltie'
import { countryName, formatDuration, splitBytes } from '../../lib/format'
import { useApp, vpn } from '../../store'

export const NAV: Array<{ page: string; title: string; icon: 'home' | 'servers' | 'split' | 'shield' | 'sliders' }> = [
  { page: 'home', title: 'Главная', icon: 'home' },
  { page: 'servers', title: 'Серверы', icon: 'servers' },
  { page: 'bypass', title: 'Мимо VPN', icon: 'split' },
  { page: 'protection', title: 'Защита', icon: 'shield' },
  { page: 'settings', title: 'Настройки', icon: 'sliders' }
]

export const MODES: Array<{ value: Mode; title: string; tech: string }> = [
  { value: 'proxy', title: 'Браузер и программы', tech: 'системный прокси' },
  { value: 'tun', title: 'Весь компьютер', tech: 'туннель, TUN' }
]

export const MODE_HINT: Record<Mode, string> = {
  proxy: 'Через VPN пойдут браузеры и программы, которые это умеют. Остальные работают как обычно. Админ-права не нужны.',
  tun: 'Через VPN пойдёт весь интернет на компьютере, включая игры и программы без настроек. Нужно разрешение администратора.'
}

export function moodOf(status: ConnStatus): Mood {
  if (status === 'on') return 'happy'
  if (status === 'connecting' || status === 'disconnecting') return 'alert'
  if (status === 'error') return 'worried'
  return 'idle'
}

/** Моргание собаки раз в несколько секунд. */
export function useBlink(): boolean {
  const [b, setB] = useState(false)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const loop = (): void => { t = setTimeout(() => { setB(true); setTimeout(() => setB(false), 140); loop() }, 2600 + Math.random() * 2600) }
    loop()
    return () => clearTimeout(t)
  }, [])
  return b
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

export function useHome() {
  const app = useApp((s) => s.app)
  const history = useApp((s) => s.history)
  const ready = useApp((s) => s.ready)
  const status: ConnStatus = app?.conn.status ?? 'off'
  const now = useNow(status === 'on')
  if (!app) return null
  const { conn, exit, servers, settings } = app
  const server = servers.find((s) => s.id === conn.serverId) ?? servers.find((s) => s.id === settings.selectedServerId) ?? null
  const last: StatsSample | undefined = history[history.length - 1]
  const on = status === 'on'
  let title = 'Выключено'
  let sub = server ? `Сервер: ${server.name}` : 'Вставьте ключ — и всё заработает'
  if (status === 'connecting') { title = 'Подключаюсь'; sub = 'Обычно это занимает несколько секунд' }
  if (on) { title = 'Работает'; sub = `Вы подключены через ${server?.name ?? 'сервер'}` }
  if (status === 'error') { title = conn.error?.title ?? 'Не получилось'; sub = conn.error?.text ?? '' }
  if (status === 'disconnecting') { title = 'Отключаю'; sub = '' }
  const down = splitBytes(on ? last?.downBps ?? 0 : 0, true)
  const up = splitBytes(on ? last?.upBps ?? 0 : 0, true)
  const total = splitBytes(on ? last?.downTotal ?? 0 : 0)
  const sent = splitBytes(on ? last?.upTotal ?? 0 : 0)
  const latency = on ? last?.latencyMs ?? null : null
  return {
    ready, app, status, server, title, sub, history,
    mode: settings.mode,
    latency,
    latencyWord: !on ? 'до сервера' : latency === null ? 'нет ответа' : latency < 150 ? 'отлично' : latency < 400 ? 'нормально' : 'медленно',
    down, up, total, sent,
    uptime: on && conn.since ? formatDuration(now - conn.since) : '—',
    exitText: !on ? 'ваш настоящий адрес' : exit.checking || (!exit.countryCode && !exit.error) ? 'определяю…' : exit.error ? 'не удалось определить' : exit.countryName ?? countryName(exit.countryCode),
    exitCode: on ? exit.countryCode : null,
    powerLabel: status === 'on' ? 'Выключить' : status === 'connecting' ? 'Отменить' : status === 'error' ? 'Попробовать снова' : status === 'disconnecting' ? 'Отключаю…' : 'Включить',
    toggle: async (): Promise<void> => {
      if (status === 'off' || status === 'error') await vpn().connect()
      else if (status === 'on' || status === 'connecting') await vpn().disconnect()
    },
    setMode: (m: Mode): void => void vpn().updateSettings({ mode: m })
  }
}

/** Линия графика скорости (загрузка) по последним выборкам. */
export function speedPath(history: StatsSample[], w: number, h: number, pad = 4): { line: string; area: string; values: number[] } {
  const pts = history.slice(-60).map((s) => s.downBps)
  if (pts.length < 2) return { line: '', area: '', values: [] }
  const max = Math.max(...pts, 1)
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * w, h - pad - (v / max) * (h - pad * 2)] as const)
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  return { line, area: `${line} L${w} ${h} L0 ${h} Z`, values: pts.map((v) => v / max) }
}
