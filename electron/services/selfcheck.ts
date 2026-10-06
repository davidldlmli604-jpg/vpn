// Кнопка «Проверить, всё ли работает»: последовательность коротких проверок и итог простыми словами.
// Сама логика не знает про сеть и движок — всё нужное приходит через CheckDeps (в тестах там подставные ответы).
import type { CheckReport, CheckStep, Mode } from '../../shared/types'
import { countryNameRu } from './ipcheck'

export interface ExitLookup {
  ip: string | null
  countryCode: string | null
  countryName: string | null
  error: string | null
}

export interface CheckDeps {
  mode: Mode | null
  serverName: string
  /** Страна, которую мы ожидаем для сервера (по названию); null — неизвестно. */
  serverCountry: string | null
  bypassRu: boolean
  dnsLeakProtection: boolean
  /** Задержка до интернета через сервер (мс) или null, если ответа нет. */
  probe(): Promise<number | null>
  /** Выходной адрес и страна — как их видит интернет через VPN. */
  fetchExit(): Promise<ExitLookup>
  /** Настоящий адрес без VPN. Есть только в режиме «Браузер и программы» (в туннеле программа сама идёт через VPN). */
  fetchRealExit(): Promise<ExitLookup | null>
  /** Адрес узла, который за нас искал адреса сайтов (смотрит сам движок); null — не вышло. */
  dnsResolverIp(): Promise<string | null>
  countryOf(ip: string): Promise<string | null>
  /** Российский сайт: ответил ли и каким выходом обработан. */
  ruDirect(): Promise<{ ms: number | null; chain: string | null }>
  isCancelled?(): boolean
  onUpdate(report: CheckReport): void
}

const TITLES: Record<CheckStep['id'], string> = {
  server: 'Связь с сервером',
  address: 'Ваш адрес в интернете',
  dns: 'Поиск адресов сайтов (DNS)',
  'ru-direct': 'Российские сайты напрямую'
}
const ORDER: Array<CheckStep['id']> = ['server', 'address', 'dns', 'ru-direct']

export function newReport(): CheckReport {
  return { startedAt: Date.now(), finished: false, steps: ORDER.map((id) => ({ id, title: TITLES[id], status: 'pending', detail: '' })), summary: '', verdict: null }
}

/** Итоговая фраза и вердикт по результатам шагов. */
export function summarize(steps: CheckStep[], exitName: string | null, bypassRu: boolean): { summary: string; verdict: 'ok' | 'warn' | 'fail' } {
  const bad = steps.find((s) => s.status === 'fail')
  if (bad) {
    const tip = bad.id === 'server' ? ' Попробуйте выключить и снова включить VPN или выбрать другой сервер.' : ''
    return { verdict: 'fail', summary: `Есть проблема. ${bad.detail}${tip}` }
  }
  const warn = steps.find((s) => s.status === 'warn')
  if (warn) return { verdict: 'warn', summary: `В целом работает, но есть замечание. ${warn.detail}` }
  return {
    verdict: 'ok',
    summary: `Всё работает. Интернет идёт через ${exitName ?? 'сервер'}${bypassRu ? ', а российские сайты открываются напрямую — быстро и без лишних входов' : ''}.`
  }
}

