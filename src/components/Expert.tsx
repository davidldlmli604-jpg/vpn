import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { AdvancedSettings, ConfigPreview, TunStack } from '@shared/types'
import { MTU_RANGE, PORT_RANGE, checkAdvanced } from '@shared/advanced'
import { useApp, vpn } from '../store'
import { Icon } from './Icon'
import { Chips, Setting, Toggle } from './controls'

/** Поле ввода с проверкой «на месте»: пока значение неверное, оно не отправляется, а под полем объясняется почему. */
function AdvInput({ name, tech, hint, help, field, value, inputMode, width = 240, placeholder }: { name: string; tech?: string; hint: string; help?: string; field: keyof AdvancedSettings; value: string | number; inputMode?: 'numeric' | 'text'; width?: number; placeholder?: string }): ReactElement {
  const current = useApp((s) => s.app!.settings.advanced)
  const [draft, setDraft] = useState(String(value))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setDraft(String(value)); setError(null) }, [value])
  const commit = (): void => {
    const raw = draft.trim()
    if (raw === String(value)) { setError(null); return }
    const parsed = inputMode === 'numeric' ? (raw === '' ? NaN : Number(raw)) : raw
    const { problems } = checkAdvanced({ [field]: parsed } as Partial<AdvancedSettings>, current)
    if (problems.length) { setError(problems[0]!.replace(/\s*Оставил.*$/, '')); return }
    setError(null)
    void vpn().updateAdvanced({ [field]: parsed } as Partial<AdvancedSettings>)
  }
  return (
    <Setting name={name} tech={tech} hint={hint} help={help}>
      <div className="adv">
        <input
          className="adv__input"
          data-invalid={error ? 'true' : 'false'}
          style={{ width }}
          value={draft}
          inputMode={inputMode}
          placeholder={placeholder}
          spellCheck={false}
          aria-label={name}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setDraft(String(value)); setError(null) } }}
        />
        {error && <div className="adv__error" role="alert">{error}</div>}
      </div>
    </Setting>
  )
}

const REMOTE_PRESETS: Array<{ title: string; value: string; hint: string }> = [
  { title: 'Cloudflare', value: 'https://1.1.1.1/dns-query', hint: 'Быстрый и не ведёт журналов. Стандартный выбор.' },
  { title: 'Google', value: 'https://dns.google/dns-query', hint: 'Надёжный DNS от Google.' },
  { title: 'Quad9', value: 'https://dns.quad9.net/dns-query', hint: 'DNS с защитой от вредоносных сайтов.' }
]

function CodeBox({ text, follow }: { text: string; follow?: boolean }): ReactElement {
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => { if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight }, [text, follow])
  return <pre ref={ref} className="code" tabIndex={0}>{text}</pre>
}

