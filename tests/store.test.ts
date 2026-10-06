import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseInput } from '../core'
import type { ParsedServer } from '../core'
import { DataStore, SecureStorageError, displayUrlOf, type Sealer } from '../electron/store'
import { DEFAULT_SETTINGS } from '../shared/defaults'
import { GOOD, UUID } from './fixtures'
import { removeDir, tempDir } from './helpers/loopback'

/** Условное «шифрование»: достаточно, чтобы убедиться, что в файл попадает не открытый текст. */
const fakeSealer: Sealer & { enabled: boolean } = {
  enabled: true,
  available() { return this.enabled },
  seal: (p) => 'SEALED:' + Buffer.from(p.split('').reverse().join('')).toString('base64'),
  open: (s) => Buffer.from(s.replace(/^SEALED:/, ''), 'base64').toString().split('').reverse().join('')
}

let dir: string
let file: string
const servers = (...keys: string[]): ParsedServer[] =>
  keys.flatMap((k) => {
    const r = parseInput(k)
    if (r.kind !== 'servers') throw new Error('ключ не разобрался')
    return r.servers
  })

beforeEach(() => { dir = tempDir('tropa-store-'); file = join(dir, 'data.json'); fakeSealer.enabled = true })
afterEach(() => removeDir(dir))

describe('хранилище', () => {
  it('в файле на диске нет ни ключей, ни паролей, ни идентификаторов — только зашифрованное', () => {
    const s = new DataStore(file, fakeSealer)
    s.addServers(servers(GOOD.vlessReality!, GOOD.trojan!, GOOD.hysteria2!))
    s.addSubscription('https://sub.example.com/very/secret/token-12345', 'Моя подписка')
    s.save(true)
    const text = readFileSync(file, 'utf8')
    for (const secret of [UUID, 'p@ss:w0rd', 'p%40ss', 'hy2pass', 'obfspw', 'token-12345', 'vless://', 'trojan://', 'hysteria2://', '3O42VkE_Tje1GYx65', '6ba85179e30d4fc2']) {
      expect(text, `в файле нашлось «${secret}»`).not.toContain(secret)
    }
    // а читать ключи обратно можно
    const again = new DataStore(file, fakeSealer)
    const id = again.servers[0]!.id
    expect(again.getSecret(id)!.outbound).toMatchObject({ type: 'vless', uuid: UUID })
    expect(again.getSecret(id)!.rawLink).toBe(GOOD.vlessReality)
  })

  it('повторный ключ не дублируется', () => {
    const s = new DataStore(file, fakeSealer)
    expect(s.addServers(servers(GOOD.trojan!)).added).toHaveLength(1)
    const r = s.addServers(servers(GOOD.trojan!, GOOD.tuic!))
    expect(r.added).toHaveLength(1)
    expect(r.duplicates).toBe(1)
    expect(s.servers).toHaveLength(2)
  })

  it('без системного шифрования ключи не сохраняются (и ничего не пишется открытым текстом)', () => {
    fakeSealer.enabled = false
    const s = new DataStore(file, fakeSealer)
    expect(() => s.addServers(servers(GOOD.trojan!))).toThrow(SecureStorageError)
    expect(s.servers).toHaveLength(0)
  })

  it('переименование, любимые, удаление и выбранный сервер', () => {
    const s = new DataStore(file, fakeSealer)
    const [a, b] = s.addServers(servers(GOOD.trojan!, GOOD.tuic!)).added
    s.updateSettings({ selectedServerId: a!.id })
    s.rename(a!.id, '  Домашний  ')
    s.rename(b!.id, '   ') // пустое имя игнорируется
    s.toggleFavorite(b!.id)
    expect(s.views().map((v) => [v.name, v.favorite])).toEqual([['Домашний', false], [b!.name, true]])
    s.removeServer(a!.id)
    expect(s.settings.selectedServerId).toBeNull()
    expect(s.servers).toHaveLength(1)
  })

  it('настройки переживают перезапуск; недостающие поля добираются из значений по умолчанию', () => {
    const s = new DataStore(file, fakeSealer)
    s.updateSettings({ mode: 'tun', palette: 'sunset' })
    s.updateAdvanced({ mtu: 1400 })
    s.save(true)
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    delete raw.settings.advanced.dnsRemote
    delete raw.settings.killSwitch
    writeFileSync(file, JSON.stringify(raw))
    const again = new DataStore(file, fakeSealer)
    expect(again.settings.mode).toBe('tun')
    expect(again.settings.palette).toBe('sunset')
    expect(again.settings.advanced.mtu).toBe(1400)
    expect(again.settings.advanced.dnsRemote).toBe(DEFAULT_SETTINGS.advanced.dnsRemote)
    expect(again.settings.killSwitch).toBe(false)
  })

  it('повреждённый файл не роняет программу: откладывается в сторону', () => {
    writeFileSync(file, '{"servers": [ это не json')
    const s = new DataStore(file, fakeSealer)
    expect(s.servers).toEqual([])
    expect(s.loadNote).toContain('повреждён')
    expect(readdirSync(dir).some((f) => f.startsWith('data.json.broken-'))).toBe(true)
  })

  it('запись атомарная: временного файла не остаётся', () => {
    const s = new DataStore(file, fakeSealer)
    s.addServers(servers(GOOD.trojan!))
    s.save(true)
    expect(existsSync(file + '.tmp')).toBe(false)
  })

  it('подписка: сверка добавляет новое, убирает исчезнувшее и сохраняет правки человека', () => {
    const s = new DataStore(file, fakeSealer)
    const sub = s.addSubscription('https://sub.example.com/t/abc', 'Поставщик')
    s.addServers(servers(GOOD.trojan!, GOOD.tuic!), sub.id)
    const trojan = s.servers.find((x) => x.protocol === 'trojan')!
    s.rename(trojan.id, 'Мой любимый')
    s.toggleFavorite(trojan.id)
    // у поставщика пропал tuic и появился hysteria2
    const r = s.reconcileSubscription(sub.id, servers(GOOD.trojan!, GOOD.hysteria2!))
    expect(r).toEqual({ added: 1, removed: 1, kept: 1, updated: 0 })
    expect(s.servers.map((x) => x.protocol).sort()).toEqual(['hysteria2', 'trojan'])
    const kept = s.server(trojan.id)!
    expect(kept.name).toBe('Мой любимый')
    expect(kept.favorite).toBe(true)
  })

  it('сервер, добавленный вручную, при появлении в подписке присоединяется, а не дублируется', () => {
    const s = new DataStore(file, fakeSealer)
    s.addServers(servers(GOOD.trojan!))
    const sub = s.addSubscription('https://sub.example.com/t/abc', '')
    s.reconcileSubscription(sub.id, servers(GOOD.trojan!, GOOD.tuic!))
    expect(s.servers).toHaveLength(2)
    expect(s.servers.every((x) => x.subscriptionId === sub.id)).toBe(true)
  })

  it('удаление подписки: с серверами и без', () => {
    const s = new DataStore(file, fakeSealer)
    const a = s.addSubscription('https://a.example.com/1', 'A')
    s.addServers(servers(GOOD.trojan!), a.id)
    const b = s.addSubscription('https://b.example.com/2', 'B')
    s.addServers(servers(GOOD.tuic!), b.id)
    s.removeSubscription(a.id, true)
    s.removeSubscription(b.id, false)
    expect(s.subscriptions).toHaveLength(0)
    expect(s.servers.map((x) => x.protocol)).toEqual(['tuic'])
    expect(s.servers[0]!.subscriptionId).toBeNull()
  })

  it('адрес подписки на экране показывается без секретной части', () => {
    expect(displayUrlOf('https://sub.example.com/api/v1/client/subscribe?token=SECRET')).toBe('https://sub.example.com/…')
    const s = new DataStore(file, fakeSealer)
    const sub = s.addSubscription('https://sub.example.com/api?token=SECRET', '')
    expect(JSON.stringify(s.subscriptionViews(new Set()))).not.toContain('SECRET')
    expect(sub.name).toBe('sub.example.com')
  })

  it('QR доступен только у серверов, у которых есть исходная ссылка', () => {
    const s = new DataStore(file, fakeSealer)
    s.addServers(servers(GOOD.trojan!))
    const fromJson = parseInput(JSON.stringify({ outbounds: [{ type: 'trojan', tag: 'J', server: 'j.example.com', server_port: 443, password: 'x', tls: { enabled: true } }] }))
    if (fromJson.kind !== 'servers') throw new Error('x')
    s.addServers(fromJson.servers)
    expect(s.views().map((v) => v.canQr)).toEqual([true, false])
  })
})
