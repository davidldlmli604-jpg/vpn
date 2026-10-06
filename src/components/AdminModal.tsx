import { useState, type ReactElement } from 'react'
import { useApp, vpn } from '../store'
import { Icon } from './Icon'
import { Modal } from './Overlays'

/** Объяснение, зачем режиму «Весь компьютер» права администратора, и запрос разрешения (Windows спросит один раз). */
export function AdminModal({ open, onClose, onAllowed }: { open: boolean; onClose: () => void; onAllowed?: () => void }): ReactElement {
  const pushToast = useApp((s) => s.pushToast)
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title="Нужно разрешение администратора"
      actions={
        <>
          <button className="btn btn--ghost" disabled={busy} onClick={onClose}>Не сейчас</button>
          <button
            className="btn btn--primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const r = await vpn().requestTunMode()
                pushToast({ kind: r.ok ? 'success' : 'warn', text: r.message })
                if (r.ok) onAllowed?.()
                if (!r.relaunching) onClose()
              } finally { setBusy(false) }
            }}
          >
            {busy ? <span className="spinner" /> : <Icon name="shield-check" size={17} />} Разрешить
          </button>
        </>
      }
    >
      <p>Режим «Весь компьютер» пускает через VPN <b>весь интернет</b> — даже программы и игры, которые ничего не знают про VPN. Чтобы Windows это позволила, программа должна работать с правами администратора.</p>
      <p style={{ marginTop: 10 }}>Windows спросит <b>один раз</b>. Дальше программа будет запускаться сама, без вопросов. Ваши файлы и пароли это не затрагивает, а разрешение можно забрать в «Настройках».</p>
    </Modal>
  )
}
