import { LayoutGroup, motion } from 'framer-motion'
import { useId, type ReactElement, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }): ReactElement {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className="toggle" onClick={() => onChange(!checked)}>
      <span className="toggle__knob" />
    </button>
  )
}

/** Строка настройки: название обычным языком, под ним — одна строка «что это и когда включать», справа — переключатель. */
export function Setting({ name, hint, help, tech, children }: { name: string; hint: string; /** Более подробное объяснение для Шелти */ help?: string; tech?: string; children: ReactNode }): ReactElement {
  return (
    <div className="setting" data-hint={help ?? hint}>
      <div className="setting__text">
        <div className="setting__name">
          {name} {tech && <span className="tech">{tech}</span>}
        </div>
        <div className="setting__hint">{hint}</div>
      </div>
      {children}
    </div>
  )
}

export interface SegItem<T extends string> {
  hint?: string
  value: T
  title: string
  tech?: string
  icon?: IconName
  disabled?: boolean
  note?: string
}

export function Segmented<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: Array<SegItem<T>>; label: string }): ReactElement {
  const id = useId()
  return (
    <LayoutGroup id={id}>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {items.map((it) => (
          <span key={it.value} style={{ display: 'contents' }} data-hint={it.hint}><button role="radio" aria-checked={value === it.value} disabled={it.disabled} className="segmented__item" onClick={() => onChange(it.value)}>
            {value === it.value && <motion.span layoutId="pill" className="segmented__pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
            {it.icon && <Icon name={it.icon} size={22} />}
            <span>{it.title}</span>
            {it.tech && <span className="tech">{it.tech}</span>}
            {it.note && it.disabled && <span className="tech">{it.note}</span>}
          </button></span>
        ))}
      </div>
    </LayoutGroup>
  )
}

export function Chips<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: Array<{ value: T; title: string; icon?: IconName; hint?: string }>; label: string }): ReactElement {
  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {items.map((it) => (
        <button key={it.value} role="radio" aria-checked={value === it.value} className="chip" data-hint={it.hint} onClick={() => onChange(it.value)}>
          {it.icon && <Icon name={it.icon} size={16} />}
          {it.title}
        </button>
      ))}
    </div>
  )
}

/** Подсветка карточки за указателем мыши. */
export function spotlight(e: React.MouseEvent<HTMLElement>): void {
  const r = e.currentTarget.getBoundingClientRect()
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`)
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`)
}
