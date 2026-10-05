import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { ServerView } from '@shared/types'
import { Flag } from '../components/Flag'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Overlays'
import { spotlight } from '../components/controls'
import { countryName, latencyClass, protocolLabel } from '../lib/format'
import { useApp, vpn } from '../store'

const LAT_HINT = 'Задержка до сервера: сколько миллисекунд идёт сигнал туда и обратно. Чем меньше число, тем лучше.'
function Latency({ v }: { v: ServerView['latency'] }): ReactElement | null {
  if (v === null) return null
  if (v === 'testing') return <span className="badge" data-hint={LAT_HINT}><span className="spinner" style={{ width: 11, height: 11 }} /> проверяю</span>
  if ('error' in v) return <span className="badge latency-bad" data-hint="Сервер не ответил. Возможно, он выключен или ключ устарел.">не отвечает</span>
  return <span className={`badge ${latencyClass(v.ms)}`} data-hint={LAT_HINT}><Icon name="bolt" size={12} /> {v.ms} мс</span>
}

function ServerCard({ s, selected, active, onAskDelete }: { s: ServerView; selected: boolean; active: boolean; onAskDelete: (s: ServerView) => void }): ReactElement {
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
      exit={{ opacity: 0, scale: 0.88, filter: 'blur(6px)', transition: { duration: 0.25 } }}
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
        {s.warnings.length > 0 && <span className="badge" data-hint="У этого ключа есть замечание: часть его настроек программа не поддерживает. Сервер может не заработать." style={{ color: 'var(--warn)' }} title={s.warnings.join(' ')}><Icon name="alert" size={12} /> есть замечание</span>}
      </div>
      <div className="server__actions" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn star" data-hint="Звёздочка: любимые серверы поднимаются в начало списка." data-on={s.favorite} aria-label={s.favorite ? 'Убрать из любимых' : 'В любимые'} onClick={() => void vpn().toggleFavorite(s.id)}>
          <motion.span whileTap={{ scale: 1.5, rotate: 20 }} style={{ display: 'grid' }}><Icon name="star" fill={s.favorite ? 'currentColor' : 'none'} /></motion.span>
        </button>
        <span className="tech">{s.host}</span>
        <div style={{ position: 'relative' }}>
          <button className="icon-btn" aria-label="Действия" data-hint="Дополнительные действия: переименовать сервер или удалить его из списка." onMouseDown={(e) => e.stopPropagation()} onClick={() => setMenu((v) => !v)}><Icon name="more" /></button>
          <AnimatePresence>
            {menu && (
              <motion.div className="ctx-menu" style={{ right: 0, top: 38 }} initial={{ opacity: 0, y: -6, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} onMouseDown={(e) => e.stopPropagation()}>
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

export function Servers(): ReactElement {
  const app = useApp((s) => s.app)!
  const pushToast = useApp((s) => s.pushToast)
  const [toDelete, setToDelete] = useState<ServerView | null>(null)
  const [busy, setBusy] = useState(false)
  const { servers, settings, conn } = app

  const paste = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await vpn().pasteKey()
      pushToast({ kind: r.ok ? 'success' : 'error', text: r.message })
      for (const sk of r.skipped.slice(0, 2)) pushToast({ kind: 'warn', text: sk })
    } finally { setBusy(false) }
  }

  const sorted = [...servers].sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.addedAt - b.addedAt)

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">Серверы</h1>
          <p className="page__lead">Выберите сервер, через который пойдёт интернет. Ключ, который вам прислали, добавляется кнопкой — он сам возьмётся из буфера обмена.</p>
        </div>
        <button className="btn btn--primary" data-hint="Берёт ключ из буфера обмена (то, что вы только что скопировали) и добавляет сервер в список. Ничего печатать не нужно." onClick={() => void paste()} disabled={busy}>
          {busy ? <span className="spinner" /> : <Icon name="clipboard" size={18} />} Вставить ключ
        </button>
      </div>

      {servers.length === 0 ? (
        <motion.div className="empty" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}>
          <EmptyArt />
          <div className="empty__title">Здесь пока пусто</div>
          <p className="empty__text">Скопируйте ключ (он начинается с vless://, vmess://, trojan://, ss:// и т. п.), затем нажмите «Вставить ключ».</p>
          <button className="btn btn--primary" data-hint="Берёт ключ из буфера обмена и добавляет сервер. Сначала скопируйте ключ, который вам прислали." onClick={() => void paste()}><Icon name="clipboard" size={18} /> Вставить ключ</button>
        </motion.div>
      ) : (
        <LayoutGroup>
          <motion.div className="servers" layout>
            <AnimatePresence mode="popLayout">
              {sorted.map((s) => (
                <ServerCard key={s.id} s={s} selected={settings.selectedServerId === s.id} active={conn.status === 'on' && conn.serverId === s.id} onAskDelete={setToDelete} />
              ))}
            </AnimatePresence>
          </motion.div>
        </LayoutGroup>
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
        «{toDelete?.name}» пропадёт из списка вместе с ключом. Чтобы вернуть его, ключ придётся вставить заново.
      </Modal>
    </div>
  )
}
