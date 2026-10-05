import type { KeyError, KeyErrorCode } from './types'

/** Все сообщения для человека — здесь, в одном месте. Никакой техники в основном тексте. */
const TEXTS: Record<KeyErrorCode, string> = {
  empty: 'Буфер обмена пуст. Скопируйте ключ и нажмите кнопку ещё раз.',
  'not-a-key':
    'Это не похоже на ключ. Ключ начинается с vless://, vmess://, trojan://, ss://, hysteria2:// или tuic://. Ещё подойдёт ссылка на подписку (https://…) или готовый файл настроек sing-box.',
  broken: 'Ключ повреждён или скопирован не целиком. Скопируйте его заново с самого начала до самого конца.',
  'missing-host': 'В ключе нет адреса сервера. Скорее всего, он скопирован не целиком.',
  'missing-port': 'В ключе не указан порт сервера. Скорее всего, он скопирован не целиком.',
  'bad-port': 'В ключе указан неверный порт сервера. Проверьте, что ключ скопирован целиком.',
  'missing-secret': 'В ключе нет пароля или идентификатора. Скорее всего, он скопирован не целиком.',
  'bad-secret': 'Идентификатор в ключе записан с ошибкой. Скопируйте ключ заново.',
  'bad-encoding': 'Не удаётся прочитать ключ: он закодирован с ошибкой. Скопируйте его заново.',
  'bad-json': 'Файл настроек повреждён: его не получилось прочитать. Проверьте, что скопирован весь текст.',
  'unsupported-protocol': 'Такой тип ключа программа пока не умеет. Попросите у поставщика ключ другого типа.',
  'unsupported-transport': 'Этот способ подключения программа пока не умеет. Попросите у поставщика ключ другого типа, например VLESS Reality.',
  'unsupported-cipher': 'Шифр, указанный в ключе, программа не поддерживает. Попросите у поставщика другой ключ.',
  'unsupported-feature': 'В ключе используется возможность, которую программа пока не умеет.',
  'no-servers': 'В этих данных не нашлось ни одного понятного ключа.'
}

export function keyError(code: KeyErrorCode, detail?: string, extra?: string): KeyError {
  const message = extra ? `${TEXTS[code]} ${extra}` : TEXTS[code]
  return { code, message, ...(detail ? { detail } : {}) }
}

/** Внутреннее исключение разбора: ловится на верхнем уровне и превращается в KeyError. */
export class ParseAbort extends Error {
  constructor(public readonly keyError: KeyError) {
    super(keyError.message)
  }
}

export function abort(code: KeyErrorCode, detail?: string, extra?: string): never {
  throw new ParseAbort(keyError(code, detail, extra))
}
