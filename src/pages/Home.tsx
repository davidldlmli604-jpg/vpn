import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState, type ReactElement } from 'react'
import type { ConnStatus } from '@shared/types'
import { CheckCard } from '../components/CheckCard'
import { Flag } from '../components/Flag'
import { Icon } from '../components/Icon'
import { Particles } from '../components/Particles'
import { PowerButton } from '../components/PowerButton'
import { RollingNumber } from '../components/RollingNumber'
import { SpeedChart } from '../components/SpeedChart'
import { Segmented, spotlight } from '../components/controls'
import { AdminModal } from '../components/AdminModal'
import { MobileBuddy } from '../components/MobileBuddy'
import { countryName, formatDuration, latencyClass, protocolLabel, splitBytes } from '../lib/format'
import { useApp, vpn } from '../store'

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

const MODE_HINT = {
  proxy: 'Через VPN пойдут браузеры и программы, которые это умеют. Остальные работают как обычно. Админ-права не нужны.',
  tun: 'Через VPN пойдёт весь интернет на компьютере, включая игры и программы без настроек. Нужно разрешение администратора.'
}

function powerHint(status: ConnStatus, noServers: boolean): string {
  if (noServers && status === 'off') return 'Сначала нужен ключ. Скопируйте его (то, что вам прислали), а потом нажмите сюда — я возьму ключ из буфера обмена и сразу подключу.'
  switch (status) {
    case 'connecting': return 'Идёт подключение. Если передумали — нажмите, и я остановлюсь.'
    case 'on': return 'Всё работает: интернет идёт через VPN. Нажмите, чтобы выключить — всё вернётся как было.'
    case 'error': return 'Не вышло. Нажмите, чтобы попробовать ещё раз. Что пошло не так — написано над кнопкой.'
    case 'disconnecting': return 'Секунду, отключаюсь…'
    default: return 'Большая кнопка. Нажмите — интернет пойдёт через VPN. Нажмите ещё раз — вернётся всё как было.'
  }
}

