import { LayoutGroup, motion } from 'framer-motion'
import { useId, type ReactElement } from 'react'
import brand from '@brand'
import { useApp, type Page } from '../store'
import { Assistant } from './Assistant'
import { Icon, type IconName } from './Icon'

export function TitleBar(): ReactElement {
  return (
    <div className="titlebar">
      <span className="titlebar__brand">
        <svg width="18" height="18" viewBox="0 0 256 256" aria-hidden="true">
          <defs><linearGradient id="tg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--accent)" /><stop offset="1" stopColor="var(--accent-2)" /></linearGradient></defs>
          <path d="M 188 100 A 78 78 0 1 1 68 100" fill="none" stroke="url(#tg)" strokeWidth="26" strokeLinecap="round" />
          <circle cx="128" cy="50" r="18" fill="url(#tg)" />
        </svg>
        {brand.name}
      </span>
    </div>
  )
}

interface NavItem { page: Page; title: string; icon: IconName; hint: string; soon?: boolean }
const NAV: NavItem[] = [
  { page: 'home', title: 'Главная', icon: 'home', hint: 'Главная: здесь большая кнопка включения и всё, что сейчас происходит с подключением.' },
  { page: 'servers', title: 'Серверы', icon: 'servers', hint: 'Серверы: ваши ключи и подписки. Выберите, через какую страну пойдёт интернет, проверьте, какой сервер быстрее, или добавьте новый ключ.' },
  { page: 'bypass', title: 'Мимо VPN', icon: 'split', hint: 'Мимо VPN: сайты и программы, которые должны открываться напрямую — российские сайты, игры, свои списки.' },
  { page: 'protection', title: 'Защита', icon: 'shield', hint: 'Защита: что будет, если VPN оборвётся (интернет может сам отключиться, чтобы не выдать ваш настоящий адрес), защита DNS и кнопка «Починить интернет».' },
  { page: 'settings', title: 'Настройки', icon: 'sliders', hint: 'Настройки: цвета и тема окна, анимации и поведение программы.' }
]

const STATUS_TITLE: Record<string, string> = { off: 'Выключено', connecting: 'Подключаюсь', on: 'Работает', error: 'Ошибка', disconnecting: 'Отключаю' }

export function Sidebar(): ReactElement {
  const page = useApp((s) => s.page)
  const setPage = useApp((s) => s.setPage)
  const app = useApp((s) => s.app)
  const id = useId()
  const status = app?.conn.status ?? 'off'
  const server = app?.servers.find((s) => s.id === (app.conn.serverId ?? app.settings.selectedServerId))
  return (
    <nav className="sidebar" aria-label="Разделы">
      <LayoutGroup id={id}>
        {NAV.map((n) => (
          <button key={n.page} className="nav" data-hint={n.hint} aria-current={page === n.page ? 'page' : undefined} disabled={n.soon} style={n.soon ? { opacity: 0.6, cursor: 'not-allowed' } : undefined} onClick={() => !n.soon && setPage(n.page)}>
            {page === n.page && <motion.span layoutId="nav-pill" className="nav__pill" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
            <Icon name={n.icon} />
            <span>{n.title}</span>
            {n.soon && <span className="nav__soon">скоро</span>}
          </button>
        ))}
      </LayoutGroup>
      <div className="sidebar__spacer" />
      <Assistant />
      <div className="mini-status" data-hint="Коротко о подключении: работает или нет и через какой сервер. Подробности — на «Главной».">
        <span className="mini-status__dot" />
        <div className="mini-status__text">
          <div className="mini-status__title">{STATUS_TITLE[status]}</div>
          <div className="mini-status__sub">{server ? server.name : 'Сервер не выбран'}</div>
        </div>
      </div>
    </nav>
  )
}
