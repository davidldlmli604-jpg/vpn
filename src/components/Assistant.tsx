// Шелти-помощник: следит за курсором, меняет настроение вслед за подключением
// и подсказывает, что делает то, на что навели мышку (любой элемент с атрибутом data-hint).
import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { useMotion } from '../lib/useMotionSetting'
import { useApp } from '../store'
import { Sheltie, type Mood } from './Sheltie'

const TIPS = [
  'Если сайт не открывается, попробуйте другой сервер из списка — иногда один из них «капризничает».',
  'Звёздочка у сервера поднимает его в начало списка. Так любимый всегда под рукой.',
  'Зелёная задержка — это хорошо: до 150 мс всё летает.',
  'Если компьютер слабый и окно тормозит, в «Настройках» можно сделать анимации спокойнее или выключить.',
  'Свой ключ можно переименовать: нажмите «···» на карточке сервера.',
  'Гав! Я слежу за курсором. Наведите мышку на любую кнопку — расскажу, что она делает.'
]

function Typewriter({ text, instant }: { text: string; instant: boolean }): ReactElement {
  const [n, setN] = useState(instant ? text.length : 0)
  useEffect(() => {
    if (instant) { setN(text.length); return }
    setN(0)
    const t = setInterval(() => setN((v) => (v >= text.length ? (clearInterval(t), v) : v + 1)), 14)
    return () => clearInterval(t)
  }, [text, instant])
  return (
    <>
      {text.slice(0, n)}
      {n < text.length && <span className="bubble__caret" />}
    </>
  )
}

type Bubble = { text: string; kind: 'hint' | 'reaction' }

