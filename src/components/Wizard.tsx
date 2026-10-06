import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState, type ReactElement } from 'react'
import brand from '@brand'
import type { Mode } from '@shared/types'
import { useApp, vpn } from '../store'
import { AdminModal } from './AdminModal'
import { Flag } from './Flag'
import { Icon } from './Icon'
import { PowerButton } from './PowerButton'
import { Sheltie } from './Sheltie'
import { Toggle } from './controls'

type Step = 1 | 2 | 3

/** Шаг запоминается: если программа перезапустится с правами администратора, мастер продолжится с того же места. */
const KEY = 'tropa-wizard-step'
function loadStep(): Step {
  try { const v = Number(localStorage.getItem(KEY)); return v === 2 || v === 3 ? v : 1 } catch { return 1 }
}
function saveStep(s: Step | null): void {
  try { if (s) localStorage.setItem(KEY, String(s)); else localStorage.removeItem(KEY) } catch { /* без памяти браузера мастер просто начнётся с первого шага */ }
}

const STEPS = ['Ключ', 'Режим', 'Готово']

function Dots({ step }: { step: Step }): ReactElement {
  return (
    <ol className="wizard__dots" aria-label={`Шаг ${step} из 3`}>
      {STEPS.map((t, i) => (
        <li key={t} data-state={i + 1 < step ? 'done' : i + 1 === step ? 'now' : 'next'}>
          <span className="wizard__dot">{i + 1 < step ? <Icon name="check" size={13} strokeWidth={3} /> : i + 1}</span>
          <span className="wizard__dotname">{t}</span>
        </li>
      ))}
    </ol>
  )
}

