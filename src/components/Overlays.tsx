import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, type ReactElement, type ReactNode } from 'react'
import { useApp } from '../store'
import { Icon } from './Icon'

export function Toasts(): ReactElement {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)
  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            className="toast"
            data-kind={t.kind}
            initial={{ opacity: 0, x: 60, scale: 0.92 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 60, scale: 0.9, transition: { duration: 0.25 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            onClick={() => dismiss(t.id)}
          >
            <span className="toast__icon">
              <Icon name={t.kind === 'success' ? 'check' : t.kind === 'error' ? 'alert' : t.kind === 'warn' ? 'alert' : 'info'} size={16} />
            </span>
            <span>{t.text}</span>
            <span className="toast__bar" />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export function Modal({ open, onClose, title, children, actions }: { open: boolean; onClose: () => void; title: string; children: ReactNode; actions: ReactNode }): ReactElement {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
          <motion.div className="modal" role="dialog" aria-modal="true" aria-label={title} initial={{ opacity: 0, y: 24, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.97 }} transition={{ type: 'spring', stiffness: 380, damping: 30 }}>
            <h2 className="modal__title">{title}</h2>
            <div className="modal__text">{children}</div>
            <div className="modal__actions">{actions}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
