// «Если VPN отвалился — отключить интернет». Только режим «весь компьютер» (нужны права администратора).
// Принцип: пока подключаемся и работаем, брандмауэр Windows запрещает всё исходящее, кроме
//   • самого движка (sing-box.exe) — чтобы он мог достучаться до сервера и переподключиться;
//   • трафика, идущего через туннель (его адрес-источник — адрес туннеля);
//   • домашней сети (роутер, принтер).
// Если движок упал, туннеля нет — наружу ничего не уходит, пока не переподключимся.
import { powershellArgs, run, type Runner } from './exec'

export const RULE_GROUP = 'TropaKillSwitch'
export const TUN_LOCAL_ADDRESS = '172.19.0.1'
export const TUN_LOCAL_ADDRESS_V6 = 'fdfe:dcba:9876::1'
export const LAN_RANGES = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '224.0.0.0/4', 'fe80::/10', 'ff00::/8', 'fc00::/7']

type Policy = 'Allow' | 'Block' | 'NotConfigured'
export interface ProfilePolicies {
  Domain: Policy
  Private: Policy
  Public: Policy
}

const q = (s: string): string => `'${s.replace(/'/g, "''")}'`

export function readPoliciesScript(): string {
  return `Get-NetFirewallProfile | ForEach-Object { '{0}={1}' -f $_.Name, $_.DefaultOutboundAction }`
}

export function parsePolicies(out: string): ProfilePolicies | null {
  const res: Partial<ProfilePolicies> = {}
  for (const line of out.split(/\r?\n/)) {
    const m = /^(Domain|Private|Public)=(\w+)/.exec(line.trim())
    if (m) res[m[1] as keyof ProfilePolicies] = m[2] as Policy
  }
  return res.Domain && res.Private && res.Public ? (res as ProfilePolicies) : null
}

export function armScript(engineExe: string, tunAddresses: string[] = [TUN_LOCAL_ADDRESS]): string {
  return `
$ErrorActionPreference = 'Stop'
Get-NetFirewallRule -Group ${q(RULE_GROUP)} -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'Tropa: движок' -Group ${q(RULE_GROUP)} -Direction Outbound -Action Allow -Program ${q(engineExe)} -Profile Any | Out-Null
New-NetFirewallRule -DisplayName 'Tropa: туннель' -Group ${q(RULE_GROUP)} -Direction Outbound -Action Allow -LocalAddress ${tunAddresses.map(q).join(',')} -Profile Any | Out-Null
New-NetFirewallRule -DisplayName 'Tropa: домашняя сеть' -Group ${q(RULE_GROUP)} -Direction Outbound -Action Allow -RemoteAddress ${LAN_RANGES.map(q).join(',')} -Profile Any | Out-Null
Set-NetFirewallProfile -Profile Domain,Private,Public -DefaultOutboundAction Block
`
}

export function disarmScript(prev: ProfilePolicies | null): string {
  const restore = (['Domain', 'Private', 'Public'] as const)
    .map((name) => `Set-NetFirewallProfile -Profile ${name} -DefaultOutboundAction ${prev && prev[name] !== 'Block' ? prev[name] : 'Allow'}`)
    .join('\n')
  return `
$ErrorActionPreference = 'Continue'
${restore}
Get-NetFirewallRule -Group ${q(RULE_GROUP)} -ErrorAction SilentlyContinue | Remove-NetFirewallRule
`
}

export interface KillSwitchStore {
  load(): { active: boolean; previous: ProfilePolicies | null }
  save(s: { active: boolean; previous: ProfilePolicies | null }): void
}

export class KillSwitch {
  readonly supported: boolean
  constructor(private readonly store: KillSwitchStore, private readonly exec: Runner = run, platform: NodeJS.Platform = process.platform) {
    this.supported = platform === 'win32'
  }

  get active(): boolean {
    return this.store.load().active
  }

  /** tunAddresses — адреса самого туннеля (у IPv4-туннеля один, при включённом IPv6 — два): с них идёт разрешённый трафик. */
  async arm(engineExe: string, tunAddresses: string[] = [TUN_LOCAL_ADDRESS]): Promise<{ ok: boolean; error?: string }> {
    if (!this.supported) return { ok: false, error: 'not-supported' }
    const saved = this.store.load()
    let previous = saved.previous
    if (!saved.active || !previous) {
      const r = await this.exec('powershell.exe', powershellArgs(readPoliciesScript()), { timeoutMs: 30000 })
      previous = parsePolicies(r.stdout)
    }
    // сначала записываем намерение: если программа упадёт посреди настройки, при следующем запуске всё вернётся
    this.store.save({ active: true, previous })
    const r = await this.exec('powershell.exe', powershellArgs(armScript(engineExe, tunAddresses)), { timeoutMs: 60000 })
    if (r.code !== 0) {
      await this.disarm()
      return { ok: false, error: r.stderr.trim().slice(0, 300) || 'не удалось настроить брандмауэр' }
    }
    return { ok: true }
  }

  /** Снимает защиту. Без force — только если она была включена (чтобы не запускать PowerShell при каждом отключении). */
  async disarm(force = false): Promise<void> {
    if (!this.supported) return
    const { previous, active } = this.store.load()
    if (!active && !force) return
    await this.exec('powershell.exe', powershellArgs(disarmScript(previous)), { timeoutMs: 60000 })
    this.store.save({ active: false, previous: null })
  }
}
