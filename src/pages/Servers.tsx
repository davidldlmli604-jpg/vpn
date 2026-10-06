import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { ServerView, SubscriptionView } from '@shared/types'
import { Flag } from '../components/Flag'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Overlays'
import { QrModal, type QrTarget } from '../components/QrModal'
import { Chips, spotlight } from '../components/controls'
import { countryName, formatAgo, formatBytes, formatDate, latencyClass, plural, protocolLabel } from '../lib/format'
import { useApp, vpn } from '../store'

const LAT_HINT = 'Задержка до сервера: сколько миллисекунд идёт сигнал туда и обратно. Чем меньше число, тем лучше.'
function Latency({ v }: { v: ServerView['latency'] }): ReactElement | null {
  if (v === null) return null
  if (v === 'testing') return <span className="badge" data-hint={LAT_HINT}><span className="spinner" style={{ width: 11, height: 11 }} /> проверяю</span>
  if ('error' in v) return <span className="badge latency-bad" data-hint="Сервер не ответил. Возможно, он выключен или ключ устарел.">не отвечает</span>
  return <span className={`badge ${latencyClass(v.ms)}`} data-hint={LAT_HINT}><Icon name="bolt" size={12} /> {v.ms} мс</span>
}

function ServerCard({ s, selected, active, subName, onAskDelete, onQr }: { s: ServerView; selected: boolean; active: boolean; subName: string | null; onAskDelete: (s: ServerView) => void; onQr: (t: QrTarget) => void }): ReactElement {
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(s.name)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (renaming) input.current?.select() }, [renaming])
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])
  const commit = (): void => {
    setRenaming(false)
    if (name.trim() && name.trim() !== s.name) void vpn().renameServer(s.id, name.trim())
    else setName(s.name)
  }
  return (
    <motion.div
      layout
      className="glass glass--spot server"
      data-hint={selected ? 'Этот сервер выбран. Интернет идёт (или пойдёт после включения) через него.' : 'Нажмите на карточку, чтобы выбрать этот сервер. Если VPN уже включён, он переключится сам.'}
      data-selected={selected}
      onMouseMove={spotlight}
      onClick={() => !renaming && void vpn().selectServer(s.id)}
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.88, transition: { duration: 0.25 } }}
      transition={{ type: 'spring', stiffness: 340, damping: 30 }}
    >
      {selected && (
        <motion.span className="server__check" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }}>
          <Icon name="check" size={15} strokeWidth={3} />
        </motion.span>
      )}
      <div className="server__top">
        <Flag code={s.countryCode} size={36} />
        <div className="server__title">
          {renaming ? (
            <input ref={input} className="rename" value={name} onChange={(e) => setName(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setName(s.name); setRenaming(false) } }} onClick={(e) => e.stopPropagation()} maxLength={80} />
          ) : (
            <div className="server__name">{s.name}</div>
          )}
          <div className="server__meta" style={{ marginTop: 4 }}>
            <span className="tech">{s.countryCode ? countryName(s.countryCode) : 'страна неизвестна'}</span>
          </div>
        </div>
      </div>
      <div className="server__meta">
        <span className="badge">{protocolLabel(s.protocol)}</span>
        <Latency v={s.latency} />
        {active && <span className="badge" style={{ color: 'var(--ok)' }}><span className="mini-status__dot" style={{ width: 7, height: 7, background: 'var(--ok)' }} /> подключён</span>}
        {subName && <span className="badge" data-hint={`Этот сервер пришёл из подписки «${subName}». Список обновляется сам: новые серверы появляются, ненужные пропадают.`}><Icon name="link" size={12} /> {subName}</span>}
        {s.warnings.length > 0 && <span className="badge" data-hint="У этого ключа есть замечание: часть его настроек программа не поддерживает. Сервер может не заработать." style={{ color: 'var(--warn)' }} title={s.warnings.join(' ')}><Icon name="alert" size={12} /> есть замечание</span>}
      </div>
      <div className="server__actions" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn star" data-hint="Звёздочка: любимые серверы поднимаются в начало списка." data-on={s.favorite} aria-label={s.favorite ? 'Убрать из любимых' : 'В любимые'} onClick={() => void vpn().toggleFavorite(s.id)}>
          <motion.span whileTap={{ scale: 1.5, rotate: 20 }} style={{ display: 'grid' }}><Icon name="star" fill={s.favorite ? 'currentColor' : 'none'} /></motion.span>
        </button>
        <button className="icon-btn" data-hint="Проверить задержку только этого сервера: покажет, насколько быстро он отвечает." aria-label="Проверить задержку" disabled={s.latency === 'testing'} onClick={() => void vpn().pingServers([s.id])}>
          {s.latency === 'testing' ? <span className="spinner" style={{ width: 15, height: 15 }} /> : <Icon name="bolt" size={18} />}
        </button>
        <span className="tech server__host">{s.host}</span>
        <div style={{ position: 'relative' }}>
          <button className="icon-btn" aria-label="Действия" data-hint="Дополнительные действия: переименовать сервер или удалить его из списка." onMouseDown={(e) => e.stopPropagation()} onClick={() => setMenu((v) => !v)}><Icon name="more" /></button>
          <AnimatePresence>
            {menu && (
              <motion.div className="ctx-menu" style={{ right: 0, top: 38 }} initial={{ opacity: 0, y: -6, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} onMouseDown={(e) => e.stopPropagation()}>
                {s.canQr && <button onClick={() => { setMenu(false); onQr({ kind: 'server', id: s.id, name: s.name }) }}><Icon name="qr" size={17} /> Показать QR-код</button>}
                <button onClick={() => { setMenu(false); setRenaming(true) }}><Icon name="edit" size={17} /> Переименовать</button>
                <button className="danger" onClick={() => { setMenu(false); onAskDelete(s) }}><Icon name="trash" size={17} /> Удалить</button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}


function UsageMeter({ info }: { info: NonNullable<SubscriptionView['info']> }): ReactElement | null {
  const used = (info.upload ?? 0) + (info.download ?? 0)
  const total = info.total ?? 0
  const parts: string[] = []
  if (total > 0) parts.push(`использовано ${formatBytes(used)} из ${formatBytes(total)}`)
  else if (used > 0) parts.push(`использовано ${formatBytes(used)}`)
  if (info.expireAt) parts.push(info.expireAt < Date.now() ? `срок закончился ${formatDate(info.expireAt)}` : `действует до ${formatDate(info.expireAt)}`)
  if (parts.length === 0) return null
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0
  return (
    <div className="sub__usage" data-hint="Сколько трафика по вашему тарифу уже потрачено и до какого числа подписка действует. Эти данные присылает поставщик VPN.">
      {total > 0 && (
        <div className="meter" data-level={pct > 90 ? 'high' : pct > 70 ? 'mid' : 'low'}>
          <motion.i initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
        </div>
      )}
      <span>{parts.join(' · ')}</span>
    </div>
  )
}

function SubscriptionCard({ sub, onAskDelete, onQr }: { sub: SubscriptionView; onAskDelete: (s: SubscriptionView) => void; onQr: (t: QrTarget) => void }): ReactElement {
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(sub.name)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (renaming) input.current?.select() }, [renaming])
  useEffect(() => { setName(sub.name) }, [sub.name])
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])
  const commit = (): void => {
    setRenaming(false)
    if (name.trim() && name.trim() !== sub.name) void vpn().renameSubscription(sub.id, name.trim())
    else setName(sub.name)
  }
  return (
    <motion.div layout className="glass sub" data-hint="Подписка — это ссылка, по которой поставщик VPN сам присылает свежий список серверов. Программа обновляет её сама, вам ничего делать не нужно." initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.2 } }} transition={{ type: 'spring', stiffness: 340, damping: 30 }}>
      <div className="sub__icon"><Icon name="link" size={20} /></div>
      <div className="sub__body">
        {renaming ? (
          <input ref={input} className="rename" value={name} onChange={(e) => setName(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setName(sub.name); setRenaming(false) } }} maxLength={80} />
        ) : (
          <div className="sub__name">{sub.name}</div>
        )}
        <div className="sub__meta">
          <span>{sub.serverCount} {plural(sub.serverCount, 'сервер', 'сервера', 'серверов')}</span>
          <span className="sub__dot" />
          <span>{sub.refreshing ? 'обновляется…' : `обновлена ${formatAgo(sub.updatedAt)}`}</span>
          <span className="tech">{sub.displayUrl}</span>
        </div>
        {sub.error && (
          <div className="sub__error" data-hint="Последняя попытка обновить подписку не удалась. Серверы остались прежними. Программа попробует позже сама, а можно нажать кнопку обновления.">
            <Icon name="alert" size={14} /> {sub.error}
          </div>
        )}
        {sub.info && <UsageMeter info={sub.info} />}
      </div>
      <div className="sub__actions">
        <button
          className="icon-btn"
          data-hint="Обновить список серверов из этой подписки прямо сейчас. Названия и «любимые» сохранятся."
          aria-label="Обновить подписку"
          disabled={sub.refreshing}
          onClick={() => void vpn().refreshSubscription(sub.id)}
        >
          <motion.span style={{ display: 'grid' }} animate={sub.refreshing ? { rotate: 360 } : { rotate: 0 }} transition={sub.refreshing ? { repeat: Infinity, duration: 0.9, ease: 'linear' } : { duration: 0.3 }}><Icon name="refresh" size={19} /></motion.span>
        </button>
        <div style={{ position: 'relative' }}>
          <button className="icon-btn" aria-label="Действия с подпиской" data-hint="Дополнительные действия: показать QR-код подписки, переименовать её или удалить." onMouseDown={(e) => e.stopPropagation()} onClick={() => setMenu((v) => !v)}><Icon name="more" /></button>
          <AnimatePresence>
            {menu && (
              <motion.div className="ctx-menu" style={{ right: 0, top: 38 }} initial={{ opacity: 0, y: -6, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} onMouseDown={(e) => e.stopPropagation()}>
                <button onClick={() => { setMenu(false); onQr({ kind: 'subscription', id: sub.id, name: sub.name }) }}><Icon name="qr" size={17} /> Показать QR-код</button>
                <button onClick={() => { setMenu(false); setRenaming(true) }}><Icon name="edit" size={17} /> Переименовать</button>
                <button className="danger" onClick={() => { setMenu(false); onAskDelete(sub) }}><Icon name="trash" size={17} /> Удалить</button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}

function EmptyArt(): ReactElement {
  return (
    <svg className="empty__art" viewBox="0 0 140 110" fill="none" aria-hidden="true">
      <defs><linearGradient id="ea" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--accent)" /><stop offset="1" stopColor="var(--accent-2)" /></linearGradient></defs>
      <motion.path d="M10 90 C 40 90, 30 40, 70 50 S 110 20, 130 24" stroke="url(#ea)" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 9" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.6, ease: 'easeInOut' }} />
      <motion.g animate={{ y: [0, -6, 0] }} transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}>
        <circle cx="70" cy="50" r="22" stroke="url(#ea)" strokeWidth="3.5" />
        <circle cx="62" cy="50" r="6" fill="url(#ea)" />
        <path d="M68 50h22M82 50v8M90 50v6" stroke="url(#ea)" strokeWidth="3.5" strokeLinecap="round" />
      </motion.g>
      <motion.circle cx="130" cy="24" r="6" fill="url(#ea)" animate={{ scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }} transition={{ duration: 2, repeat: Infinity }} />
    </svg>
  )
}

