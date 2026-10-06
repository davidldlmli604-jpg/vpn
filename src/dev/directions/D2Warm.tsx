// Направление 2: тёплое и рисованное, всё построено вокруг Шелти.
import '@fontsource-variable/nunito'
import '@fontsource-variable/caveat'
import type { ReactElement } from 'react'
import brand from '@brand'
import { Flag } from '../../components/Flag'
import { Icon } from '../../components/Icon'
import { Sheltie } from '../../components/Sheltie'
import { MODE_HINT, MODES, NAV, moodOf, speedPath, useBlink, useHome } from './common'
import './d2.css'

/** Что говорит собака в облачке — это и есть главный статус. */
function dogSays(status: string, server: string | undefined): [string, string] {
  if (status === 'on') return ['Всё работает!', `Сторожу ваш интернет. Сейчас мы гуляем через «${server ?? 'сервер'}».`]
  if (status === 'connecting') return ['Подключаюсь…', 'Обычно это занимает несколько секунд. Уже бегу!']
  if (status === 'error') return ['Не получилось', 'Сервер не отвечает. Нажмите кнопку — попробую ещё раз.']
  return ['Выключено', 'Нажмите большую кнопку — и интернет пойдёт через VPN.']
}

export function D2Warm(): ReactElement | null {
  const h = useHome()
  const blink = useBlink()
  if (!h) return null
  const [say, sayMore] = dogSays(h.status, h.server?.name)
  const chart = speedPath(h.history, 360, 80, 8)
  return (
    <div className="dir d2" data-status={h.status}>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <filter id="d2-rough"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="3" /><feDisplacementMap in="SourceGraphic" scale="3" /></filter>
      </svg>
      <aside className="d2-side">
        <div className="d2-brand">{brand.name}</div>
        <nav className="d2-nav">
          {NAV.map((n, i) => (
            <button key={n.page} className="d2-tab" aria-current={i === 0 ? 'page' : undefined}>
              <Icon name={n.icon} size={18} strokeWidth={2} /> {n.title}
            </button>
          ))}
        </nav>
      </aside>

      <main className="d2-main">
        <section className="d2-stage">
          <div className="d2-bubble">
            <div className="d2-say">{say}</div>
            <p>{sayMore}</p>
          </div>
          <div className="d2-dogwrap">
            <div className="d2-rug" />
            <div className="d2-dog"><Sheltie mood={moodOf(h.status)} blinking={blink} hop={false} /></div>
          </div>
          <button className="d2-power" onClick={() => void h.toggle()}>
            <Icon name="power" size={22} strokeWidth={2.4} /> {h.status === 'off' ? 'Включить VPN' : h.powerLabel}
          </button>
          <div className="d2-modes" role="radiogroup" aria-label="Режим работы">
            {MODES.map((m) => (
              <button key={m.value} role="radio" aria-checked={h.mode === m.value} onClick={() => h.setMode(m.value)}>
                <Icon name={m.value === 'tun' ? 'monitor' : 'browser'} size={17} strokeWidth={2} /> {m.title}
              </button>
            ))}
          </div>
          <p className="d2-modehint">{MODE_HINT[h.mode]}</p>
        </section>

        <section className="d2-notes">
          <div className="d2-paper d2-server">
            <span className="d2-stamp"><Flag code={h.server?.countryCode ?? null} size={30} /></span>
            <div><div className="d2-label">Сервер</div><b>{h.server?.name ?? 'не выбран'}</b></div>
            <Icon name="chevron" size={18} />
          </div>
          <div className="d2-stickies">
            <div className="d2-sticky" style={{ ['--c' as string]: '#fde9a8', ['--r' as string]: '-1.6deg' }}><span>Задержка</span><b>{h.latency ?? '—'}<small> мс</small></b><em>{h.latencyWord}</em></div>
            <div className="d2-sticky" style={{ ['--c' as string]: '#cfe8c4', ['--r' as string]: '1.2deg' }}><span>Скорость</span><b>{h.down.value}<small> {h.down.unit}</small></b><em>отдача {h.up.value} {h.up.unit}</em></div>
            <div className="d2-sticky" style={{ ['--c' as string]: '#f8d3c1', ['--r' as string]: '0.8deg' }}><span>Время работы</span><b>{h.uptime}</b><em>с момента включения</em></div>
            <div className="d2-sticky" style={{ ['--c' as string]: '#d4e4f2', ['--r' as string]: '-1deg' }}><span>Скачано</span><b>{h.total.value}<small> {h.total.unit}</small></b><em>отправлено {h.sent.value} {h.sent.unit}</em></div>
          </div>
          <div className="d2-paper d2-chart">
            <div className="d2-label">Скорость за минуту</div>
            <svg viewBox="0 0 360 80" preserveAspectRatio="none">
              {chart.line ? <path d={chart.line} className="d2-line" /> : <text x="180" y="46" textAnchor="middle" className="d2-empty">тут нарисуется график, когда включится VPN</text>}
            </svg>
          </div>
          <div className="d2-paper d2-exit">
            <Icon name="globe" size={20} strokeWidth={2} />
            <div><div className="d2-label">Ваш адрес сейчас виден как</div><b>{h.exitCode && <Flag code={h.exitCode} size={18} />} {h.exitText}</b></div>
          </div>
        </section>
      </main>
    </div>
  )
}
