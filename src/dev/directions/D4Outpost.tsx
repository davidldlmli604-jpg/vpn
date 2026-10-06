// Направление 4: «Застава». Тёмная олива и полосы пограничного столба, тонкие линии и сегментные дуги (как в Warframe),
// латунная готическая филигрань (как в Lies of P). Много движения: вращающиеся кольца, сканирующая линия, бегущие полосы.
import '@fontsource/russo-one'
import '@fontsource-variable/rubik'
import type { ReactElement } from 'react'
import brand from '@brand'
import { Flag } from '../../components/Flag'
import { Icon } from '../../components/Icon'
import { Sheltie } from '../../components/Sheltie'
import { MODE_HINT, MODES, NAV, moodOf, speedPath, useBlink, useHome } from './common'
import './d4.css'

/** Латунный уголок-филигрань для рамок. */
function Corner({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }): ReactElement {
  return (
    <svg className={`d4-corner d4-corner--${pos}`} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M2 38 V10 Q2 2 10 2 H38" />
      <path d="M7 38 V14 Q7 7 14 7 H38" className="thin" />
      <path d="M12 2 Q14 12 2 14" className="thin" />
      <circle cx="10" cy="10" r="2.2" />
    </svg>
  )
}

/** Кольца вокруг собаки: внешнее — филигрань с делениями, внутреннее — сегментные дуги. */
function Rings(): ReactElement {
  const ticks = Array.from({ length: 72 }, (_, i) => i)
  return (
    <svg className="d4-rings" viewBox="0 0 300 300" aria-hidden="true">
      <g className="d4-ring d4-ring--outer">
        <circle cx="150" cy="150" r="142" className="line" />
        {ticks.map((i) => <line key={i} x1="150" y1={i % 6 === 0 ? 2 : 6} x2="150" y2="12" transform={`rotate(${i * 5} 150 150)`} className={i % 6 === 0 ? 'tick big' : 'tick'} />)}
        {[0, 90, 180, 270].map((a) => <path key={a} d="M150 0 l6 8 l-6 8 l-6 -8 z" transform={`rotate(${a} 150 150)`} className="gem" />)}
      </g>
      <g className="d4-ring d4-ring--mid">
        {[0, 1, 2, 3, 4, 5].map((i) => <path key={i} d={arc(150, 150, 124, i * 60 + 6, i * 60 + 44)} className="seg" />)}
      </g>
      <g className="d4-ring d4-ring--inner">
        <circle cx="150" cy="150" r="110" className="dash" />
      </g>
    </svg>
  )
}
function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number): string => `${(cx + r * Math.sin((a * Math.PI) / 180)).toFixed(2)} ${(cy - r * Math.cos((a * Math.PI) / 180)).toFixed(2)}`
  return `M${p(a0)} A${r} ${r} 0 0 1 ${p(a1)}`
}

function Gauge({ label, value, unit, sub, frac }: { label: string; value: string; unit?: string; sub: string; frac: number }): ReactElement {
  const len = 113
  return (
    <div className="d4-gauge">
      <svg viewBox="0 0 90 52" aria-hidden="true">
        <path d="M8 48 A37 37 0 0 1 82 48" className="bg" />
        <path d="M8 48 A37 37 0 0 1 82 48" className="fg" style={{ strokeDasharray: `${len}`, strokeDashoffset: `${len * (1 - Math.max(0, Math.min(1, frac)))}` }} />
      </svg>
      <b>{value}{unit && <small>{unit}</small>}</b>
      <span>{label}</span>
      <em>{sub}</em>
    </div>
  )
}

