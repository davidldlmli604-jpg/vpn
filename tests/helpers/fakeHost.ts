import type { Host } from '../../electron/controller'

export interface FakeHostState {
  clipboard: string
  notes: Array<[string, string]>
  actions: string[]
  taskExists: boolean
  createCancelled: boolean
  runTaskOk: boolean
  admin: boolean
  quitCalls: number
  releaseCalls: number
  startedHidden: boolean
  autostart: boolean
  autostartWorks: boolean
  clipboardWrites: string[]
}

/** Подставная «система» для проверки контроллера без Windows и без Electron. */
export function fakeHost(over: Partial<FakeHostState> & { platform?: NodeJS.Platform } = {}): { host: Host; state: FakeHostState } {
  const state: FakeHostState = { clipboard: '', notes: [], actions: [], taskExists: false, createCancelled: false, runTaskOk: true, admin: false, quitCalls: 0, releaseCalls: 0, startedHidden: false, autostart: false, autostartWorks: true, clipboardWrites: [], ...over }
  const host: Host = {
    platform: over.platform ?? 'win32',
    appVersion: '0.0.0-test',
    readClipboard: async () => state.clipboard,
    notify: (t, b) => { state.notes.push([t, b]) },
    windowAction: (a) => { state.actions.push(a) },
    quit: () => { state.quitCalls++ },
    isAdmin: async () => state.admin,
    exePath: 'C:\\Program Files\\Tropa\\Tropa.exe',
    elevation: {
      taskExists: async () => state.taskExists,
      createTask: async (exe, args) => {
        state.actions.push(`createTask ${exe} ${args}`)
        if (state.createCancelled) return { ok: false, cancelled: true }
        state.taskExists = true
        return { ok: true, cancelled: false }
      },
      deleteTask: async () => { state.taskExists = false; state.actions.push('deleteTask'); return true },
      runTask: async () => { state.actions.push('runTask'); return state.runTaskOk }
    },
    releaseControl: () => { state.releaseCalls++ },
    startedHidden: state.startedHidden,
    setAutostart: async (enabled) => { state.actions.push(`autostart ${enabled}`); if (state.autostartWorks) state.autostart = enabled; return state.autostart },
    isAutostart: () => state.autostart,
    writeClipboard: (t) => { state.clipboardWrites.push(t) },
    fileIcon: async () => null,
    readShortcut: () => null
  }
  return { host, state }
}