export function Wizard(): ReactElement {
  const app = useApp((s) => s.app)!
  const pushToast = useApp((s) => s.pushToast)
  const { servers, settings, conn, system } = app
  const [step, setStepState] = useState<Step>(loadStep)
  const [dir, setDir] = useState(1)
  const [busy, setBusy] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const [askAdmin, setAskAdmin] = useState(false)
  const go = (s: Step): void => { setDir(s > step ? 1 : -1); setStepState(s); saveStep(s) }
  const finish = async (): Promise<void> => { saveStep(null); await vpn().updateSettings({ wizardDone: true }) }
  useEffect(() => { setLastError(null) }, [step])

  const paste = async (): Promise<void> => {
    setBusy(true)
    setLastError(null)
    try {
      const r = await vpn().pasteKey()
      if (r.ok) pushToast({ kind: 'success', text: r.message })
      else setLastError(r.message)
    } finally { setBusy(false) }
  }

  const chooseMode = (m: Mode): void => {
    if (m === settings.mode) return
    if (m === 'proxy' || system.isAdmin) void vpn().updateSettings({ mode: m })
    else { saveStep(3); setAskAdmin(true) }
  }

  const first = servers.find((s) => s.id === settings.selectedServerId) ?? servers[0] ?? null
  const status = conn.status
  const power = async (): Promise<void> => {
    if (status === 'off' || status === 'error') await vpn().connect()
    else if (status === 'on' || status === 'connecting') await vpn().disconnect()
  }

  return (
    <main className="wizard" aria-label="Первый запуск">
      <div className="wizard__top">
        <div className="wizard__brand">Добро пожаловать в «{brand.name}»</div>
        <button className="link wizard__skip" data-hint="Закрыть мастер: всё можно настроить позже на вкладках «Серверы» и «Настройки»." onClick={() => void finish()}>Пропустить</button>
      </div>

      <div className="glass wizard__card">
        <Dots step={step} />
        <div className="wizard__stage">
          <AnimatePresence mode="wait" initial={false} custom={dir}>
            {step === 1 && (
              <motion.section key="s1" className="wizard__step" custom={dir} initial={{ opacity: 0, x: 40 * dir }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 * dir }} transition={{ duration: 0.28 }}>
                <h1 className="wizard__title">Добавьте ключ</h1>
                <p className="wizard__text">Ключ вам прислал поставщик VPN. Это длинная строка, которая начинается с <span className="tech">vless://</span>, <span className="tech">vmess://</span>, <span className="tech">trojan://</span>, <span className="tech">ss://</span> и подобного, — или ссылка на подписку (<span className="tech">https://…</span>). <b>Скопируйте её</b> и нажмите кнопку — печатать ничего не нужно.</p>
                <div className="wizard__actions">
                  <button className="btn btn--primary wizard__big" disabled={busy} data-hint="Берёт ключ или ссылку на подписку из буфера обмена (то, что вы только что скопировали) и добавляет сервер. Можно и просто нажать Ctrl+V." onClick={() => void paste()}>
                    {busy ? <span className="spinner" /> : <Icon name="clipboard" size={20} />} Вставить ключ или подписку
                  </button>
                </div>
                <AnimatePresence initial={false}>
                  {servers.length > 0 && first && (
                    <motion.div key="added" className="wizard__ok" initial={{ opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 360, damping: 26 }}>
                      <span className="wizard__tick"><Icon name="check" size={18} strokeWidth={3} /></span>
                      <Flag code={first.countryCode} size={26} />
                      <div><b>{first.name}</b><div className="tech">{servers.length === 1 ? 'Ключ добавлен' : `Всего серверов: ${servers.length}`}</div></div>
                    </motion.div>
                  )}
                  {lastError && <motion.p key="err" className="wizard__err" role="alert" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{lastError}</motion.p>}
                </AnimatePresence>
                <div className="wizard__nav">
                  <span />
                  <button className={servers.length ? 'btn btn--primary' : 'btn btn--ghost'} onClick={() => go(2)} data-hint={servers.length ? 'Ключ добавлен — идём дальше.' : 'Если ключа пока нет, можно пропустить этот шаг и добавить его позже на вкладке «Серверы».'}>
                    {servers.length ? 'Дальше' : 'У меня пока нет ключа'} <Icon name="chevron" size={17} />
                  </button>
                </div>
              </motion.section>
            )}

            {step === 2 && (
              <motion.section key="s2" className="wizard__step" custom={dir} initial={{ opacity: 0, x: 40 * dir }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 * dir }} transition={{ duration: 0.28 }}>
                <h1 className="wizard__title">Что пускать через VPN?</h1>
                <p className="wizard__text">Выберите, как пользоваться. Это можно поменять в любой момент одним нажатием на главном экране.</p>
                <div className="modecards" role="radiogroup" aria-label="Режим работы">
                  <button className="modecard" role="radio" aria-checked={settings.mode === 'proxy'} onClick={() => chooseMode('proxy')} data-hint="Браузер и программы: проще всего. Через VPN пойдут браузеры и программы, которые умеют работать через прокси. Права администратора не нужны. Хороший выбор для начала.">
                    <span className="modecard__icon"><Icon name="browser" size={26} /></span>
                    <span className="modecard__name">Браузер и программы</span>
                    <span className="badge modecard__badge">Рекомендуем для начала</span>
                    <span className="modecard__text">Через VPN идут браузеры и большинство программ. Остальное работает как обычно. Ничего разрешать не нужно.</span>
                    {settings.mode === 'proxy' && <span className="modecard__tick"><Icon name="check" size={14} strokeWidth={3} /></span>}
                  </button>
                  <button className="modecard" role="radio" aria-checked={settings.mode === 'tun'} onClick={() => chooseMode('tun')} data-hint="Весь компьютер: через VPN идёт вообще всё, включая игры и программы без настроек. Нужно разрешение администратора — Windows спросит один раз.">
                    <span className="modecard__icon"><Icon name="monitor" size={26} /></span>
                    <span className="modecard__name">Весь компьютер</span>
                    <span className="modecard__text">Через VPN идёт вообще всё, включая игры. Нужно разрешение администратора — Windows спросит один раз.</span>
                    {settings.mode === 'tun' && <span className="modecard__tick"><Icon name="check" size={14} strokeWidth={3} /></span>}
                  </button>
                </div>
                <div className="wizard__nav">
                  <button className="btn btn--ghost" onClick={() => go(1)}><Icon name="chevron" size={17} style={{ transform: 'scaleX(-1)' }} /> Назад</button>
                  <button className="btn btn--primary" onClick={() => go(3)}>Дальше <Icon name="chevron" size={17} /></button>
                </div>
              </motion.section>
            )}

            {step === 3 && (
              <motion.section key="s3" className="wizard__step" custom={dir} initial={{ opacity: 0, x: 40 * dir }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 * dir }} transition={{ duration: 0.28 }}>
                <h1 className="wizard__title">{status === 'on' ? 'Всё работает!' : 'Всё готово'}</h1>
                <p className="wizard__text">
                  {servers.length === 0
                    ? 'Ключа пока нет — добавьте его позже на вкладке «Серверы», и всё заработает.'
                    : status === 'on'
                      ? <>Вы подключены через <b>{first?.name}</b>. Дальше достаточно одной большой кнопки на главном экране.</>
                      : 'Нажмите большую кнопку — интернет пойдёт через VPN. Выключить можно тем же нажатием.'}
                </p>
                {servers.length > 0 && (
                  <div className="wizard__power" data-state={status}>
                    <PowerButton status={status} onClick={() => void power()} noServers={false} />
                  </div>
                )}
                <div className="wizard__extras">
                  {system.platform === 'win32' && (
                    <label className="wizard__extra" data-hint="Программа будет сама включаться при входе в Windows и сворачиваться к часам.">
                      <span><b>Запускать вместе с Windows</b><span className="tech"> и прятаться возле часов</span></span>
                      <Toggle label="Запускать вместе с Windows" checked={settings.autostart} onChange={(v) => void vpn().updateSettings({ autostart: v })} />
                    </label>
                  )}
                  <label className="wizard__extra" data-hint="VPN будет сам включаться, как только запустится программа.">
                    <span><b>Подключаться сразу при запуске</b></span>
                    <Toggle label="Подключаться сразу при запуске" checked={settings.connectOnLaunch} onChange={(v) => void vpn().updateSettings({ connectOnLaunch: v })} />
                  </label>
                </div>
                <div className="wizard__buddy">
                  <div className="wizard__dog"><Sheltie mood={status === 'on' ? 'happy' : 'idle'} blinking={false} hop={false} /></div>
                  <p>Я — Шелти. Если что-то непонятно, <b>наведите мышку</b> на любую кнопку, и я расскажу, что она делает.</p>
                </div>
                <div className="wizard__nav">
                  <button className="btn btn--ghost" onClick={() => go(2)}><Icon name="chevron" size={17} style={{ transform: 'scaleX(-1)' }} /> Назад</button>
                  <button className="btn btn--primary" onClick={() => void finish()}>Начать пользоваться <Icon name="check" size={17} /></button>
                </div>
              </motion.section>
            )}
          </AnimatePresence>
        </div>
      </div>
      <AdminModal open={askAdmin} onClose={() => setAskAdmin(false)} />
    </main>
  )
}
