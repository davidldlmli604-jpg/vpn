import { useEffect, useRef, type ReactElement } from 'react'
import type { ConnStatus } from '@shared/types'
import { useMotion } from '../lib/useMotionSetting'

interface P { a: number; r: number; s: number; size: number; life: number; vr: number; hue: number }

/**
 * Облако частиц вокруг кнопки. Поведение зависит от состояния:
 *  выключено — медленно дрейфуют; подключаюсь — слетаются к центру по спирали;
 *  работает — плавно расходятся наружу (поток данных); ошибка — дрожат.
 * При включении — яркая вспышка.
 */
export function Particles({ status }: { status: ConnStatus }): ReactElement | null {
  const ref = useRef<HTMLCanvasElement>(null)
  const statusRef = useRef<ConnStatus>(status)
  const prevRef = useRef<ConnStatus>(status)
  const burstRef = useRef(0)
  const motion = useMotion()

  useEffect(() => {
    if (status === 'on' && prevRef.current !== 'on') burstRef.current = 46
    prevRef.current = status
    statusRef.current = status
  }, [status])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || motion === 'off') return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    let w = 0, h = 0
    const resize = (): void => {
      const rect = canvas.getBoundingClientRect()
      w = rect.width; h = rect.height
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const COUNT = motion === 'calm' ? 26 : 64
    const rnd = (a: number, b: number): number => a + Math.random() * (b - a)
    const spawn = (outer = true): P => ({ a: rnd(0, Math.PI * 2), r: outer ? rnd(150, 230) : rnd(40, 230), s: rnd(0.12, 0.5), size: rnd(0.8, 2.4), life: rnd(0.4, 1), vr: rnd(0.4, 1.2), hue: Math.random() })
    const ps: P[] = Array.from({ length: COUNT }, () => spawn(false))
    const burst: P[] = []
    let raf = 0
    let last = performance.now()
    let color = '#35f0cf'
    let color2 = '#8b7bff'
    let colorTick = 0

    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame)
      if (document.hidden) return
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (colorTick++ % 20 === 0) {
        const cs = getComputedStyle(canvas)
        color = cs.getPropertyValue('--st-a').trim() || color
        color2 = cs.getPropertyValue('--st-b').trim() || color2
      }
      const st = statusRef.current
      ctx.clearRect(0, 0, w, h)
      const cx = w / 2, cy = h / 2
      ctx.globalCompositeOperation = 'lighter'

      if (burstRef.current > 0) {
        for (let i = 0; i < burstRef.current; i++) burst.push({ a: rnd(0, Math.PI * 2), r: rnd(70, 90), s: 0, size: rnd(1.2, 3.2), life: 1, vr: rnd(90, 260), hue: Math.random() })
        burstRef.current = 0
      }

      for (const p of ps) {
        if (st === 'connecting') { p.r -= (60 + p.vr * 90) * dt; p.a += (1.6 + p.s) * dt * (1 + (230 - p.r) / 160); if (p.r < 58) Object.assign(p, spawn(true)) }
        else if (st === 'on') { p.r += (14 + p.vr * 42) * dt; p.a += p.s * dt * 0.35; p.life -= dt * 0.06; if (p.r > 235 || p.life <= 0) Object.assign(p, spawn(false), { r: rnd(70, 100), life: 1 }) }
        else if (st === 'error') { p.a += (Math.random() - 0.5) * 0.35; p.r += (Math.random() - 0.5) * 3 }
        else { p.a += p.s * dt * 0.18; p.r += Math.sin(now / 2400 + p.a * 3) * 4 * dt; if (p.r < 70) p.r = 70 }
        const x = cx + Math.cos(p.a) * p.r
        const y = cy + Math.sin(p.a) * p.r * 0.82
        const fade = st === 'on' ? Math.max(0, 1 - (p.r - 80) / 170) : st === 'off' ? 0.5 : 0.85
        ctx.globalAlpha = Math.max(0, Math.min(1, fade * (st === 'off' ? 0.45 : 0.9) * p.life))
        ctx.fillStyle = p.hue > 0.55 ? color2 : color
        ctx.beginPath()
        ctx.arc(x, y, p.size, 0, Math.PI * 2)
        ctx.fill()
      }
      for (let i = burst.length - 1; i >= 0; i--) {
        const p = burst[i]!
        p.r += p.vr * dt
        p.vr *= 1 - dt * 1.8
        p.life -= dt * 1.1
        if (p.life <= 0) { burst.splice(i, 1); continue }
        const x = cx + Math.cos(p.a) * p.r
        const y = cy + Math.sin(p.a) * p.r * 0.82
        ctx.globalAlpha = p.life
        ctx.fillStyle = p.hue > 0.5 ? color2 : color
        ctx.beginPath()
        ctx.arc(x, y, p.size * (0.6 + p.life), 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [motion])

  if (motion === 'off') return null
  return <canvas ref={ref} className="hero__particles" aria-hidden="true" />
}
