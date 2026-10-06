import type { HumanError } from './types'

const h = (code: string, title: string, text: string): HumanError => ({ code, title, text })

/**
 * Превращает вывод движка в слова, понятные человеку. Технические подробности остаются только в журнале.
 * Порядок важен: сверху — самые точные признаки.
 */
export function humanizeEngineLog(log: string, ctx?: { mode?: 'tun' | 'proxy' }): HumanError {
  const t = log.replace(/\x1b\[[0-9;]*m/g, '')
  const has = (re: RegExp): boolean => re.test(t)

  if (has(/(Access is denied|access denied|operation not permitted|requires elevation|administrator|Отказано в доступе)/i) && (ctx?.mode === 'tun' || has(/tun|wintun|interface|route/i))) {
    return h('need-admin', 'Не хватает прав администратора', 'Для режима «Весь компьютер» программе нужно разрешение администратора. Откройте «Защита» или «Режим» и разрешите его, либо выберите режим «Только браузер и программы».')
  }
  if (has(/(wintun|create tun|configure tun interface|add address|tun: )/i) && has(/(fail|error|denied|unsupported|not supported)/i)) {
    return h('tun-failed', 'Не удалось создать защищённый канал', 'Не получилось включить режим «Весь компьютер». Попробуйте выбрать режим «Только браузер и программы» или перезапустить программу от имени администратора.')
  }
  if (has(/(address already in use|bind: .*only one usage|port is already allocated|listen tcp .*: bind)/i)) {
    return h('port-busy', 'Порт занят другой программой', 'Нужный сетевой порт уже занят. Закройте другие VPN-программы или поменяйте порт в разделе «Для специалиста».')
  }
  if (has(/(reality|REALITY).*(verification|failed|authentication)|invalid short id|bad public key/i) || has(/handshake.*(rejected|fail)/i)) {
    return h('server-rejected', 'Сервер отклонил подключение', 'Скорее всего, ключ устарел или в нём ошибка. Попросите у поставщика новый ключ.')
  }
  if (has(/(x509|certificate|tls: bad certificate|unknown authority|certificate has expired|SNI)/i)) {
    return h('certificate', 'Не удалось проверить безопасность сервера', 'У сервера проблема с сертификатом: он устарел или не подходит. Попросите у поставщика новый ключ.')
  }
  if (has(/(unauthorized|invalid user|auth(entication)? fail|wrong password|bad password|user not found|status 403|forbidden)/i)) {
    return h('auth', 'Сервер не принял ключ', 'Возможно, срок действия ключа закончился или лимит исчерпан. Спросите у поставщика.')
  }
  if (has(/(no such host|lookup .*(fail|NXDOMAIN)|dns: lookup failed|dial tcp: lookup|server misbehaving|name resolution)/i)) {
    return h('dns', 'Не находится адрес сервера', 'Не получилось узнать, где находится сервер. Проверьте, что интернет работает, и что ключ скопирован без ошибок.')
  }
  if (has(/(network is unreachable|no route to host|no connection could be made|network unreachable|dial udp: .*unreachable)/i)) {
    return h('offline', 'Нет доступа в интернет', 'Похоже, интернет сейчас не работает. Проверьте подключение и попробуйте снова.')
  }
  if (has(/(i\/o timeout|connection refused|connection reset|deadline exceeded|context canceled|EOF|timed out|actively refused)/i)) {
    return h('server-silent', 'Сервер не отвечает', 'Возможно, ключ устарел или введён с ошибкой. Если ключ точно рабочий, попробуйте другой сервер из списка или повторите позже.')
  }
  if (has(/(decode config|unknown field|json:|initialize outbound|parse rule-set|legacy)/i)) {
    return h('config', 'Не получилось запустить подключение', 'Настройки подключения оказались неверными. Попробуйте удалить этот сервер и добавить ключ заново.')
  }
  return h('unknown', 'Подключение не удалось', 'Что-то пошло не так. Попробуйте ещё раз; если не помогает — откройте «Для специалиста» → «Журнал» и покажите его тому, кто вам помогает.')
}

export function engineMissing(): HumanError {
  return h('engine-missing', 'Не найден движок подключения', 'Файл sing-box не найден рядом с программой. Переустановите программу.')
}

export function noServer(): HumanError {
  return h('no-server', 'Сначала добавьте ключ', 'Нажмите «Вставить ключ», чтобы добавить сервер.')
}

export function unexpectedExit(): HumanError {
  return h('exited', 'Подключение оборвалось', 'Движок неожиданно остановился. Если включено «Переподключаться при обрыве», программа попробует снова сама.')
}

export function needAdminHuman(): HumanError {
  return h('need-admin', 'Нужно разрешение администратора', 'Режим «Весь компьютер» работает только с правами администратора. Нажмите «Разрешить» в разделе «Режим» — Windows спросит один раз.')
}

/** Связь оборвалась, переподключаться само не будет, а защита включена: интернет намеренно закрыт. */
export function protectionHolding(): HumanError {
  return h('protection-holding', 'Связь оборвалась, интернет отключён защитой', 'Так задумано: пока VPN не вернётся, ничего не уходит в сеть напрямую. Нажмите большую кнопку, чтобы подключиться снова, а если нужен интернет без VPN — откройте «Защита» и нажмите «Починить интернет».')
}