export function Home(): ReactElement {
  const app = useApp((s) => s.app)!
  const history = useApp((s) => s.history)
  const setPage = useApp((s) => s.setPage)
  const pushToast = useApp((s) => s.pushToast)
  const { conn, exit, servers, settings, check } = app
  const status: ConnStatus = conn.status
  const now = useNow(status === 'on')
  const server = servers.find((s) => s.id === conn.serverId) ?? servers.find((s) => s.id === settings.selectedServerId) ?? null
  const last = history[history.length - 1]
  const noServers = servers.length === 0
  const [askAdmin, setAskAdmin] = useState(false)
  // Телефон: режим один (весь трафик через VPN), ключ — из буфера обмена или QR-кодом камерой
  const mobile = app.system.platform === 'android'
  const addKey = async (how: 'paste' | 'scan'): Promise<void> => {
    const api = vpn()
    const r = how === 'scan' && api.scanQr ? await api.scanQr() : await api.pasteKey()
    if (!r.ok && r.message === 'Сканирование отменено.') return
    pushToast({ kind: r.ok ? 'success' : 'error', text: r.message })
  }

  const onPower = async (): Promise<void> => {
    if (noServers && status === 'off') {
      const r = await vpn().pasteKey()
      pushToast({ kind: r.ok ? 'success' : 'error', text: r.message })
      if (r.ok) await vpn().connect(r.firstId ?? undefined)
      return
    }
    if (status === 'off' || status === 'error') await vpn().connect()
    else if (status === 'on' || status === 'connecting') await vpn().disconnect()
  }

  let title = 'Выключено'
  let sub: ReactElement | string = server ? <>Сервер: <b>{server.name}</b></> : 'Вставьте ключ — и всё заработает'
  if (noServers && status === 'off') { title = 'Нужен ключ'; sub = 'Скопируйте ключ, который вам прислали, и нажмите большую кнопку' }
  if (status === 'connecting') {
    title = conn.reconnect ? 'Связь оборвалась' : 'Подключаюсь'
    sub = conn.reconnect ? `Пробую подключиться снова (попытка ${conn.reconnect.attempt})` : 'Обычно это занимает несколько секунд'
    if (conn.reconnect && conn.blocked) sub = `Интернет отключён защитой, пока VPN не вернётся. Пробую снова (попытка ${conn.reconnect.attempt})`
  }
  if (status === 'on') {
    title = conn.degraded ? 'Нет связи с сервером' : 'Работает'
    sub = conn.degraded ? 'Сервер перестал отвечать. Интернет через VPN сейчас может не открываться.' : <>Вы подключены через <b>{server?.name ?? 'сервер'}</b></>
  }
  if (status === 'error') { title = conn.error?.title ?? 'Не получилось'; sub = conn.error?.text ?? '' }
  if (status === 'disconnecting') { title = 'Отключаю'; sub = '' }

  const speed = last ?? { downBps: 0, upBps: 0, upTotal: 0, downTotal: 0, latencyMs: null }
  const dn = splitBytes(speed.downBps, true)
  const up = splitBytes(speed.upBps, true)
  const totalDown = splitBytes(speed.downTotal)
  const totalUp = splitBytes(speed.upTotal)
  const uptime = conn.since && status === 'on' ? now - conn.since : 0
  const latency = speed.latencyMs

  return (
    <div className="home" data-state={status}>
      <div className="hero">
        {mobile && <MobileBuddy status={status} noServers={noServers} />}
        <Particles status={status} />
        <div className="hero__status" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={title + status} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.28 }}>
              <h1 className="hero__title" style={status === 'on' && !conn.degraded ? { color: 'var(--ok)' } : status === 'error' || conn.degraded ? { color: 'var(--danger)' } : undefined}>
                {status === 'on' && !conn.degraded && <Icon name="check" size={26} style={{ verticalAlign: -3, marginRight: 8 }} />}
                {title}
                {(status === 'connecting' || status === 'disconnecting') && <span className="dots" />}
              </h1>
              <p className="hero__sub">{sub}</p>
            </motion.div>
          </AnimatePresence>
        </div>
        <div data-hint={powerHint(status, noServers)}>
          <PowerButton status={status} onClick={() => void onPower()} noServers={noServers} />
        </div>
        {conn.blocked && (
          <div className="blocked-note" role="status" data-hint="Защита сработала: связь с VPN пропала, и она намеренно держит интернет закрытым, чтобы ничего не ушло мимо VPN. Откроется само, когда VPN вернётся.">
            <Icon name="shield-check" size={18} />
            <span>Защита держит интернет закрытым, пока VPN не вернётся. Нужен интернет без VPN — «Защита» → «Починить интернет».</span>
          </div>
        )}
        {mobile ? (
          <div className="addkey">
            <button className="btn btn--ghost addkey__btn" data-hint="Скопируйте ключ, который вам прислали (долгое нажатие на текст → «Копировать»), и нажмите сюда — я возьму его из буфера обмена." onClick={() => void addKey('paste')}>
              <Icon name="download" size={18} /> Вставить ключ
            </button>
            <button className="btn btn--ghost addkey__btn" data-hint="Ключ в виде QR-кода (на экране компьютера или на картинке)? Нажмите и наведите камеру на код." onClick={() => void addKey('scan')}>
              <Icon name="qr" size={18} /> Сканировать QR
            </button>
          </div>
        ) : (
        <div className="mode">
          <Segmented
            label="Режим работы"
            value={settings.mode}
            onChange={(m) => {
              if (m === settings.mode) return
              if (m === 'proxy' || app.system.isAdmin) void vpn().updateSettings({ mode: m })
              else setAskAdmin(true)
            }}
            items={[
              { value: 'proxy', title: 'Браузер и программы', tech: 'системный прокси', icon: 'browser', hint: 'Режим «Браузер и программы»: через VPN идут браузеры и программы, которые это умеют. Остальные работают как обычно. Права администратора не нужны.' },
              { value: 'tun', title: 'Весь компьютер', tech: 'туннель, TUN', icon: 'monitor', hint: 'Режим «Весь компьютер»: через VPN идёт вообще весь интернет, включая игры и программы без настроек. Нужно разрешение администратора — Windows спросит один раз.' }
            ]}
          />
          <p className="mode__hint">{MODE_HINT[settings.mode]}</p>
        </div>
        )}
      </div>

      <div className="stack">
        {server ? (
          <div data-hint="Выбранный сервер — через него идёт интернет. Нажмите, чтобы открыть список серверов и выбрать другой." className="glass glass--spot server-hero" onMouseMove={spotlight} onClick={() => setPage('servers')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setPage('servers')}>
            <Flag code={server.countryCode} size={38} />
            <div className="server-hero__text">
              <div className="server-hero__name">{server.name}</div>
              <div className="server-hero__meta">
                <span>{countryName(server.countryCode)}</span>
                <span className="badge">{protocolLabel(server.protocol)}</span>
              </div>
            </div>
            <Icon name="chevron" style={{ color: 'var(--faint)' }} />
          </div>
        ) : (
          <div className="glass server-hero" style={{ cursor: 'default' }}>
            <Flag code={null} size={38} />
            <div className="server-hero__text">
              <div className="server-hero__name">Сервер не выбран</div>
              <div className="server-hero__meta">{mobile ? 'Вставьте ключ или отсканируйте QR-код' : 'Добавьте ключ на вкладке «Серверы»'}</div>
            </div>
          </div>
        )}

        <div className="tiles">
          <div className="tile" data-hint="Задержка — сколько миллисекунд проходит, пока сигнал доберётся до сервера и вернётся. Чем меньше число, тем отзывчивее интернет. До 150 мс — отлично.">
            <div className="tile__label"><Icon name="bolt" size={14} /> Задержка</div>
            <div className={`tile__value ${status === 'on' ? latencyClass(latency) : ''}`}>
              {status === 'on' && latency !== null ? <RollingNumber value={latency} format={(v) => String(Math.round(v))} /> : '—'}
              <span className="tile__unit">мс</span>
            </div>
            <div className="tile__sub">{status === 'on' ? (latency === null ? 'нет ответа' : latency < 150 ? 'отлично' : latency < 400 ? 'нормально' : 'медленно') : 'до сервера'}</div>
          </div>
          <div className="tile" data-hint="Скорость — сколько данных сейчас скачивается за секунду. Ниже — сколько отправляется в обратную сторону.">
            <div className="tile__label"><Icon name="download" size={14} /> Скорость</div>
            <div className="tile__value">
              <RollingNumber value={status === 'on' ? speed.downBps : 0} format={(v) => splitBytes(v, true).value} />
              <span className="tile__unit">{dn.unit}</span>
            </div>
            <div className="tile__sub">отдача: {up.value} {up.unit}</div>
          </div>
          <div className="tile" data-hint="Сколько времени VPN работает без перерыва.">
            <div className="tile__label"><Icon name="clock" size={14} /> Время работы</div>
            <div className="tile__value">{status === 'on' ? formatDuration(uptime) : '—'}</div>
            <div className="tile__sub">с момента включения</div>
          </div>
          <div className="tile" data-hint="Сколько всего данных прошло через программу с момента включения: скачано и отправлено.">
            <div className="tile__label"><Icon name="upload" size={14} /> Скачано</div>
            <div className="tile__value">
              <RollingNumber value={status === 'on' ? speed.downTotal : 0} format={(v) => splitBytes(v).value} />
              <span className="tile__unit">{totalDown.unit}</span>
            </div>
            <div className="tile__sub">отправлено: {totalUp.value} {totalUp.unit}</div>
          </div>
        </div>

        <div className="glass chart-card" data-hint="График скорости за последнюю минуту. Бирюзовая линия — загрузка, фиолетовая — отдача. Пики — когда что-то скачивается.">
          <div className="chart-card__head">
            <span className="card__title">Скорость сейчас</span>
            <span className="chart-card__legend">
              <span><i style={{ background: 'var(--accent)' }} />Загрузка</span>
              <span><i style={{ background: 'var(--accent-2)' }} />Отдача</span>
            </span>
          </div>
          <SpeedChart history={history} active={status === 'on'} />
        </div>

        <div className="exit" aria-live="polite" data-hint="Так вас сейчас видят сайты в интернете. Если здесь не ваша страна — VPN работает.">
          <Icon name="globe" style={{ color: 'var(--accent)', flex: 'none' }} />
          <div className="exit__col">
            <span className="exit__label">Ваш адрес сейчас виден как:</span>
            <AnimatePresence mode="wait" initial={false}>
              {status !== 'on' ? (
                <motion.span key="off" className="exit__value exit__value--dim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>ваш настоящий адрес</motion.span>
              ) : exit.checking || (!exit.countryCode && !exit.error) ? (
                <motion.span key="chk" className="exit__value" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><span className="shimmer" /></motion.span>
              ) : exit.error ? (
                <motion.span key="err" className="exit__value exit__value--dim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>не удалось определить</motion.span>
              ) : (
                <motion.span key="ok" className="exit__value" initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 24 }}>
                  <Flag code={exit.countryCode} size={20} /> {exit.countryName ?? countryName(exit.countryCode)}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>

        {status === 'on' && !conn.degraded && !mobile && <CheckCard report={check} />}
      </div>
      <AdminModal open={askAdmin} onClose={() => setAskAdmin(false)} />
    </div>
  )
}