export function Assistant(): ReactElement | null {
  const enabled = useApp((s) => s.app?.settings.assistant ?? true)
  const status = useApp((s) => s.app?.conn.status ?? 'off')
  const motion$ = useMotion()
  const [hint, setHint] = useState<string | null>(null)
  const [reaction, setReaction] = useState<string | null>(null)
  const [asleep, setAsleep] = useState(false)
  const [blinking, setBlinking] = useState(false)
  const [hop, setHop] = useState(0)
  const [heart, setHeart] = useState(0)
  const svgRef = useRef<SVGSVGElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const pointer = useRef({ x: -1, y: -1, last: Date.now() })
  const target = useRef<Element | null>(null)
  const gaze = useRef({ x: 0, y: 0 })
  const tipIndex = useRef(0)
  const reactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevStatus = useRef(status)

  const say = useCallback((text: string, ms = 4800): void => {
    setReaction(text)
    if (reactionTimer.current) clearTimeout(reactionTimer.current)
    reactionTimer.current = setTimeout(() => setReaction(null), ms)
  }, [])

  // --- подсказки по наведению (и по фокусу с клавиатуры) ---
  useEffect(() => {
    if (!enabled) { setHint(null); return }
    let showTimer: ReturnType<typeof setTimeout> | null = null
    let hideTimer: ReturnType<typeof setTimeout> | null = null
    const hintOf = (t: EventTarget | null): Element | null => (t instanceof Element ? t.closest('[data-hint]') : null)
    const over = (e: Event): void => {
      const el = hintOf(e.target)
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
      if (!el) return
      if (el === target.current) return
      if (showTimer) clearTimeout(showTimer)
      showTimer = setTimeout(() => {
        target.current = el
        setHint(el.getAttribute('data-hint'))
        setAsleep(false)
      }, target.current ? 120 : 380)
    }
    const out = (e: Event): void => {
      const el = hintOf(e.target)
      if (!el) return
      if (showTimer) { clearTimeout(showTimer); showTimer = null }
      hideTimer = setTimeout(() => { target.current = null; setHint(null) }, 140)
    }
    document.addEventListener('pointerover', over)
    document.addEventListener('pointerout', out)
    document.addEventListener('focusin', over)
    document.addEventListener('focusout', out)
    return () => {
      document.removeEventListener('pointerover', over)
      document.removeEventListener('pointerout', out)
      document.removeEventListener('focusin', over)
      document.removeEventListener('focusout', out)
      if (showTimer) clearTimeout(showTimer)
      if (hideTimer) clearTimeout(hideTimer)
    }
  }, [enabled])

  // --- слежение за курсором и дремота ---
  useEffect(() => {
    if (!enabled) return
    const move = (e: PointerEvent): void => {
      pointer.current = { x: e.clientX, y: e.clientY, last: Date.now() }
      if (asleep) { setAsleep(false); setHop((h) => h + 1) }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('keydown', () => { pointer.current.last = Date.now() })
    return () => window.removeEventListener('pointermove', move)
  }, [enabled, asleep])

  useEffect(() => {
    if (!enabled || motion$ === 'off') return
    let raf = 0
    let seen = -1
    let seenTarget: Element | null = null
    let settled = false
    const frame = (): void => {
      raf = requestAnimationFrame(frame)
      const svg = svgRef.current
      const wrap = wrapRef.current
      if (!svg || !wrap || document.hidden) return
      // мышь давно не двигалась и взгляд уже на месте — кадр пропускаем, не измеряя страницу
      const moved = pointer.current.last !== seen
      if (!moved && settled && target.current === seenTarget) return
      seen = pointer.current.last
      seenTarget = target.current
      const r = wrap.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height * 0.4
      let tx = pointer.current.x
      let ty = pointer.current.y
      const el = target.current
      if (el && el.isConnected) {
        const b = el.getBoundingClientRect()
        tx = b.left + b.width / 2
        ty = b.top + b.height / 2
      }
      let gx = 0, gy = 0
      if (tx >= 0) {
        gx = Math.tanh((tx - cx) / 220)
        gy = Math.tanh((ty - cy) / 260)
      }
      const dx = (gx - gaze.current.x) * 0.16
      const dy = (gy - gaze.current.y) * 0.16
      // взгляд уже на месте — не трогаем стили, иначе браузер пересчитывает собаку каждый кадр впустую
      settled = Math.abs(dx) < 0.0005 && Math.abs(dy) < 0.0005
      if (settled) return
      gaze.current.x += dx
      gaze.current.y += dy
      svg.style.setProperty('--gx', gaze.current.x.toFixed(3))
      svg.style.setProperty('--gy', gaze.current.y.toFixed(3))
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [enabled, motion$])

  // --- моргание ---
  useEffect(() => {
    if (!enabled || motion$ === 'off' || asleep) return
    let t: ReturnType<typeof setTimeout>
    const loop = (): void => {
      t = setTimeout(() => {
        setBlinking(true)
        setTimeout(() => setBlinking(false), 140)
        loop()
      }, 2200 + Math.random() * 3600)
    }
    loop()
    return () => clearTimeout(t)
  }, [enabled, motion$, asleep])

  // --- засыпает, если давно никто не трогает мышь (и VPN не работает) ---
  useEffect(() => {
    if (!enabled) return
    const t = setInterval(() => {
      if (status !== 'on' && status !== 'connecting' && Date.now() - pointer.current.last > 60_000) setAsleep(true)
    }, 5000)
    return () => clearInterval(t)
  }, [enabled, status])

  // --- реакции на подключение ---
  useEffect(() => {
    const prev = prevStatus.current
    prevStatus.current = status
    if (!enabled || prev === status) return
    if (status === 'on') say('Ура, подключились! Теперь интернет идёт через VPN.')
    else if (status === 'error') say('Ой, не получилось… Прочитайте, что написано наверху, — там подсказка.')
    else if (status === 'off' && prev === 'on') say('Отключились. Я тут, если что понадобится.', 3600)
    if (status === 'on') setHop((h) => h + 1)
  }, [status, enabled, say])

  // --- приветствие при самом первом запуске ---
  useEffect(() => {
    if (!enabled) return
    let greeted = false
    try { greeted = localStorage.getItem('assistant-greeted') === '1' } catch { /* без хранилища просто поздороваемся */ }
    if (greeted) return
    const t = setTimeout(() => {
      say('Привет! Я Шелти. Наведите мышку на любую кнопку — я объясню, что она делает.', 7000)
      try { localStorage.setItem('assistant-greeted', '1') } catch { /* ничего */ }
    }, 1400)
    return () => clearTimeout(t)
  }, [enabled, say])

  if (!enabled) return null

  const mood: Mood = asleep ? 'sleep' : hint ? 'alert' : status === 'on' ? 'happy' : status === 'error' ? 'worried' : status === 'connecting' ? 'alert' : 'idle'
  const bubble: Bubble | null = hint ? { text: hint, kind: 'hint' } : reaction ? { text: reaction, kind: 'reaction' } : null

  const pet = (): void => {
    setHop((h) => h + 1)
    setHeart((h) => h + 1)
    setAsleep(false)
    say(TIPS[tipIndex.current++ % TIPS.length]!, 6500)
  }

  return (
    <div className="assistant" ref={wrapRef}>
      <AnimatePresence mode="wait">
        {bubble && (
          <motion.div key={bubble.text} className="bubble" role="status" initial={{ opacity: 0, scale: 0.86, y: 10, x: -8 }} animate={{ opacity: 1, scale: 1, y: 0, x: 0 }} exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.12 } }} transition={{ type: 'spring', stiffness: 420, damping: 28 }}>
            <span className="bubble__who">Шелти</span>
            <Typewriter text={bubble.text} instant={motion$ === 'off'} />
          </motion.div>
        )}
      </AnimatePresence>
      <button className="assistant__dog" onClick={pet} aria-label="Шелти — собака-помощник. Нажмите, чтобы погладить" data-hint="Это я, Шелти! Нажмите — я дам совет. Выключить меня можно в «Настройках».">
        <Sheltie ref={svgRef} mood={mood} blinking={blinking} hop={hop > 0} key={`s${hop}`} />
      </button>
      <AnimatePresence>
        {heart > 0 && (
          <motion.span key={heart} className="heart" initial={{ opacity: 0, y: 0, scale: 0.4 }} animate={{ opacity: [0, 1, 1, 0], y: -64, scale: [0.4, 1.2, 1, 0.9] }} transition={{ duration: 1.3 }} onAnimationComplete={() => setHeart(0)} aria-hidden="true">♥</motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}
