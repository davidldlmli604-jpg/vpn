import { AnimatePresence, motion } from 'framer-motion'
import { useMemo, useState, type ReactElement } from 'react'
import type { CheckReport, CheckStep } from '@shared/types'
import { vpn } from '../store'
import { Icon } from './Icon'

function Mark({ status }: { status: CheckStep['status'] }): ReactElement {
  if (status === 'running') return <span className="spinner" style={{ width: 14, height: 14 }} />
  if (status === 'ok') return <motion.span style={{ display: 'grid' }} initial={{ scale: 0, rotate: -80 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 520, damping: 16 }}><Icon name="check" size={15} strokeWidth={3} /></motion.span>
  if (status === 'warn') return <motion.span style={{ display: 'grid' }} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 520, damping: 16 }}><Icon name="alert" size={15} strokeWidth={2.6} /></motion.span>
  if (status === 'fail') return <motion.span style={{ display: 'grid' }} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 520, damping: 16 }}><Icon name="x" size={15} strokeWidth={3} /></motion.span>
  return <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', opacity: 0.6 }} />
}

/** Брызги искр за успешной проверкой. */
function Sparks(): ReactElement {
  const items = useMemo(() => Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2
    const r = 50 + (i % 3) * 22
    return { dx: Math.cos(a) * r, dy: Math.sin(a) * r * 0.7, delay: (i % 5) * 0.06 }
  }), [])
  return <>{items.map((p, i) => <i key={i} className="check__spark" style={{ left: 38, top: 36, ['--dx' as string]: `${p.dx}px`, ['--dy' as string]: `${p.dy}px`, animationDelay: `${p.delay}s` }} />)}</>
}

const BADGE = { ok: 'shield-check', warn: 'alert', fail: 'x' } as const

export function CheckCard({ report }: { report: CheckReport | null }): ReactElement {
  const [starting, setStarting] = useState(false)
  const start = async (): Promise<void> => {
    setStarting(true)
    try { await vpn().runCheck() } finally { setStarting(false) }
  }
  const running = !!report && !report.finished

  return (
    <div className="glass check" data-hint="Кнопка проверки: узнаёт, действительно ли всё в порядке — отвечает ли сервер, под какой страной вас видят сайты, не видит ли провайдер, какие сайты вы открываете, и открываются ли российские сайты напрямую. В конце скажет простыми словами.">
      <AnimatePresence mode="wait" initial={false}>
        {!report ? (
          <motion.div key="ask" className="check__ask" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div>
              <div className="card__title">Всё ли работает?</div>
              <p>Проверю связь с сервером, ваш адрес в интернете и российские сайты. Займёт несколько секунд.</p>
            </div>
            <button className="btn btn--ghost" disabled={starting} onClick={() => void start()}>
              {starting ? <span className="spinner" /> : <Icon name="shield-check" size={18} />} Проверить, всё ли работает
            </button>
          </motion.div>
        ) : (
          <motion.div key="report" style={{ display: 'flex', flexDirection: 'column', gap: 12 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="check__head">
              <div className="card__title">{running ? 'Проверяю…' : 'Результат проверки'}</div>
              {report.finished && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn--ghost btn--sm" disabled={starting} data-hint="Запустить проверку заново." onClick={() => void start()}><Icon name="refresh" size={15} /> Ещё раз</button>
                  <button className="icon-btn" aria-label="Закрыть результат" data-hint="Спрятать результат проверки." onClick={() => void vpn().clearCheck()}><Icon name="x" size={18} /></button>
                </div>
              )}
            </div>
            {report.steps.length > 0 && (
              <div className="check__steps" aria-live="polite">
                {report.steps.map((s, i) => (
                  <motion.div key={s.id} className="check__step" data-status={s.status} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07, duration: 0.3 }}>
                    <span className="check__mark"><Mark status={s.status} /></span>
                    <div>
                      <div className="check__title">{s.title}</div>
                      <AnimatePresence initial={false}>
                        {s.detail && <motion.div className="check__detail" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>{s.detail}</motion.div>}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
            {report.finished && report.verdict && (
              <motion.div className="check__summary" data-verdict={report.verdict} initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 24 }} role="status">
                {report.verdict === 'ok' && <Sparks />}
                <motion.span className="check__badge" initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 15, delay: 0.1 }}>
                  <Icon name={BADGE[report.verdict]} size={22} strokeWidth={2.4} />
                </motion.span>
                <div className="check__text">{report.summary}</div>
              </motion.div>
            )}
            {report.finished && !report.verdict && report.summary && <div className="check__text">{report.summary}</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
