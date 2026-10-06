// Системный прокси Windows: «только браузер и программы, которые это умеют».
// Настройка живёт в реестре; после записи нужно сообщить системе (иначе браузеры не заметят).
import { powershellArgs, run, type Runner } from './exec'

export const INTERNET_SETTINGS = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'

/** Домашняя сеть и «свои» адреса — мимо прокси. */
export const PROXY_BYPASS = [
  'localhost', '127.*', '10.*', '172.16.*', '172.17.*', '172.18.*', '172.19.*', '172.20.*', '172.21.*', '172.22.*', '172.23.*', '172.24.*',
  '172.25.*', '172.26.*', '172.27.*', '172.28.*', '172.29.*', '172.30.*', '172.31.*', '192.168.*', '169.254.*', '*.local', '<local>'
].join(';')

export interface PreviousProxy {
  enable: number
  server: string
  override: string
}

export interface SystemProxy {
  readonly supported: boolean
  set(host: string, port: number): Promise<void>
  /** Вернуть прежние настройки (или просто выключить прокси). */
  clear(): Promise<void>
  /** Включён ли сейчас прокси, указывающий на этот адрес. */
  pointsTo(host: string, port: number): Promise<boolean>
}

export function regAddArgs(name: string, type: 'REG_DWORD' | 'REG_SZ', data: string): string[] {
  return ['add', INTERNET_SETTINGS, '/v', name, '/t', type, '/d', data, '/f']
}

export const REFRESH_SCRIPT = `
$sig = '[DllImport("wininet.dll", SetLastError=true)] public static extern bool InternetSetOption(IntPtr h, int o, IntPtr b, int l);'
$t = Add-Type -MemberDefinition $sig -Name WI -Namespace NativeProxy -PassThru
[void]$t::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0)
[void]$t::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0)
`

/** Разбор вывода `reg query ... /v Имя` без привязки к языку системы: берём последнюю часть строки с типом REG_*. */
export function parseRegValue(out: string, name: string): string | null {
  for (const line of out.split(/\r?\n/)) {
    const m = new RegExp(`^\\s*${name}\\s+REG_(?:SZ|DWORD|EXPAND_SZ)\\s+(.*)$`, 'i').exec(line)
    if (m) return m[1]!.trim()
  }
  return null
}

export function parseDword(v: string | null): number {
  if (v === null) return 0
  return v.toLowerCase().startsWith('0x') ? parseInt(v, 16) : Number(v) || 0
}

export class WindowsSystemProxy implements SystemProxy {
  readonly supported = true
  private previous: PreviousProxy | null = null

  constructor(
    private readonly persist: { load(): PreviousProxy | null; save(p: PreviousProxy | null): void },
    private readonly exec: Runner = run
  ) {
    this.previous = persist.load()
  }

  private async query(name: string): Promise<string | null> {
    const r = await this.exec('reg', ['query', INTERNET_SETTINGS, '/v', name])
    return r.code === 0 ? parseRegValue(r.stdout, name) : null
  }

  private async refresh(): Promise<void> {
    await this.exec('powershell.exe', powershellArgs(REFRESH_SCRIPT), { timeoutMs: 30000 })
  }

  async set(host: string, port: number): Promise<void> {
    const address = `${host}:${port}`
    if (!this.previous) {
      const server = (await this.query('ProxyServer')) ?? ''
      // если там уже наш адрес (после аварийного завершения), прежним его считать нельзя
      this.previous = {
        enable: parseDword(await this.query('ProxyEnable')),
        server: server === address ? '' : server,
        override: (await this.query('ProxyOverride')) ?? ''
      }
      if (server === address) this.previous.enable = 0
      this.persist.save(this.previous)
    }
    await this.exec('reg', regAddArgs('ProxyServer', 'REG_SZ', address))
    await this.exec('reg', regAddArgs('ProxyOverride', 'REG_SZ', PROXY_BYPASS))
    await this.exec('reg', regAddArgs('ProxyEnable', 'REG_DWORD', '1'))
    await this.refresh()
  }

  async clear(): Promise<void> {
    const prev = this.previous
    if (prev && prev.enable === 1 && prev.server) {
      await this.exec('reg', regAddArgs('ProxyServer', 'REG_SZ', prev.server))
      if (prev.override) await this.exec('reg', regAddArgs('ProxyOverride', 'REG_SZ', prev.override))
      await this.exec('reg', regAddArgs('ProxyEnable', 'REG_DWORD', '1'))
    } else {
      await this.exec('reg', regAddArgs('ProxyEnable', 'REG_DWORD', '0'))
    }
    this.previous = null
    this.persist.save(null)
    await this.refresh()
  }

  async pointsTo(host: string, port: number): Promise<boolean> {
    const enabled = parseDword(await this.query('ProxyEnable')) === 1
    const server = await this.query('ProxyServer')
    return enabled && server === `${host}:${port}`
  }
}

/** Для систем, где настройка системного прокси не реализована (разработка на Linux). */
export class NoopSystemProxy implements SystemProxy {
  readonly supported = false
  async set(): Promise<void> { /* нечего делать */ }
  async clear(): Promise<void> { /* нечего делать */ }
  async pointsTo(): Promise<boolean> { return false }
}
