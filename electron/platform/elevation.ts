// Права администратора для режима «весь компьютер».
// Схема: один раз (с запросом Windows) создаём задачу планировщика «запускать с наивысшими правами».
// Дальше программа запускается этой задачей без всяких вопросов.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { powershellArgs, run, type Runner } from './exec'

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

export function buildTaskXml(opts: { exePath: string; args: string; user: string; description: string }): string {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>${escapeXml(opts.description)}</Description>
  </RegistrationInfo>
  <Triggers />
  <Principals>
    <Principal id="Author">
      <UserId>${escapeXml(opts.user)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>5</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${escapeXml(opts.exePath)}</Command>
      <Arguments>${escapeXml(opts.args)}</Arguments>
    </Exec>
  </Actions>
</Task>
`
}

/** Скрипт PowerShell, который просит Windows повысить права и выполняет schtasks от имени администратора. */
export function elevatedSchtasksScript(schtasksArgs: string[]): string {
  const list = schtasksArgs.map((a) => `'${a.replace(/'/g, "''")}'`).join(',')
  return `
$p = Start-Process -FilePath 'schtasks.exe' -ArgumentList ${list} -Verb RunAs -Wait -PassThru -WindowStyle Hidden
exit $p.ExitCode
`
}

export class Elevation {
  constructor(
    private readonly taskName: string,
    private readonly exec: Runner = run,
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  /** Запущены ли мы сейчас с правами администратора. */
  async isElevated(): Promise<boolean> {
    if (this.platform === 'win32') {
      // fltmc завершается успешно только у администратора
      const r = await this.exec('fltmc', [], { timeoutMs: 8000 })
      return r.code === 0
    }
    return typeof process.getuid === 'function' && process.getuid() === 0
  }

  async taskExists(): Promise<boolean> {
    if (this.platform !== 'win32') return false
    const r = await this.exec('schtasks', ['/Query', '/TN', this.taskName], { timeoutMs: 8000 })
    return r.code === 0
  }

  /** Создаёт задачу. Windows покажет окно «Разрешить?» — это и есть тот самый единственный запрос. */
  async createTask(exePath: string, args: string): Promise<{ ok: boolean; cancelled: boolean }> {
    if (this.platform !== 'win32') return { ok: false, cancelled: false }
    const dir = mkdtempSync(join(tmpdir(), 'tropa-task-'))
    try {
      const xmlPath = join(dir, 'task.xml')
      const user = process.env.USERDOMAIN && process.env.USERNAME ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : userInfo().username
      const xml = buildTaskXml({ exePath, args, user, description: 'Запуск программы с правами администратора без повторных вопросов (режим «Весь компьютер»)' })
      // schtasks принимает файл в UTF-16 с меткой порядка байтов
      writeFileSync(xmlPath, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]))
      const r = await this.exec('powershell.exe', powershellArgs(elevatedSchtasksScript(['/Create', '/TN', this.taskName, '/XML', xmlPath, '/F'])), { timeoutMs: 120000 })
      const exists = await this.taskExists()
      return { ok: exists, cancelled: !exists && r.code !== 0 }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  async deleteTask(): Promise<boolean> {
    if (this.platform !== 'win32') return false
    await this.exec('powershell.exe', powershellArgs(elevatedSchtasksScript(['/Delete', '/TN', this.taskName, '/F'])), { timeoutMs: 120000 })
    return !(await this.taskExists())
  }

  /** Запускает программу задачей (уже с правами администратора, без вопросов). */
  async runTask(): Promise<boolean> {
    if (this.platform !== 'win32') return false
    const r = await this.exec('schtasks', ['/Run', '/TN', this.taskName], { timeoutMs: 15000 })
    return r.code === 0
  }
}
