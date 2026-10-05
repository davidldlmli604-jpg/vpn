import { AnimatePresence, motion } from 'framer-motion'
import { useState, type ReactElement } from 'react'
import type { ConnStatus } from '@shared/types'
import { useMotion } from '../lib/useMotionSetting'

type IconKey = 'power' | 'shield' | 'alert' | 'clipboard' | 'busy'

function Glyph({ k }: { k: IconKey }): ReactElement {
  switch (k) {
    case 'shield':
      return (
        <>
          <path d="M12 2.8 4.8 5.7v5.9c0 4.5 3 7.8 7.2 9.4 4.2-1.6 7.2-4.9 7.2-9.4V5.7L12 2.8Z" />
          <motion.path d="M8.6 12.2l2.5 2.6 4.4-4.9" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.25, duration: 0.5, ease: 'easeOut' }} />
        </>
      )
    case 'alert':
      return (<><path d="M12 8.2v5M12 17h.01" /><path d="M10.2 4.4 3.2 16.7A2.1 2.1 0 0 0 5 19.8h14a2.1 2.1 0 0 0 1.8-3.1L13.8 4.4a2.1 2.1 0 0 0-3.6 0Z" /></>)
    case 'clipboard':
      return (<><path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1Z" /><path d="M8 6H6.5A1.5 1.5 0 0 0 5 7.5v11A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 17.5 6H16M9 12h6M9 15.5h4" /></>)
    case 'busy':
      return (<><path d="M12 3.5v8" /><path d="M7.2 6.6a7.6 7.6 0 1 0 9.6 0" /></>)
    default:
      return (<><path d="M12 3.5v8" /><path d="M7.2 6.6a7.6 7.6 0 1 0 9.6 0" /></>)
  }
}

const LABEL: Record<ConnStatus, string> = {
  off: 'Включить',
  connecting: 'Отменить',
  on: 'Выключить',
  error: 'Попробовать снова',
  disconnecting: 'Отключаю…'
}

/**
 * Одна большая кнопка — главное действие. У каждого состояния свой «характер»:
 * выключено — дышит; подключаюсь — крутятся дуги; работает — расходятся волны и летают точки; ошибка — вздрагивает.
 */
export function PowerButton({ status, onClick, noServers }: { status: ConnStatus; onClick: () => void; noServers: boolean }): ReactElement {
  const motion$ = useMotion()
  const [shocks, setShocks] = useState<number[]>([])
  const icon: IconKey = noServers && status === 'off' ? 'clipboard' : status === 'on' ? 'shield' : status === 'error' ? 'alert' : status === 'connecting' || status === 'disconnecting' ? 'busy' : 'power'
  const label = noServers && status === 'off' ? 'Вставить ключ' : LABEL[status]
  const click = (): void => {
    if (motion$ !== 'off') {
      const id = Date.now()
      setShocks((s) => [...s, id])
      setTimeout(() => setShocks((s) => s.filter((x) => x !== id)), 1000)
    }
    onClick()
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div className="power" data-state={status}>
        <div className="power__halo" />
        <div className="power__track" />
        <AnimatePresence>
          {(status === 'connecting' || status === 'disconnecting') && (
            <motion.svg key="ring" className="power__ring" viewBox="0 0 100 100" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.08 }} transition={{ duration: 0.4 }}>
              <circle className="arc-1" cx="50" cy="50" r="46" />
              <circle className="arc-2" cx="50" cy="50" r="40" />
            </motion.svg>
          )}
        </AnimatePresence>
        <span className="power__ripple" />
        <span className="power__ripple" />
        <span className="power__ripple" />
        {status === 'on' && (
          <motion.div className="power__orbit" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4, duration: 0.8 }}>
            <i /><i /><i />
          </motion.div>
        )}
        <AnimatePresence>
          {shocks.map((id) => (
            <motion.span key={id} className="power__shock" initial={{ scale: 0.95, opacity: 0.9 }} animate={{ scale: 2.1, opacity: 0 }} transition={{ duration: 0.9, ease: 'easeOut' }} />
          ))}
        </AnimatePresence>
        <motion.button
          className="power__face"
          onClick={click}
          whileHover={{ scale: 1.045 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 400, damping: 22 }}
          aria-label={label}
          disabled={status === 'disconnecting'}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.svg
              key={icon}
              className={`power__icon${icon === 'busy' ? ' power__icon--busy' : ''}`}
              viewBox="0 0 24 24"
              initial={{ scale: 0.3, opacity: 0, rotate: -40 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              exit={{ scale: 0.3, opacity: 0, rotate: 40, transition: { duration: 0.18 } }}
              transition={{ type: 'spring', stiffness: 380, damping: 22 }}
            >
              <Glyph k={icon} />
            </motion.svg>
          </AnimatePresence>
        </motion.button>
      </div>
      <motion.div className="power__label" key={label} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        {label}
      </motion.div>
    </div>
  )
}
