/** Смена оформления «волной» от места щелчка (если браузер умеет и анимации не отключены). */
export function withThemeTransition(origin: { x: number; y: number } | null, motion: 'full' | 'calm' | 'off', change: () => void): void {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } }
  if (!origin || motion !== 'full' || typeof doc.startViewTransition !== 'function') {
    change()
    return
  }
  const t = doc.startViewTransition(change)
  const { x, y } = origin
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  void t.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 650, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' }
    )
  })
}