export function D4Outpost(): ReactElement | null {
  const h = useHome()
  const blink = useBlink()
  if (!h) return null
  const on = h.status === 'on'
  const chart = speedPath(h.history, 400, 90, 8)
  const kicker = on ? 'Пост занят · граница под охраной' : h.status === 'connecting' ? 'Выход на пост…' : h.status === 'error' ? 'Тревога' : 'Пост свободен'
  return (
    <div className="dir d4" data-status={h.status}>
      <div className="d4-bgstripes" aria-hidden="true" />
      <header className="d4-top">
        <span className="d4-emblem"><Icon name="shield" size={18} strokeWidth={2} /></span>
        <span className="d4-logo">{brand.name.toUpperCase()}</span>
        <span className="d4-post" />
        <span className="d4-top__line" />
        <span className="d4-top__meta">{h.mode === 'tun' ? 'ВЕСЬ КОМПЬЮТЕР' : 'БРАУЗЕР И ПРОГРАММЫ'}</span>
      </header>

      <nav className="d4-nav">
        {NAV.map((n, i) => (
          <button key={n.page} className="d4-tab" aria-current={i === 0 ? 'page' : undefined} style={{ animationDelay: `${i * 70}ms` }}>
            <span className="d4-diamond" /><Icon name={n.icon} size={17} strokeWidth={1.8} /><span>{n.title}</span>
          </button>
        ))}
      </nav>

      <main className="d4-main">
        <section className="d4-hero">
          <div className="d4-kicker">◆ {kicker} ◆</div>
          <div className="d4-stage">
            <Rings />
            <div className="d4-medallion">
              <div className="d4-scan" />
              <div className="d4-dog"><Sheltie mood={moodOf(h.status)} blinking={blink} hop={false} /></div>
            </div>
          </div>
          <h1 className="d4-status">{h.title}</h1>
          <p className="d4-sub">{h.sub}</p>
          <button className="d4-power" onClick={() => void h.toggle()}>
            <span className="d4-power__band" />
            <span className="d4-power__label"><Icon name="power" size={18} strokeWidth={2.4} /> {h.powerLabel}</span>
          </button>
          <div className="d4-modes" role="radiogroup" aria-label="Режим работы">
            {MODES.map((m) => (
              <button key={m.value} role="radio" aria-checked={h.mode === m.value} onClick={() => h.setMode(m.value)}>
                <Icon name={m.value === 'tun' ? 'monitor' : 'browser'} size={16} strokeWidth={2} /> {m.title}
              </button>
            ))}
          </div>
          <p className="d4-hint">{MODE_HINT[h.mode]}</p>
        </section>

        <section className="d4-col">
          <div className="d4-frame d4-server">
            <Corner pos="tl" /><Corner pos="tr" /><Corner pos="bl" /><Corner pos="br" />
            <span className="d4-flag"><Flag code={h.server?.countryCode ?? null} size={30} /></span>
            <div><div className="d4-label">Сервер</div><b>{h.server?.name ?? 'не выбран'}</b></div>
            <Icon name="chevron" size={18} />
          </div>

          <div className="d4-frame d4-gauges">
            <Corner pos="tl" /><Corner pos="tr" /><Corner pos="bl" /><Corner pos="br" />
            <Gauge label="Задержка" value={h.latency !== null ? String(h.latency) : '—'} unit=" мс" sub={h.latencyWord} frac={h.latency === null ? 0 : 1 - Math.min(1, h.latency / 400)} />
            <Gauge label="Скорость" value={h.down.value} unit={` ${h.down.unit}`} sub={`отдача ${h.up.value} ${h.up.unit}`} frac={chart.values.length ? chart.values[chart.values.length - 1]! : 0} />
            <Gauge label="Время работы" value={h.uptime} sub="с момента включения" frac={on ? 1 : 0} />
            <Gauge label="Скачано" value={h.total.value} unit={` ${h.total.unit}`} sub={`отправлено ${h.sent.value} ${h.sent.unit}`} frac={on ? 0.66 : 0} />
          </div>

          <div className="d4-frame d4-chart">
            <Corner pos="tl" /><Corner pos="tr" /><Corner pos="bl" /><Corner pos="br" />
            <div className="d4-label d4-label--line">Скорость за минуту</div>
            <div className="d4-chart__box">
              <svg viewBox="0 0 400 90" preserveAspectRatio="none">
                {Array.from({ length: 9 }, (_, i) => <line key={i} x1={i * 50} x2={i * 50} y1="0" y2="90" className="grid" />)}
                {chart.line ? <><path d={chart.area} className="area" /><path d={chart.line} className="line" /></> : null}
              </svg>
              {chart.line ? <span className="d4-sweep" /> : <span className="d4-empty">График появится, когда включится VPN</span>}
            </div>
          </div>

          <div className="d4-frame d4-exit">
            <Corner pos="tl" /><Corner pos="tr" /><Corner pos="bl" /><Corner pos="br" />
            <span className="d4-flag d4-flag--diamond">{h.exitCode ? <Flag code={h.exitCode} size={22} /> : <Icon name="globe" size={18} />}</span>
            <div><div className="d4-label">Ваш адрес сейчас виден как</div><b>{h.exitText}</b></div>
          </div>
        </section>
      </main>
    </div>
  )
}
