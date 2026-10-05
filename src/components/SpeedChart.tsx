import { useEffect, useRef, type ReactElement } from 'react'
import type { StatsSample } from '@shared/types'
import { useMotion } from '../lib/useMotionSetting'

/** Живой график скорости: плавная «осциллограмма» со свечением. Рисуется на холсте и непрерывно «едет» влево. */
export function SpeedChart({ history, active }: { history: StatsSample[]; active: boolean }): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null)
  const dataRef = useRef<{ down: number[]; up: number[]; at: number }>({ down: [], up: [], at: performance.now() })
  const motion = useMotion()

  useEffect(() => {
    dataRef.current = { down: history.map((h) => h.downBps), up: history.map((h) => h.upBps), at: performance.now() }
  }, [history])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    let w = 0, h = 0
    const resize = (): void => {
      const r = canvas.getBoundingClientRect()
      w = r.width; h = r.height
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    const POINTS = 60
    let raf = 0
    let smoothMax = 1_000_000
    let c1 = '#35f0cf', c2 = '#8b7bff', grid = 'rgba(255,255,255,.08)', muted = '#9aa6cf'

    function path(vals: number[], t: number, max: number, padTop: number, padBottom: number): Array<[number, number]> {
      const n = vals.length
      const stepX = (w - 2) / (POINTS - 1)
      const pts: Array<[number, number]> = []
      for (let i = 0; i < n; i++) {
        const x = w - (n - 1 - i + (1 - t)) * stepX
        const y = h - padBottom - (Math.min(vals[i]!, max) / max) * (h - padTop - padBottom)
        pts.push([x, y])
      }
      return pts
    }
    function trace(pts: Array<[number, number]>): void {
      if (pts.length === 0) return
      ctx!.moveTo(pts[0]![0], pts[0]![1])
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1]!, p1 = pts[i]!
        const mx = (p0[0] + p1[0]) / 2
        ctx!.bezierCurveTo(mx, p0[1], mx, p1[1], p1[0], p1[1])
      }
    }

    let tick = 0
    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame)
      if (document.hidden) return
      if (motion === 'off' && tick++ % 30 !== 0) return
      if (motion === 'calm' && tick++ % 2 !== 0) return
      if (tick % 40 === 0 || tick === 1) {
        const cs = getComputedStyle(canvas)
        c1 = cs.getPropertyValue('--accent').trim() || c1
        c2 = cs.getPropertyValue('--accent-2').trim() || c2
        grid = cs.getPropertyValue('--border').trim() || grid
        muted = cs.getPropertyValue('--faint').trim() || muted
      }
      const { down, up, at } = dataRef.current
      const t = motion === 'off' ? 1 : Math.min(1, (now - at) / 1000)
      const peak = Math.max(300_000, ...down, ...up)
      smoothMax += (peak * 1.25 - smoothMax) * 0.06
      ctx.clearRect(0, 0, w, h)
      // сетка
      ctx.lineWidth = 1
      ctx.strokeStyle = grid
      ctx.setLineDash([2, 6])
      for (let i = 1; i < 4; i++) { const y = (h / 4) * i; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
      ctx.setLineDash([])
      if (!active || down.length < 2) {
        ctx.fillStyle = muted
        ctx.font = '600 13px "Manrope Variable", "Segoe UI", sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(active ? 'Собираю данные…' : 'График появится, когда включится VPN', w / 2, h / 2 + 4)
        ctx.strokeStyle = grid
        ctx.beginPath(); ctx.moveTo(0, h - 8); ctx.lineTo(w, h - 8); ctx.stroke()
        return
      }
      const draw = (vals: number[], color: string, fillAlpha: number, width: number, glow: number): void => {
        const pts = path(vals, t, smoothMax, 14, 8)
        if (pts.length < 2) return
        const g = ctx.createLinearGradient(0, 0, 0, h)
        g.addColorStop(0, color + Math.round(fillAlpha * 255).toString(16).padStart(2, '0'))
        g.addColorStop(1, color + '00')
        ctx.beginPath(); trace(pts)
        ctx.lineTo(pts[pts.length - 1]![0], h); ctx.lineTo(pts[0]![0], h); ctx.closePath()
        ctx.fillStyle = g; ctx.fill()
        ctx.beginPath(); trace(pts)
        ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.strokeStyle = color
        ctx.shadowColor = color; ctx.shadowBlur = glow
        ctx.stroke(); ctx.shadowBlur = 0
        const last = pts[pts.length - 1]!
        const pulse = 3.2 + Math.sin(now / 260) * (motion === 'off' ? 0 : 1)
        ctx.beginPath(); ctx.arc(last[0], last[1], pulse, 0, Math.PI * 2); ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 14; ctx.fill(); ctx.shadowBlur = 0
      }
      const hex = (c: string): string => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#35f0cf')
      draw(up, hex(c2), 0.18, 1.8, 8)
      draw(down, hex(c1), 0.32, 2.4, 14)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [active, motion])

  return <canvas ref={ref} className="chart" aria-label="График скорости" />
}
