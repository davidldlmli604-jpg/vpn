// Мост между окном и «внутренностями». Окно получает только перечисленные здесь возможности.
import { contextBridge, ipcRenderer } from 'electron'
import { INVOKABLE, IPC, type ToastMessage, type VpnApi } from '../shared/api'
import type { AppState, StatsSample } from '../shared/types'

type Method = (typeof INVOKABLE)[number]
const call = <T>(method: Method, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(IPC.invoke, method, ...args) as Promise<T>

function subscribe<T>(channel: string, cb: (v: T) => void): () => void {
  const handler = (_e: Electron.IpcRendererEvent, v: T): void => cb(v)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: VpnApi = {
  getState: () => call('getState'),
  onState: (cb) => subscribe<AppState>(IPC.state, cb),
  onStats: (cb) => subscribe<StatsSample>(IPC.stats, cb),
  onToast: (cb) => subscribe<ToastMessage>(IPC.toast, cb),
  onNavigate: (cb) => subscribe<string>(IPC.navigate, cb),

  pasteKey: () => call('pasteKey'),
  addKeyText: (text) => call('addKeyText', text),
  selectServer: (id) => call('selectServer', id),
  renameServer: (id, name) => call('renameServer', id, name),
  removeServer: (id) => call('removeServer', id),
  toggleFavorite: (id) => call('toggleFavorite', id),
  pingServers: (ids) => call('pingServers', ids),

  refreshSubscription: (id) => call('refreshSubscription', id),
  renameSubscription: (id, name) => call('renameSubscription', id, name),
  removeSubscription: (id) => call('removeSubscription', id),
  getQr: (kind, id) => call('getQr', kind, id),
  runCheck: () => call('runCheck'),
  clearCheck: () => call('clearCheck'),

  connect: (serverId) => call('connect', serverId),
  disconnect: () => call('disconnect'),
  requestTunMode: () => call('requestTunMode'),
  revokeElevation: () => call('revokeElevation'),
  recoverInternet: () => call('recoverInternet'),

  listRunningApps: () => call('listRunningApps'),
  listInstalledApps: () => call('listInstalledApps'),
  updateRules: () => call('updateRules'),

  updateSettings: (patch) => call('updateSettings', patch),
  updateAdvanced: (patch) => call('updateAdvanced', patch),
  resetAdvanced: () => call('resetAdvanced'),
  getLogs: () => call('getLogs'),
  clearLogs: () => call('clearLogs'),
  getConfigPreview: () => call('getConfigPreview'),
  copyText: (text) => call('copyText', text),

  windowAction: (action) => call('windowAction', action),
  quit: () => call('quit')
}

contextBridge.exposeInMainWorld('vpn', api)
