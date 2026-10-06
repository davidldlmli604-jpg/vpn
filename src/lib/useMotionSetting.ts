import { useApp } from '../store'

/** Сколько «движения» разрешено: полное, спокойное (без тяжёлых фоновых эффектов) или никакого. */
export function useMotion(): 'full' | 'calm' | 'off' {
  const m = useApp((s) => s.app?.settings.motion ?? 'full')
  return m
}
