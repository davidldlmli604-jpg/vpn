import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { GAMES_PRESET } from '@core/presets'
import { normalizeRuleList } from '@core/domains'
import type { BypassApp, RunningApp } from '@shared/types'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Overlays'
import { Setting, Toggle } from '../components/controls'
import { plural } from '../lib/format'
import { useApp, vpn } from '../store'

function AppIcon({ icon, name, size = 30 }: { icon: string | null; name: string; size?: number }): ReactElement {
  if (icon) return <img src={icon} width={size} height={size} alt="" style={{ borderRadius: 7, flex: 'none' }} />
  const hue = Array.from(name).reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
  return (
    <span aria-hidden="true" style={{ width: size, height: size, borderRadius: 8, flex: 'none', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: size * 0.46, color: '#fff', background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 70% 42%))` }}>
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

function rulesAge(updatedAt: number | null, now: number): string {
  if (!updatedAt) return 'пока стоят вшитые в программу'
  const days = Math.floor((now - updatedAt) / 86_400_000)
  if (days <= 0) return 'обновлены сегодня'
  return `обновлены ${days} ${plural(days, 'день', 'дня', 'дней')} назад`
}

function AppPicker({ open, onClose, mode, chosen }: { open: boolean; onClose: () => void; mode: 'running' | 'installed'; chosen: BypassApp[] }): ReactElement {
  const [apps, setApps] = useState<RunningApp[] | null>(null)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Record<string, RunningApp>>({})
  useEffect(() => {
    if (!open) return
    setApps(null); setQuery(''); setPicked({})
    let alive = true
    void (mode === 'running' ? vpn().listRunningApps() : vpn().listInstalledApps()).then((l) => { if (alive) setApps(l) }).catch(() => { if (alive) setApps([]) })
    return () => { alive = false }
  }, [open, mode])
  const have = useMemo(() => new Set(chosen.map((a) => a.exe.toLowerCase())), [chosen])
  const shown = (apps ?? []).filter((a) => !have.has(a.exe.toLowerCase()) && (a.name + ' ' + a.exe).toLowerCase().includes(query.trim().toLowerCase()))
  const count = Object.keys(picked).length
  const add = (): void => {
    const items: BypassApp[] = [...chosen, ...Object.values(picked).map((a) => ({ exe: a.exe, name: a.name, path: a.path ?? undefined }))]
    void vpn().updateSettings({ bypassApps: items })
    onClose()
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'running' ? 'Запущенные программы' : 'Установленные программы'}
      actions={
        <>
          <button className="btn btn--ghost" onClick={onClose}>Отмена</button>
          <button className="btn btn--primary" disabled={count === 0} onClick={add}><Icon name="plus" size={17} /> Добавить{count ? ` (${count})` : ''}</button>
        </>
      }
    >
      <p style={{ marginBottom: 12 }}>Отметьте программы, которые должны выходить в интернет напрямую, без VPN.</p>
      <input className="rename" style={{ marginBottom: 10 }} placeholder="Поиск по названию" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      <div className="picker">
        {apps === null ? (
          <div className="picker__empty"><span className="spinner" /> Ищу программы…</div>
        ) : shown.length === 0 ? (
          <div className="picker__empty">{apps.length === 0 ? 'Список пуст. Попробуйте другой способ выбора.' : 'Ничего не найдено.'}</div>
        ) : (
          shown.map((a) => {
            const on = !!picked[a.exe]
            return (
              <button key={a.path ?? a.exe} className="picker__row" data-on={on} onClick={() => setPicked((p) => { const n = { ...p }; if (n[a.exe]) delete n[a.exe]; else n[a.exe] = a; return n })}>
                <AppIcon icon={a.icon} name={a.name} />
                <span className="picker__name">{a.name}<span className="tech">{a.exe}</span></span>
                <span className="picker__check" data-on={on}>{on && <Icon name="check" size={14} strokeWidth={3} />}</span>
              </button>
            )
          })
        )}
      </div>
    </Modal>
  )
}

function DomainList({ title, hint, help, value, onSave, tone }: { title: string; hint: string; help: string; value: string[]; onSave: (v: string[]) => void; tone: 'vpn' | 'direct' }): ReactElement {
  const [text, setText] = useState(value.join('\n'))
  const [invalid, setInvalid] = useState<string[]>([])
  useEffect(() => { setText(value.join('\n')) }, [value.join('\n')]) // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (): void => {
    const n = normalizeRuleList(text)
    setInvalid(n.invalid)
    const clean = [...n.domains, ...n.cidrs]
    setText(clean.join('\n'))
    if (JSON.stringify(clean) !== JSON.stringify(value)) onSave(clean)
  }
  return (
    <div className="glass card domlist" data-tone={tone} data-hint={help}>
      <div className="card__title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name={tone === 'vpn' ? 'shield-check' : 'home'} size={18} style={{ color: tone === 'vpn' ? 'var(--accent)' : 'var(--accent-2)' }} /> {title}
      </div>
      <div className="card__hint">{hint}</div>
      <textarea className="textarea" rows={5} spellCheck={false} placeholder={'example.com\n*.site.ru\n203.0.113.5'} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} />
      <div className="domlist__foot">
        <span className="tech">{value.length ? `в списке: ${value.length}` : 'пока пусто'}</span>
        {invalid.length > 0 && <span className="badge" style={{ color: 'var(--warn)' }} title={invalid.join(', ')}><Icon name="alert" size={12} /> не понял: {invalid.slice(0, 2).join(', ')}{invalid.length > 2 ? '…' : ''}</span>}
      </div>
    </div>
  )
}

export function Bypass(): ReactElement {
  const app = useApp((s) => s.app)!
  const pushToast = useApp((s) => s.pushToast)
  const { settings, system } = app
  const [picker, setPicker] = useState<'running' | 'installed' | null>(null)
  const [updating, setUpdating] = useState(false)
  const now = Date.now()
  const set = (patch: Parameters<ReturnType<typeof vpn>['updateSettings']>[0]): void => void vpn().updateSettings(patch)

  const updateRules = async (): Promise<void> => {
    setUpdating(true)
    try { await vpn().updateRules() } finally { setUpdating(false) }
  }
  const both = settings.alwaysVpn.filter((d) => settings.alwaysDirect.includes(d))

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">Мимо VPN</h1>
          <p className="page__lead">Что открывать напрямую, без VPN. Так банки, Госуслуги и игры работают быстро и без капризов, а всё остальное остаётся под защитой.</p>
        </div>
      </div>

      <section className="section">
        <h2 className="section__title">Российские сайты</h2>
        <div className="glass card">
          <Setting name="Российские сайты открывать напрямую" tech="наборы правил + зоны .ru .рф .su" hint="Яндекс, VK, Госуслуги, банки, магазины и всё в зонах .ru, .рф, .su открывается без VPN: быстрее, и не придётся входить заново." help="Российские сайты часто сами не любят VPN: просят подтверждение, не пускают или тормозят. Когда включено, они открываются напрямую, а зарубежные — через VPN. Если какой-то российский сайт всё-таки заблокирован, добавьте его в список «всегда через VPN» ниже.">
            <Toggle label="Российские сайты напрямую" checked={settings.bypassRu} onChange={(v) => set({ bypassRu: v })} />
          </Setting>
          <div className="rules-status" data-hint="Списки российских сайтов и адресов приходят вместе с программой и обновляются сами раз в несколько дней.">
            <Icon name="refresh" size={16} style={{ color: 'var(--muted)' }} />
            <span>Списки: {rulesAge(system.rules.updatedAt, now)}</span>
            <span className="tech">{system.rules.count} {plural(system.rules.count, 'файл', 'файла', 'файлов')}</span>
            <button className="btn btn--ghost btn--sm" style={{ marginLeft: 'auto' }} disabled={updating} onClick={() => void updateRules().catch(() => pushToast({ kind: 'error', text: 'Не получилось обновить списки.' }))} data-hint="Скачивает свежие списки из интернета. Применятся при следующем подключении.">
              {updating ? <span className="spinner" /> : <Icon name="refresh" size={15} />} Обновить сейчас
            </button>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">Программы мимо VPN</h2>
        <div className="glass card">
          <Setting name={GAMES_PRESET.title} tech={`готовый набор: ${GAMES_PRESET.processes.length} программ`} hint="Steam, Epic Games, Battle.net, Riot, EA, Ubisoft и популярные игры — напрямую, без «лагов» от лишнего круга через VPN." help={GAMES_PRESET.description}>
            <Toggle label={GAMES_PRESET.title} checked={settings.bypassGames} onChange={(v) => set({ bypassGames: v })} />
          </Setting>
          <div className="apps">
            <AnimatePresence initial={false}>
              {settings.bypassApps.map((a) => (
                <motion.div key={a.exe} layout className="app-chip" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ type: 'spring', stiffness: 420, damping: 30 }} data-hint={`«${a.name}» выходит в интернет напрямую, без VPN. Нажмите на крестик, чтобы убрать.`}>
                  <AppIcon icon={null} name={a.name} size={26} />
                  <span className="app-chip__name">{a.name}<span className="tech">{a.exe}</span></span>
                  <button className="icon-btn" aria-label={`Убрать ${a.name}`} onClick={() => set({ bypassApps: settings.bypassApps.filter((x) => x.exe !== a.exe) })}><Icon name="x" size={16} /></button>
                </motion.div>
              ))}
            </AnimatePresence>
            {settings.bypassApps.length === 0 && <div className="apps__empty">Пока ничего не выбрано. Добавьте программы кнопками ниже.</div>}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
            <button className="btn btn--ghost" onClick={() => setPicker('running')} data-hint="Показывает программы, которые работают прямо сейчас, — отметьте нужные. Удобно: сначала запустите программу, потом выберите её здесь."><Icon name="play" size={17} /> Выбрать из запущенных</button>
            <button className="btn btn--ghost" onClick={() => setPicker('installed')} data-hint="Показывает программы, установленные на компьютере (из меню «Пуск»)."><Icon name="servers" size={17} /> Выбрать из установленных</button>
          </div>
          {settings.mode === 'proxy' && (
            <div className="note" data-hint="В режиме «Браузер и программы» VPN видит только то, что само пользуется системным прокси. Чтобы правило работало для всех программ, включите режим «Весь компьютер».">
              <Icon name="info" size={16} /> Сейчас выбран режим «Браузер и программы»: правило действует только на программы, которые сами пользуются настройками прокси. Для всех остальных включите режим «Весь компьютер» на главной.
            </div>
          )}
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">Свои списки сайтов</h2>
        <div className="lists">
          <DomainList tone="vpn" title="Всегда через VPN" hint="Эти сайты всегда идут через VPN — даже российские." help="Сюда можно добавить российский сайт, который заблокирован, или любой сайт, который вы хотите всегда открывать через VPN. Один сайт — одна строка. Подойдёт и целый адрес со страницей: лишнее программа обрежет." value={settings.alwaysVpn} onSave={(v) => set({ alwaysVpn: v })} />
          <DomainList tone="direct" title="Всегда напрямую" hint="Эти сайты и адреса всегда открываются без VPN." help="Сюда можно добавить сайт или адрес (например, домашнего сервера), который должен открываться без VPN. Один сайт — одна строка." value={settings.alwaysDirect} onSave={(v) => set({ alwaysDirect: v })} />
        </div>
        {both.length > 0 && <div className="note" style={{ color: 'var(--warn)' }}><Icon name="alert" size={16} /> {both.slice(0, 3).join(', ')} есть в обоих списках — побеждает «Всегда через VPN».</div>}
      </section>

      <section className="section">
        <div className="glass card home-net" data-hint="Роутер, принтер, телевизор, NAS и другие устройства дома открываются напрямую всегда. Это нельзя выключить — так надёжнее.">
          <Icon name="lock" size={22} style={{ color: 'var(--accent)', flex: 'none' }} />
          <div>
            <div className="card__title">Домашняя сеть — всегда напрямую</div>
            <div className="card__hint">Роутер, принтер, телевизор и другие устройства у вас дома работают как обычно. Это включено всегда.</div>
          </div>
          <span className="badge" style={{ marginLeft: 'auto' }}><Icon name="check" size={12} /> включено</span>
        </div>
      </section>

      <AppPicker open={picker !== null} onClose={() => setPicker(null)} mode={picker ?? 'running'} chosen={settings.bypassApps} />
    </div>
  )
}
