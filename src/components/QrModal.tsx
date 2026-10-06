import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState, type ReactElement } from 'react'
import { vpn } from '../store'
import { Icon } from './Icon'
import { Modal } from './Overlays'

export interface QrTarget {
  kind: 'server' | 'subscription'
  id: string
  name: string
}

type Stage = { s: 'warn' } | { s: 'loading' } | { s: 'shown'; dataUrl: string } | { s: 'error'; message: string }

/** Ключ в виде QR-кода. Сначала предупреждение, и только по нажатию — сам код; через полторы минуты он прячется снова. */
export function QrModal({ target, onClose }: { target: QrTarget | null; onClose: () => void }): ReactElement {
  const [stage, setStage] = useState<Stage>({ s: 'warn' })
  useEffect(() => { setStage({ s: 'warn' }) }, [target?.id, target?.kind])
  useEffect(() => {
    if (stage.s !== 'shown') return
    const t = setTimeout(() => setStage({ s: 'warn' }), 90_000)
    return () => clearTimeout(t)
  }, [stage])

  const show = async (): Promise<void> => {
    if (!target) return
    setStage({ s: 'loading' })
    const r = await vpn().getQr(target.kind, target.id)
    setStage(r.ok && r.dataUrl ? { s: 'shown', dataUrl: r.dataUrl } : { s: 'error', message: r.message ?? 'Не удалось построить QR-код.' })
  }
  const what = target?.kind === 'subscription' ? 'подписки' : 'ключа'

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={`QR-код ${what}`}
      actions={
        stage.s === 'shown' || stage.s === 'error'
          ? <button className="btn btn--primary" onClick={onClose}>Закрыть</button>
          : (
            <>
              <button className="btn btn--ghost" onClick={onClose}>Не надо</button>
              <button className="btn btn--primary" disabled={stage.s === 'loading'} onClick={() => void show()}>
                {stage.s === 'loading' ? <span className="spinner" /> : <Icon name="qr" size={17} />} Показать код
              </button>
            </>
          )
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        {stage.s === 'shown' ? (
          <motion.div key="shown" className="qr" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ type: 'spring', stiffness: 320, damping: 26 }}>
            <div className="qr__frame"><img className="qr__img" src={stage.dataUrl} alt={`QR-код: ${target?.name ?? ''}`} width={240} height={240} /></div>
            <div className="qr__name">{target?.name}</div>
            <p>Наведите камеру телефона или откройте в приложении VPN пункт «Сканировать QR». Код сам спрячется через полторы минуты.</p>
          </motion.div>
        ) : stage.s === 'error' ? (
          <motion.p key="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{stage.message}</motion.p>
        ) : (
          <motion.div key="warn" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <p>В этом коде — {target?.kind === 'subscription' ? 'ссылка на вашу подписку' : 'ваш ключ'} целиком. Любой, кто его отсканирует, сможет пользоваться вашим доступом.</p>
            <p style={{ marginTop: 10 }}>Показывайте его только тем, кому доверяете (например, жене для её телефона). Не публикуйте и не отправляйте снимок экрана.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </Modal>
  )
}
