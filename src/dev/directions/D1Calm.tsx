// Направление 1: спокойное и строгое, как встроенные приложения Windows 11.
import '@fontsource-variable/inter'
import type { ReactElement } from 'react'
import brand from '@brand'
import { Flag } from '../../components/Flag'
import { Icon } from '../../components/Icon'
import { Sheltie } from '../../components/Sheltie'
import { protocolLabel } from '../../lib/format'
import { MODE_HINT, MODES, NAV, moodOf, speedPath, useBlink, useHome } from './common'
import './d1.css'

export function D1Calm(): ReactElement | null {
  const h = useHome()
  const blink = useBlink()
  if (!h) return null
  const on = h.status === 'on'
  const busy = h.status === 'connecting' || h.status === 'disconnecting'
  const chart = speedPath(h.history, 560, 96)
  return (
    <div className="dir d1" data-status={h.status}>
      <header className="d1-title"><span className="d1-title__logo" />{brand.name}</header>
      <nav className="d1-nav">
        {NAV.map((n, i) => (
          <button key={n.page} className="d1-nav__item" aria-current={i === 0 ? 'page' : undefined}>
            <Icon name={n.icon} size={17} strokeWidth={1.6} /> {n.title}
          </button>
        ))}
      </nav>
      <main className="d1-main">
        <h1 className="d1-h1">Главная</h1>

        <section className="d1-card d1-hero">
          <div className="d1-dog"><Sheltie mood={moodOf(h.status)} blinking={blink} hop={false} /></div>
          <div className="d1-hero__text">
            <div className="d1-state">
              <span className="d1-state__dot" />
              {h.title}{busy && '…'}
            </div>
            <div className="d1-sub">{h.sub}</div>
            <div className="d1-exit">Ваш адрес сейчас виден как: {h.exitCode && <Flag code={h.exitCode} size={16} />} <b>{h.exitText}</b></div>
          </div>
          <div className="d1-hero__action">
            <button className="d1-switch" role="switch" aria-checked={on || h.status === 'connecting'} onClick={() => void h.toggle()} aria-label="VPN">
              <span className="d1-switch__knob" />
            </button>
            <span className="d1-switch__label">{on ? 'Вкл.' : h.status === 'connecting' ? 'Подключение' : 'Откл.'}</span>
          </div>
          {busy && <div className="d1-progress"><i /></div>}
        </section>

        <section className="d1-group">
          <div className="d1-card d1-row">
            <Flag code={h.server?.countryCode ?? null} size={22} />
            <div className="d1-row__text">
              <div className="d1-row__name">{h.server?.name ?? 'Сервер не выбран'}</div>
              <div className="d1-row__hint">Сервер · {h.server ? protocolLabel(h.server.protocol) : 'добавьте ключ на вкладке «Серверы»'}</div>
            </div>
            <Icon name="chevron" size={16} className="d1-row__chev" />
          </div>
          <div className="d1-card d1-row">
            <Icon name={h.mode === 'tun' ? 'monitor' : 'browser'} size={20} strokeWidth={1.6} />
            <div className="d1-row__text">
              <div className="d1-row__name">Режим работы</div>
              <div className="d1-row__hint">{MODE_HINT[h.mode]}</div>
            </div>
            <div className="d1-seg" role="radiogroup" aria-label="Режим работы">
              {MODES.map((m) => <button key={m.value} role="radio" aria-checked={h.mode === m.value} onClick={() => h.setMode(m.value)}>{m.title}</button>)}
            </div>
          </div>
        </section>

        <section className="d1-card d1-stats">
          <div><span>Задержка</span><b>{h.latency ?? '—'}<small> мс</small></b><em>{h.latencyWord}</em></div>
          <div><span>Скорость</span><b>{h.down.value}<small> {h.down.unit}</small></b><em>отдача: {h.up.value} {h.up.unit}</em></div>
          <div><span>Время работы</span><b>{h.uptime}</b><em>с момента включения</em></div>
          <div><span>Скачано</span><b>{h.total.value}<small> {h.total.unit}</small></b><em>отправлено: {h.sent.value} {h.sent.unit}</em></div>
        </section>

        <section className="d1-card d1-chart">
          <div className="d1-chart__head"><span>Скорость за последнюю минуту</span><span className="d1-legend"><i />загрузка</span></div>
          <svg viewBox="0 0 560 96" preserveAspectRatio="none" className="d1-chart__svg">
            {[24, 48, 72].map((y) => <line key={y} x1="0" x2="560" y1={y} y2={y} className="d1-grid" />)}
            {chart.line ? <><path d={chart.area} className="d1-area" /><path d={chart.line} className="d1-line" /></> : <text x="280" y="40" textAnchor="middle" className="d1-empty">График появится, когда включится VPN</text>}
          </svg>
        </section>
      </main>
    </div>
  )
}
