import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { UpdateService, humanUpdateError, type UpdaterLike } from '../electron/updater'

class FakeUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = false
  autoInstallOnAppQuit = true
  checks = 0
  installs: Array<[boolean | undefined, boolean | undefined]> = []
  async checkForUpdates(): Promise<unknown> { this.checks++; return null }
  quitAndInstall(a?: boolean, b?: boolean): void { this.installs.push([a, b]) }
}

function make(u: FakeUpdater | null) {
  const told: string[] = []
  const ready: string[] = []
  const svc = new UpdateService(u, { onChange: () => undefined, log: () => undefined, tell: (_k, t) => told.push(t), onReady: (v) => ready.push(v) })
  return { svc, told, ready }
}

describe('автообновление', () => {
  it('без установленной программы — «вручную», проверка честно говорит об этом', async () => {
    const { svc, told } = make(null)
    expect(svc.state.status).toBe('unsupported')
    await svc.check(true)
    expect(told[0]).toMatch(/только в установленной/)
    expect(svc.installNow()).toBe(false)
  })

  it('нашлась версия → скачивание с процентами → готово; ставится по кнопке один раз', async () => {
    const u = new FakeUpdater()
    const { svc, told, ready } = make(u)
    expect(u.autoDownload).toBe(true)
    expect(u.autoInstallOnAppQuit).toBe(false)
    await svc.check(false)
    expect(u.checks).toBe(1)
    u.emit('checking-for-update')
    u.emit('update-available', { version: '0.2.7' })
    u.emit('download-progress', { percent: 41.6 })
    expect(svc.state).toMatchObject({ status: 'downloading', version: '0.2.7', percent: 42 })
    u.emit('update-downloaded', { version: '0.2.7' })
    expect(svc.state.status).toBe('ready')
    expect(ready).toEqual(['0.2.7'])
    expect(told.at(-1)).toMatch(/0\.2\.7/)
    // уже скачано — повторная проверка не нужна
    await svc.check(true)
    expect(u.checks).toBe(1)
    expect(svc.installNow()).toBe(true)
    expect(svc.installOnQuit()).toBe(false) // уже ставится
    expect(u.installs).toEqual([[true, true]])
  })

  it('при закрытии программы скачанная версия ставится тихо и без перезапуска', () => {
    const u = new FakeUpdater()
    const { svc } = make(u)
    expect(svc.installOnQuit()).toBe(false) // ещё нечего ставить
    u.emit('update-downloaded', { version: '0.2.8' })
    expect(svc.installOnQuit()).toBe(true)
    expect(u.installs).toEqual([[true, false]])
  })

  it('ошибки: фоновые — молча, ручные — человеческими словами; уже скачанное не теряется', async () => {
    const u = new FakeUpdater()
    const { svc, told } = make(u)
    await svc.check(false)
    u.emit('error', new Error('getaddrinfo ENOTFOUND github.com'))
    expect(svc.state.status).toBe('error')
    expect(told).toEqual([])
    await svc.check(true)
    u.emit('update-not-available')
    expect(told).toEqual(['У вас последняя версия.'])
    u.emit('update-downloaded', { version: '0.2.9' })
    u.emit('error', new Error('net::ERR_CONNECTION_RESET'))
    expect(svc.state.status).toBe('ready')
    expect(humanUpdateError('HttpError: 404 Not Found latest.yml')).toMatch(/нет выпущенных/)
  })

  it('фоновые проверки: первая вскоре после запуска, дальше раз в 6 часов; выключаются настройкой', () => {
    vi.useFakeTimers()
    try {
      const u = new FakeUpdater()
      const { svc } = make(u)
      svc.schedule(true)
      vi.advanceTimersByTime(21_000)
      expect(u.checks).toBe(1)
      u.emit('update-not-available')
      vi.advanceTimersByTime(6 * 3600_000)
      expect(u.checks).toBe(2)
      svc.schedule(false)
      vi.advanceTimersByTime(24 * 3600_000)
      expect(u.checks).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
