import { create } from 'zustand'
import type { ToastMessage } from '@shared/api'
import type { AppState, StatsSample } from '@shared/types'
import { api, loadApi } from './api'

export type Page = 'home' | 'servers' | 'bypass' | 'protection' | 'settings'

export interface UiState {
  ready: boolean
  page: Page
  app: AppState | null
  /** Последние выборки скорости для графика (по одной в секунду). */
  history: StatsSample[]
  toasts: ToastMessage[]
  fatal: string | null
  init(): Promise<void>
  setPage(p: Page): void
  pushToast(t: Omit<ToastMessage, 'id'> & { id?: string }): void
  dismissToast(id: string): void
}

const HISTORY = 90

export const useApp = create<UiState>((set, get) => ({
  ready: false,
  page: 'home',
  app: null,
  history: [],
  toasts: [],
  fatal: null,

  async init() {
    try {
      const a = await loadApi()
      const app = await a.getState()
      set({ app, ready: true })
      a.onState((s) => {
        const prevStatus = get().app?.conn.status
        set({ app: s })
        if (s.conn.status !== 'on' && prevStatus === 'on') set({ history: [] })
      })
      a.onStats((sample) => set((st) => ({ history: [...st.history.slice(-(HISTORY - 1)), sample] })))
      a.onToast((t) => get().pushToast(t))
      a.onNavigate((p) => set({ page: p as Page }))
    } catch (e) {
      set({ fatal: (e as Error).message })
    }
  },

  setPage(p) {
    set({ page: p })
  },

  pushToast(t) {
    const id = t.id ?? Math.random().toString(36).slice(2)
    set((s) => ({ toasts: [...s.toasts, { id, kind: t.kind, text: t.text }].slice(-4) }))
    setTimeout(() => get().dismissToast(id), 4400)
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }))
  }
}))

export const vpn = (): ReturnType<typeof api> => api()