type Sort = 'added' | 'speed'
let sortChoice: Sort = 'added' // выбор помнится, пока программа открыта
let autoChecked = false // автоматическая проверка задержки при первом открытии страницы — один раз за запуск

const latencyRank = (v: ServerView['latency']): number => (v && typeof v === 'object' && 'ms' in v ? v.ms : v && typeof v === 'object' ? 1e9 : 1e8)

export function Servers(): ReactElement {
  const app = useApp((s) => s.app)!
  const pushToast = useApp((s) => s.pushToast)
  const [toDelete, setToDelete] = useState<ServerView | null>(null)
  const [subToDelete, setSubToDelete] = useState<SubscriptionView | null>(null)
  const [qr, setQr] = useState<QrTarget | null>(null)
  const [busy, setBusy] = useState(false)
  const [sort, setSortState] = useState<Sort>(sortChoice)
  const setSort = (v: Sort): void => { sortChoice = v; setSortState(v) }
  const { servers, subscriptions, settings, conn } = app
  const testing = servers.some((s) => s.latency === 'testing')

  // при первом заходе сами проверяем, кто отвечает быстрее — человеку не нужно ничего нажимать
  useEffect(() => {
    if (autoChecked || servers.length === 0 || !servers.some((s) => s.latency === null)) return
    autoChecked = true
    void vpn().pingServers()
  }, [servers])

  const paste = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await vpn().pasteKey()
      pushToast({ kind: r.ok ? 'success' : 'error', text: r.message })
      for (const sk of r.skipped.slice(0, 2)) pushToast({ kind: 'warn', text: sk })
      if (r.ok && r.kind === 'servers') void vpn().pingServers()
    } finally { setBusy(false) }
  }

  const subName = (id: string | null): string | null => (id ? subscriptions.find((x) => x.id === id)?.name ?? null : null)
  const sorted = [...servers].sort((a, b) => {
    const fav = Number(b.favorite) - Number(a.favorite)
    if (fav) return fav
    if (sort === 'speed') return latencyRank(a.latency) - latencyRank(b.latency) || a.addedAt - b.addedAt
    return a.addedAt - b.addedAt
  })

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">Серверы</h1>
          <p className="page__lead">Выберите, через какой сервер пойдёт интернет. Ключ или подписку, которую вам прислали, добавляет кнопка: она сама берёт их из буфера обмена.</p>
        </div>
        <button className="btn btn--primary" data-hint="Берёт из буфера обмена (то, что вы только что скопировали) ключ или ссылку на подписку и добавляет в список. Ничего печатать не нужно. Можно и просто нажать Ctrl+V." onClick={() => void paste()} disabled={busy}>
          {busy ? <span className="spinner" /> : <Icon name="clipboard" size={18} />} Вставить ключ или подписку
        </button>
      </div>

      {subscriptions.length > 0 && (
        <section className="section">
          <h2 className="section__title">Подписки</h2>
          <div className="subs">
            <AnimatePresence mode="popLayout">
              {subscriptions.map((sub) => <SubscriptionCard key={sub.id} sub={sub} onAskDelete={setSubToDelete} onQr={setQr} />)}
            </AnimatePresence>
          </div>
        </section>
      )}

      {servers.length === 0 ? (
        <motion.div className="empty" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}>
          <EmptyArt />
          <div className="empty__title">Здесь пока пусто</div>
          <p className="empty__text">Скопируйте ключ (он начинается с vless://, vmess://, trojan://, ss:// и т. п.) или ссылку на подписку, затем нажмите «Вставить ключ или подписку».</p>
          <button className="btn btn--primary" data-hint="Берёт ключ или ссылку на подписку из буфера обмена и добавляет сервер. Сначала скопируйте то, что вам прислали." onClick={() => void paste()}><Icon name="clipboard" size={18} /> Вставить ключ или подписку</button>
        </motion.div>
      ) : (
        <section className="section">
          <div className="toolbar">
            <h2 className="section__title" style={{ flex: 1 }}>Серверы · {servers.length}</h2>
            <Chips label="Порядок серверов" value={sort} onChange={setSort} items={[
              { value: 'added', title: 'Как добавлены', hint: 'Серверы идут в том порядке, в котором вы их добавляли. Любимые всегда сверху.' },
              { value: 'speed', title: 'Быстрые сверху', icon: 'bolt', hint: 'Серверы с самой маленькой задержкой — сверху. Сначала нажмите «Проверить задержку». Любимые всегда сверху.' }
            ]} />
            <button className="btn btn--ghost btn--sm" disabled={testing} data-hint="Проверяет, насколько быстро отвечает каждый сервер. Занимает несколько секунд, интернет при этом не мешает." onClick={() => void vpn().pingServers()}>
              {testing ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <Icon name="bolt" size={16} />} Проверить задержку
            </button>
          </div>
          <LayoutGroup>
            <motion.div className="servers" layout>
              <AnimatePresence mode="popLayout">
                {sorted.map((s) => (
                  <ServerCard key={s.id} s={s} selected={settings.selectedServerId === s.id} active={conn.status === 'on' && conn.serverId === s.id} subName={subName(s.subscriptionId)} onAskDelete={setToDelete} onQr={setQr} />
                ))}
              </AnimatePresence>
            </motion.div>
          </LayoutGroup>
        </section>
      )}

      <Modal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Удалить сервер?"
        actions={
          <>
            <button className="btn btn--ghost" onClick={() => setToDelete(null)}>Не надо</button>
            <button className="btn btn--danger" onClick={() => { if (toDelete) void vpn().removeServer(toDelete.id); setToDelete(null) }}><Icon name="trash" size={17} /> Удалить</button>
          </>
        }
      >
        {toDelete?.subscriptionId
          ? <>«{toDelete?.name}» пропадёт из списка и больше не будет появляться при обновлении подписки. Вернуть его можно, удалив подписку и добавив её заново.</>
          : <>«{toDelete?.name}» пропадёт из списка вместе с ключом. Чтобы вернуть его, ключ придётся вставить заново.</>}
      </Modal>

      <Modal
        open={!!subToDelete}
        onClose={() => setSubToDelete(null)}
        title="Удалить подписку?"
        actions={
          <>
            <button className="btn btn--ghost" onClick={() => setSubToDelete(null)}>Не надо</button>
            <button className="btn btn--danger" onClick={() => { if (subToDelete) void vpn().removeSubscription(subToDelete.id); setSubToDelete(null) }}><Icon name="trash" size={17} /> Удалить</button>
          </>
        }
      >
        Подписка «{subToDelete?.name}» и все её серверы ({subToDelete?.serverCount}) пропадут из списка. У поставщика подписка останется — её можно добавить снова, вставив ссылку.
      </Modal>

      <QrModal target={qr} onClose={() => setQr(null)} />
    </div>
  )
}
