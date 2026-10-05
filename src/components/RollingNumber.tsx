import { animate, motion, useMotionValue, useTransform } from 'framer-motion'
import { useEffect, type ReactElement } from 'react'
import { useMotion } from '../lib/useMotionSetting'

/** Число, которое плавно «докручивается» до нового значения. */
export function RollingNumber({ value, format }: { value: number; format: (v: number) => string }): ReactElement {
  const motion$ = useMotion()
  const mv = useMotionValue(value)
  const text = useTransform(mv, (v) => format(v))
  useEffect(() => {
    if (motion$ === 'off') { mv.set(value); return }
    const c = animate(mv, value, { duration: 0.9, ease: [0.22, 1, 0.36, 1] })
    return () => c.stop()
  }, [value, motion$, mv])
  return <motion.span>{text}</motion.span>
}