function ConfigPanel(): ReactElement {
  const pushToast = useApp((s) => s.pushToast)
  const [data, setData] = useState<ConfigPreview | null | 'none'>('none')
  const [busy, setBusy] = useState(false)
  const load = async (): Promise<void> => { setBusy(true); try { setData(await vpn().getConfigPreview()) } finally { setBusy(false) } }
  return (
    <>
      <Setting name="Итоговые настройки движка" tech="конфигурация sing-box" hint="Точный файл, по которому работает движок. Пароли и ключи в нём заменены на ••••, поэтому его можно показать тому, кто вам помогает." help="Здесь можно посмотреть, что именно программа передаёт движку. Секреты спрятаны, так что файл безопасно показывать специалисту.">
        <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => (data === 'none' ? void load() : setData('none'))}>{busy ? <span className="spinner" style={{ width: 14, height: 14 }} /> : null}{data === 'none' ? 'Показать' : 'Скрыть'}</button>
      </Setting>
      <AnimatePresence initial={false}>
        {data !== 'none' && (
          <motion.div className="code-wrap" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            {data === null ? (
              <p className="card__hint" style={{ padding: '6px 2px 12px' }}>Сначала добавьте и выберите сервер — тогда будет что показывать.</p>
            ) : (
              <>
                <p className="card__hint" style={{ padding: '2px 2px 8px' }}>{data.note}</p>
                <CodeBox text={data.json} />
                <div className="code-actions">
                  <button className="btn btn--ghost btn--sm" onClick={() => void load()}><Icon name="refresh" size={14} /> Обновить</button>
                  <button className="btn btn--ghost btn--sm" onClick={() => void vpn().copyText(data.json).then(() => pushToast({ kind: 'success', text: 'Настройки скопированы (секреты скрыты).' }))}><Icon name="clipboard" size={14} /> Скопировать</button>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function LogPanel(): ReactElement {
  const pushToast = useApp((s) => s.pushToast)
  const [lines, setLines] = useState<string[] | null>(null)
  useEffect(() => {
    if (lines === null) return
    const t = setInterval(() => void vpn().getLogs().then(setLines), 2000)
    return () => clearInterval(t)
  }, [lines === null])
  const text = lines?.join('\n') ?? ''
  return (
    <>
      <Setting name="Журнал" tech="что происходило" hint="Что делала программа и что писал движок. Ключи и пароли сюда не попадают. Если что-то не работает, покажите журнал тому, кто помогает." help="Журнал — это «дневник» программы: подключения, ошибки, обновления. Ключи и пароли в него не попадают, так что его безопасно показывать.">
        <button className="btn btn--ghost btn--sm" onClick={() => (lines === null ? void vpn().getLogs().then(setLines) : setLines(null))}>{lines === null ? 'Показать' : 'Скрыть'}</button>
      </Setting>
      <AnimatePresence initial={false}>
        {lines !== null && (
          <motion.div className="code-wrap" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <CodeBox text={text || 'Журнал пока пуст.'} follow />
            <div className="code-actions">
              <span className="tech">обновляется само · последние {lines.length} строк</span>
              <span style={{ flex: 1 }} />
              <button className="btn btn--ghost btn--sm" onClick={() => void vpn().copyText(text).then(() => pushToast({ kind: 'success', text: 'Журнал скопирован.' }))}><Icon name="clipboard" size={14} /> Скопировать</button>
              <button className="btn btn--ghost btn--sm" onClick={() => void vpn().clearLogs().then(() => vpn().getLogs().then(setLines))}><Icon name="trash" size={14} /> Очистить</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

/** Раздел «Для специалиста»: свёрнут, пока человек сам его не откроет. */
export function Expert(): ReactElement {
  const app = useApp((s) => s.app)!
  const adv = app.settings.advanced
  const [open, setOpen] = useState(false)
  const upd = (patch: Partial<AdvancedSettings>): void => void vpn().updateAdvanced(patch)
  const remotePreset = REMOTE_PRESETS.find((p) => p.value === adv.dnsRemote)?.value ?? 'custom'

  return (
    <section className="section">
      <button className="expert__head" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-hint="Раздел для тех, кто разбирается: DNS, размер пакета, порты, итоговые настройки движка и журнал. Обычному человеку здесь ничего менять не нужно — всё и так настроено.">
        <span>
          <span className="section__title" style={{ padding: 0 }}>Для специалиста</span>
          <span className="expert__sub">DNS, порты, размер пакета, журнал и итоговые настройки. Обычно трогать не нужно.</span>
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ type: 'spring', stiffness: 400, damping: 28 }} style={{ display: 'grid' }}><Icon name="chevron-down" /></motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3 }} style={{ overflow: 'hidden' }}>
            <div className="expert">
              <div className="note" style={{ marginTop: 0 }}>
                <Icon name="info" size={17} />
                <span>Здесь настройки для тех, кто понимает, что делает. Стандартные значения подходят почти всем. Неверное значение программа не примет и объяснит почему. Если VPN включён, после изменения он сам переподключится.</span>
              </div>

              <div className="glass card">
                <h3 className="expert__group">Адреса сайтов (DNS)</h3>
                <Setting name="DNS для запросов через VPN" tech="DoH / DoT" hint="Кому программа задаёт вопрос «где находится сайт», когда запрос идёт через VPN. Выберите готовый вариант или впишите свой ниже.">
                  <Chips<string> label="DNS через VPN" value={remotePreset} onChange={(v) => v !== 'custom' && upd({ dnsRemote: v })} items={[...REMOTE_PRESETS.map((p) => ({ value: p.value, title: p.title, hint: p.hint })), { value: 'custom', title: 'Свой', hint: 'Свой адрес DNS: впишите его в поле ниже.' }]} />
                </Setting>
                <AdvInput name="Адрес DNS через VPN" tech="https://…, tls://…, IP" hint="Например: https://1.1.1.1/dns-query, tls://dns.google или 8.8.8.8. Шифрованные адреса (https, tls) надёжнее." field="dnsRemote" value={adv.dnsRemote} width={300} />
                <AdvInput name="DNS для прямых запросов" tech="system или адрес" hint="Для российских сайтов и домашней сети. «system» — как настроено в Windows; можно указать, например, 77.88.8.8 (Яндекс)." field="dnsDirect" value={adv.dnsDirect} width={300} />
              </div>

              <div className="glass card">
                <h3 className="expert__group">Туннель и порты</h3>
                <AdvInput name="Порт локального прокси" tech="порт" hint={`Через него (на вашем компьютере, 127.0.0.1) работает режим «Браузер и программы». Меняйте, только если порт занят другой программой. От ${PORT_RANGE[0]} до ${PORT_RANGE[1]}.`} field="mixedPort" value={adv.mixedPort} inputMode="numeric" width={120} />
                <AdvInput name="Размер пакета" tech="MTU" hint={`Для режима «Весь компьютер». Если сайты открываются странно или медленно, попробуйте 1400 или 1280. От ${MTU_RANGE[0]} до ${MTU_RANGE[1]}.`} field="mtu" value={adv.mtu} inputMode="numeric" width={120} />
                <Setting name="Сетевой стек туннеля" tech="stack" hint="«mixed» — быстрый и совместимый, подходит почти всем. «gvisor» — запасной, если с другим что-то не так. «system» — самый лёгкий.">
                  <Chips<TunStack> label="Сетевой стек" value={adv.tunStack} onChange={(v) => upd({ tunStack: v })} items={[
                    { value: 'mixed', title: 'mixed', hint: 'Смешанный стек: быстрый и совместимый. Рекомендуется.' },
                    { value: 'gvisor', title: 'gvisor', hint: 'Запасной стек: помогает, если mixed что-то не устраивает. Немного медленнее.' },
                    { value: 'system', title: 'system', hint: 'Использует сетевой стек системы: самый лёгкий, но не со всем дружит.' }
                  ]} />
                </Setting>
                <Setting name="IPv6 в туннеле" tech="IPv6" hint="Пускать через VPN и адреса нового типа. Включайте, только если у вас есть IPv6 и он «светит» мимо VPN. Если IPv6 в системе отключён, туннель с этой настройкой не запустится.">
                  <Toggle label="IPv6 в туннеле" checked={adv.tunIpv6} onChange={(v) => upd({ tunIpv6: v })} />
                </Setting>
                <Setting name="Строгие маршруты" tech="strict_route" hint="Не даёт программам обходить туннель через другие сетевые карты — защита от утечки DNS в режиме «Весь компьютер». Выключайте, если другая программа (например, корпоративный VPN) из-за этого перестала работать.">
                  <Toggle label="Строгие маршруты" checked={adv.strictRoute} onChange={(v) => upd({ strictRoute: v })} />
                </Setting>
                <Setting name="Уплотнение соединений" tech="multiplex" hint="Несколько соединений идут внутри одного. Иногда ускоряет загрузку страниц, но работает не со всеми серверами (с ключами Reality + Vision — никогда).">
                  <Toggle label="Уплотнение соединений" checked={adv.multiplex} onChange={(v) => upd({ multiplex: v })} />
                </Setting>
              </div>

              <div className="glass card">
                <h3 className="expert__group">Журнал и итоговые настройки</h3>
                <Setting name="Подробность журнала" hint="«Коротко» — только предупреждения и ошибки; «Обычно» — основные события; «Подробно» — всё, для поиска причин (журнал быстро растёт).">
                  <Chips<AdvancedSettings['logLevel']> label="Подробность журнала" value={adv.logLevel} onChange={(v) => upd({ logLevel: v })} items={[
                    { value: 'warn', title: 'Коротко', hint: 'В журнал попадают только предупреждения и ошибки.' },
                    { value: 'info', title: 'Обычно', hint: 'Основные события. Подходит почти всегда.' },
                    { value: 'debug', title: 'Подробно', hint: 'Всё подряд — для поиска причин проблем. Журнал будет быстро расти.' }
                  ]} />
                </Setting>
                <ConfigPanel />
                <LogPanel />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn btn--ghost btn--sm" data-hint="Вернуть все настройки этого раздела к стандартным значениям. Ключи, серверы и остальные настройки не затрагиваются." onClick={() => void vpn().resetAdvanced()}>Сбросить всё к стандартному</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
