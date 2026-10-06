import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, type ReactElement } from 'react'
import { Aurora } from './components/Aurora'
import { Toasts } from './components/Overlays'
import { Sidebar, TitleBar } from './components/Shell'
import { Bypass } from './pages/Bypass'
import { Home } from './pages/Home'
import { Servers } from './pages/Servers'
import { Settings } from './pages/Settings'
import { useApp } from './store'

const pageVariants = {
  initial: { opacity: 0, y: 18, filter: 'blur(8px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.38, ease: [0.22, 1, 0.36, 1] as const } },
  exit: { opacity: 0, y: -12, filter: 'blur(6px)', transition: { duration: 0.2 } }
}

/** Переносит оформление и состояние подключения в атрибуты корневого элемента — по ним работает весь CSS. */
function useRootAttributes(): void {
  const settings = useApp((s) => s.app?.settings)
  const status = useApp((s) => s.app?.conn.status ?? 'off')
  useEffect(() => {
    const root = document.documentElement
    const apply = (): void => {
      const dark = settings?.theme === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches : settings?.theme !== 'light'
      root.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    root.dataset.palette = settings?.palette ?? 'aurora'
    root.dataset.motion = settings?.motion ?? 'full'
    if (settings?.theme === 'system') {
      const mq = matchMedia('(prefers-color-scheme: dark)')
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
    return undefined
  }, [settings?.theme, settings?.palette, settings?.motion])
  useEffect(() => { document.documentElement.dataset.state = status }, [status])
}

export function App(): ReactElement {
  const ready = useApp((s) => s.ready)
  const fatal = useApp((s) => s.fatal)
  const page = useApp((s) => s.page)
  const init = useApp((s) => s.init)
  useRootAttributes()
  useEffect(() => { void init() }, [init])

  if (fatal) return <div style={{ padding: 40 }}>Не удалось запустить окно: {fatal}</div>
  return (
    <div className="app">
      <Aurora />
      <TitleBar />
      {ready ? (
        <>
          <Sidebar />
          <main className="main">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={page} variants={pageVariants} initial="initial" animate="animate" exit="exit" style={{ minHeight: '100%' }}>
                {page === 'home' && <Home />}
                {page === 'servers' && <Servers />}
                {page === 'bypass' && <Bypass />}
                {page === 'settings' && <Settings />}
              </motion.div>
            </AnimatePresence>
          </main>
          <Toasts />
        </>
      ) : null}
    </div>
  )
}
