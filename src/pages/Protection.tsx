import { motion } from 'framer-motion'
import type { ReactElement } from 'react'
import { Icon } from '../components/Icon'
import { Setting, Toggle } from '../components/controls'
import { useApp, vpn } from '../store'

export function Protection(): ReactElement {
  const app = useApp((s) => s.app)!
  const setPage = useApp((s) => s.setPage)
  const pushToast = useApp((s) => s.pushToast)
  const { settings, system, conn } = app
  const set = (patch: Parameters<ReturnType<typeof vpn>['updateSettings']>[0]): void => void vpn().updateSettings(patch)
  const tun = settings.mode === 'tun'
  const on = settings.killSwitch
  const holding = conn.blocked

  let title = 'Защита от обрыва выключена'
  let sub = 'Если VPN оборвётся, интернет продолжит работать напрямую — с вашим настоящим адресом.'
  if (holding) { title = 'Защита держит интернет закрытым'; sub = 'Связь с VPN пропала. Пока он не вернётся, ничего не уходит в сеть напрямую.' }
  else if (on && tun) { title = 'Защита включена'; sub = 'Если VPN оборвётся, интернет на всём компьютере отключится, пока связь не вернётся.' }
  else if (on) { title = 'Защита включена частично'; sub = 'Работает для браузеров и программ, которые используют системный прокси. Для всего компьютера выберите режим «Весь компьютер».' }

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">Защита</h1>
          <p className="page__lead">Что делать, если VPN оборвётся, и как не выдать свой настоящий адрес.</p>
        </div>
      </div>

      <motion.div className="glass protect" data-state={holding ? 'holding' : on ? (tun ? 'on' : 'part') : 'off'} data-hint="Здесь видно, защищены ли вы сейчас от обрыва VPN. Зелёный щит — защита включена, жёлтый — работает частично, серый — выключена." initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
        <div className="protect__shield">
          <span className="protect__ring" /><span className="protect__ring protect__ring--2" />
          <Icon name={on || holding ? 'shield-check' : 'shield'} size={34} strokeWidth={1.7} />
        </div>
        <div>
          <div className="protect__title">{title}</div>
          <div className="protect__sub">{sub}</div>
        </div>
      </motion.div>

      <section className="section">
        <h2 className="section__title">Если VPN оборвётся</h2>
        <div className="glass card">
          <Setting
            name="Отключить интернет, если VPN оборвался"
            tech="аварийная блокировка, kill switch"
            hint="Пока VPN не вернётся, интернет закрыт — ничего не уйдёт в сеть с вашим настоящим адресом. Когда связь восстановится, интернет откроется сам."
            help="Это защита на случай обрыва. Если VPN вдруг пропадёт, обычно программы начинают ходить в интернет напрямую — и сайты видят ваш настоящий адрес. С этой защитой интернет просто замолчит, пока VPN не вернётся. Для всего компьютера нужен режим «Весь компьютер»."
          >
            <Toggle label="Отключить интернет, если VPN оборвался" checked={on} onChange={(v) => set({ killSwitch: v })} />
          </Setting>
          {on && (
            <div className="note" style={{ marginTop: 0, marginBottom: 6 }}>
              <Icon name="info" size={17} />
              {tun ? (
                system.platform === 'win32'
                  ? <span><b>Весь компьютер.</b> Пока VPN работает или переподключается, программа на время закрывает остальной выход в сеть правилами брандмауэра Windows (разрешены только сама программа, туннель и домашняя сеть). При выключении VPN и при выходе из программы всё возвращается как было.</span>
                  : <span>Правила сети меняются только в Windows. На этой системе защита для режима «Весь компьютер» не работает.</span>
              ) : (
                <span>
                  <b>Браузер и программы.</b> Сейчас защита закрывает интернет только браузерам и программам, которые используют системный прокси. Игры и остальные программы она не остановит. Чтобы защитить весь компьютер, выберите режим «Весь компьютер».{' '}
                  <button className="link" onClick={() => setPage('home')}>Выбрать режим</button>
                </span>
              )}
            </div>
          )}
          <Setting name="Переподключаться при обрыве" tech="автопереподключение" hint="Если связь пропала, программа сама попробует подключиться снова — с нарастающими паузами, пока вы не нажмёте «Выключить». Лучше оставить включённым.">
            <Toggle label="Переподключаться при обрыве" checked={settings.autoReconnect} onChange={(v) => set({ autoReconnect: v })} />
          </Setting>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">Адреса сайтов</h2>
        <div className="glass card">
          <Setting
            name="Защита от утечки DNS"
            tech="DNS"
            hint="Адреса сайтов ищутся через VPN, а не через вашего интернет-провайдера: он не увидит список сайтов, которые вы открываете. Лучше держать включённым."
            help="Когда вы открываете сайт, компьютер сначала спрашивает у «телефонной книги» (DNS), где он находится. Если спрашивать у провайдера, он узнает, какие сайты вы открываете, даже при включённом VPN. С этой защитой такие вопросы идут через VPN."
          >
            <Toggle label="Защита от утечки DNS" checked={settings.dnsLeakProtection} onChange={(v) => set({ dnsLeakProtection: v })} />
          </Setting>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">Если пропал интернет</h2>
        <div className="glass card protect__rescue">
          <div>
            <div className="card__title">Починить интернет</div>
            <p className="card__hint">Выключит VPN, снимет защиту и вернёт обычные настройки сети. Нужна, если после сбоя интернета нет совсем — например, защита закрыла его, а VPN не вернулся.</p>
          </div>
          <button className="btn btn--ghost" data-hint="Аварийная кнопка: выключает VPN и снимает всё, что программа меняла в сети (защиту и системный прокси). После неё интернет работает как до программы." onClick={async () => { const r = await vpn().recoverInternet(); pushToast({ kind: r.ok ? 'success' : 'warn', text: r.message }) }}>
            <Icon name="shield-check" size={18} /> Починить интернет
          </button>
        </div>
      </section>
    </div>
  )
}
