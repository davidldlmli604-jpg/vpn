import 'flag-icons/css/flag-icons.min.css'
import type { ReactElement } from 'react'
import { countryName } from '../lib/format'
import { Icon } from './Icon'

/** Флаги — картинками: в Windows флаги-эмодзи не рисуются (вместо них видны две буквы). */
export function Flag({ code, size = 30 }: { code: string | null | undefined; size?: number }): ReactElement {
  if (!code || !/^[a-zA-Z]{2}$/.test(code)) {
    return (
      <span className="flag flag--unknown" style={{ width: size * 1.333, height: size, borderRadius: Math.max(5, size / 5) }} title="Страна неизвестна">
        <Icon name="globe" size={size * 0.55} />
      </span>
    )
  }
  return <span className={`flag fi fi-${code.toLowerCase()}`} style={{ fontSize: size, borderRadius: Math.max(5, size / 5) }} role="img" aria-label={countryName(code)} title={countryName(code)} />
}
