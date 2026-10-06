import type { ReactElement } from 'react'
import { useMotion } from '../lib/useMotionSetting'

/** Мягкий переливающийся фон; цвет меняется вместе с состоянием подключения. */
export function Aurora(): ReactElement | null {
  const m = useMotion()
  return (
    <div className="aurora" aria-hidden="true" style={m === 'calm' ? { opacity: 0.8 } : undefined}>
      <div className="aurora__blob" style={m !== 'full' ? { animation: 'none' } : undefined} />
      <div className="aurora__blob" style={m !== 'full' ? { animation: 'none' } : undefined} />
      <div className="aurora__blob" style={m !== 'full' ? { animation: 'none' } : undefined} />
    </div>
  )
}