export async function runSelfCheck(d: CheckDeps): Promise<CheckReport> {
  const report = newReport()
  const cancelled = (): boolean => !!d.isCancelled?.()
  const publish = (): void => d.onUpdate({ ...report, steps: report.steps.map((s) => ({ ...s })) })
  const step = (id: CheckStep['id']): CheckStep => report.steps.find((s) => s.id === id)!
  const set = (id: CheckStep['id'], status: CheckStep['status'], detail = ''): void => {
    const s = step(id)
    s.status = status
    s.detail = detail
    publish()
  }
  publish()
  let exitName: string | null = null
  let exitCode: string | null = null

  // 1. связь с сервером
  set('server', 'running')
  const ms = await d.probe()
  if (cancelled()) return report
  if (ms === null) set('server', 'fail', `Сервер «${d.serverName}» не отвечает: запрос до интернета через него не проходит.`)
  else if (ms >= 600) set('server', 'warn', `Сервер «${d.serverName}» отвечает очень медленно (${ms} мс). Страницы могут открываться с задержкой — попробуйте другой сервер.`)
  else set('server', 'ok', `Сервер отвечает за ${ms} мс.`)

  // 2. адрес в интернете
  set('address', 'running')
  const exit = await d.fetchExit()
  if (cancelled()) return report
  if (!exit.countryCode) {
    set('address', ms === null ? 'fail' : 'warn', ms === null ? 'Определить адрес не удалось: связь через сервер не работает.' : 'Не удалось определить ваш адрес: служба определения не ответила. Это ещё не значит, что VPN не работает.')
  } else {
    exitCode = exit.countryCode
    exitName = exit.countryName ?? countryNameRu(exit.countryCode)
    const real = d.mode === 'proxy' ? await d.fetchRealExit() : null
    if (cancelled()) return report
    if (real?.ip && exit.ip && real.ip === exit.ip) {
      set('address', 'fail', 'Ваш адрес не изменился: проверка идёт мимо VPN. Попробуйте выключить и снова включить VPN.')
    } else if (exit.countryCode === 'RU' && d.serverCountry !== 'RU') {
      set('address', 'warn', `Сайты видят вас из России, хотя сервер «${d.serverName}» не в России. Возможно, часть трафика идёт мимо VPN.`)
    } else {
      set('address', 'ok', `Сайты видят вас из страны: ${exitName}.`)
    }
  }

  // 3. поиск адресов сайтов: не отдаём ли мы провайдеру список посещаемых сайтов
  set('dns', 'running')
  const resolverIp = await d.dnsResolverIp()
  if (cancelled()) return report
  if (!resolverIp) {
    set('dns', 'warn', 'Проверить не удалось: служба не ответила. Попробуйте позже.')
  } else {
    const where = await d.countryOf(resolverIp)
    if (cancelled()) return report
    if (!where) set('dns', 'warn', 'Не удалось узнать, где находится узел, который ищет адреса сайтов.')
    else if (where === 'RU' && exitCode !== 'RU') {
      set('dns', 'warn', d.dnsLeakProtection
        ? 'Адреса сайтов ищет российский узел, хотя защита DNS включена. Попробуйте выключить и снова включить VPN.'
        : 'Защита от утечки DNS выключена: адреса сайтов ищет ваш интернет-провайдер, и ему видно, какие сайты вы открываете. Включите «Защиту от утечки DNS» в настройках.')
    } else {
      set('dns', 'ok', d.dnsLeakProtection ? 'Адреса сайтов ищутся через VPN — провайдер не видит, какие сайты вы открываете.' : 'Адреса сайтов ищутся не через вашего провайдера.')
    }
  }

  // 4. российские сайты напрямую
  if (!d.bypassRu) {
    set('ru-direct', 'ok', 'Вы выключили «Российские сайты напрямую», поэтому они идут через VPN — так и задумано.')
  } else {
    set('ru-direct', 'running')
    const ru = await d.ruDirect()
    if (cancelled()) return report
    if (ru.ms === null) set('ru-direct', 'warn', 'Российский сайт (ya.ru) не открылся. Если он открывается без VPN, проверьте связь и повторите.')
    else if (ru.chain === 'direct') set('ru-direct', 'ok', `Российский сайт открылся напрямую за ${ru.ms} мс — мимо VPN, как и должно быть.`)
    else if (ru.chain) set('ru-direct', 'warn', 'Российский сайт открылся, но через VPN, а не напрямую. Банки и Госуслуги могут капризничать. Проверьте списки на вкладке «Мимо VPN».')
    else set('ru-direct', 'ok', `Российский сайт открылся за ${ru.ms} мс.`)
  }

  const { summary, verdict } = summarize(report.steps, exitName, d.bypassRu)
  report.summary = summary
  report.verdict = verdict
  report.finished = true
  publish()
  return report
}
