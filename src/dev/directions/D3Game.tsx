// Направление 3: насыщенное, как интерфейс игры — рамки, фактуры, детали. Без неона: латунь, графит, ржавчина.
import '@fontsource/russo-one'
import '@fontsource-variable/rubik'
import type { ReactElement } from 'react'
import brand from '@brand'
import { Flag } from '../../components/Flag'
import { Icon } from '../../components/Icon'
import { Sheltie } from '../../components/Sheltie'
import { MODE_HINT, MODES, NAV, moodOf, speedPath, useBlink, useHome } from './common'
import './d3.css'

function Bar({ label, value, filled, tone }: { label: string; value: string; filled: number; tone: 'ok' | 'gold' | 'bad' }): ReactElement {
  return (
    <div className="d3-bar" data-tone={tone}>
      <div className="d3-bar__top"><span>{label}</span><b>{value}</b></div>
      <div className="d3-bar__cells">{Array.from({ length: 12 }, (_, i) => <i key={i} data-on={i < Math.round(filled * 12)} />)}</div>
    </div>
  )
}

export function D3Game(): ReactElement | null {
  const h = useHome()
  const blink = useBlink()
  if (!h) return null
  const on = h.status === 'on'
  const chart = speedPath(h.history, 100, 10)
  const bars = chart.values.slice(-36)
  const linkFill = !on || h.latency === null ? 0 : Math.max(0.1, 1 - h.latency / 500)
  const speedFill = on ? Math.min(1, (chart.values[chart.values.length - 1] ?? 0)) : 0
  const statusWord = on ? 'ЗАЩИЩЕНО' : h.status === 'connecting' ? 'ПОДКЛЮЧЕНИЕ' : h.status === 'error' ? 'СБОЙ' : 'ВЫКЛЮЧЕНО'
  return (
    <div className="dir d3" data-status={h.status}>
      <header className="d3-top">
        <span className="d3-logo">{brand.name.toUpperCase()}</span>
        <span className="d3-top__rule" />
        <span className="d3-chip">{h.mode === 'tun' ? 'ВЕСЬ КОМПЬЮТЕР' : 'БРАУЗЕР И ПРОГРАММЫ'}</span>
      </header>
      <nav className="d3-nav">
        {NAV.map((n, i) => (
          <button key={n.page} className="d3-tab" aria-current={i === 0 ? 'page' : undefined}>
            <span className="d3-tab__ico"><Icon name={n.icon} size={17} strokeWidth={2} /></span>{n.title}
          </button>
        ))}
      </nav>

      <main className="d3-main">
        <section className="d3-panel d3-hero">
          <div className="d3-portrait">
            <div className="d3-portrait__frame">
              <div className="d3-portrait__bg" />
              <div className="d3-dog"><Sheltie mood={moodOf(h.status)} blinking={blink} hop={false} /></div>
            </div>
            <div className="d3-plate">ШЕЛТИ · СТРАЖ ТРОПЫ</div>
          </div>
          <div className="d3-hero__info">
            <div className="d3-kicker">Статус</div>
            <div className="d3-status">{statusWord}</div>
            <div className="d3-sub">{h.sub}</div>
            <div className="d3-loc">
              <span className="d3-loc__flag"><Flag code={h.server?.countryCode ?? null} size={26} /></span>
              <div><div className="d3-kicker">Сервер</div><b>{h.server?.name ?? 'не выбран'}</b></div>
            </div>
            <Bar label="Связь" value={h.latency !== null ? `${h.latency} мс · ${h.latencyWord}` : '—'} filled={linkFill} tone={linkFill > 0.6 ? 'ok' : linkFill > 0.25 ? 'gold' : 'bad'} />
            <Bar label="Скорость" value={`${h.down.value} ${h.down.unit}`} filled={speedFill} tone="gold" />
            <button className="d3-power" onClick={() => void h.toggle()}>
              <span>{h.powerLabel.toUpperCase()}</span>
            </button>
          </div>
        </section>

        <div className="d3-side">
          <section className="d3-panel">
            <div className="d3-title">Режим</div>
            <div className="d3-modes" role="radiogroup" aria-label="Режим работы">
              {MODES.map((m) => (
                <button key={m.value} role="radio" aria-checked={h.mode === m.value} onClick={() => h.setMode(m.value)}>
                  <Icon name={m.value === 'tun' ? 'monitor' : 'browser'} size={20} strokeWidth={2} />
                  <span>{m.title}</span>
                  <small>{m.tech}</small>
                </button>
              ))}
            </div>
            <p className="d3-hint">{MODE_HINT[h.mode]}</p>
          </section>

          <section className="d3-slots">
            <div className="d3-slot"><Icon name="clock" size={18} strokeWidth={2} /><b>{h.uptime}</b><span>время работы</span></div>
            <div className="d3-slot"><Icon name="download" size={18} strokeWidth={2} /><b>{h.total.value}<small>{h.total.unit}</small></b><span>скачано</span></div>
            <div className="d3-slot"><Icon name="upload" size={18} strokeWidth={2} /><b>{h.sent.value}<small>{h.sent.unit}</small></b><span>отправлено</span></div>
            <div className="d3-slot"><Icon name="bolt" size={18} strokeWidth={2} /><b>{h.up.value}<small>{h.up.unit}</small></b><span>отдача</span></div>
          </section>

          <section className="d3-panel d3-flow">
            <div className="d3-title">Поток данных</div>
            <div className="d3-eq">
              {bars.length ? bars.map((v, i) => <i key={i} style={{ height: `${Math.max(6, v * 100)}%` }} />) : <span className="d3-hint">Появится, когда включится VPN</span>}
            </div>
          </section>

          <section className="d3-panel d3-exit">
            <Icon name="globe" size={20} strokeWidth={2} />
            <div><div className="d3-kicker">Ваш адрес сейчас виден как</div><b>{h.exitCode && <Flag code={h.exitCode} size={18} />} {h.exitText}</b></div>
          </section>
        </div>
      </main>
    </div>
  )
}
