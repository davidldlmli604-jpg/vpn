// Угадывание страны по названию сервера: флаг-эмодзи, двухбуквенный код или название страны.

const NAMES: Record<string, string> = {
  // русские названия (основы слов, чтобы подходили падежи)
  россия: 'RU', росси: 'RU', москва: 'RU', санкт: 'RU',
  германия: 'DE', германи: 'DE', франкфурт: 'DE', берлин: 'DE',
  нидерланд: 'NL', голландия: 'NL', голланди: 'NL', амстердам: 'NL',
  финляндия: 'FI', финлянд: 'FI', хельсинки: 'FI',
  швеция: 'SE', швеци: 'SE', стокгольм: 'SE',
  швейцария: 'CH', швейцари: 'CH', цюрих: 'CH',
  сша: 'US', америка: 'US', американ: 'US',
  великобритания: 'GB', британи: 'GB', англия: 'GB', англи: 'GB', лондон: 'GB',
  франция: 'FR', франци: 'FR', париж: 'FR',
  польша: 'PL', польш: 'PL', варшава: 'PL',
  турция: 'TR', турци: 'TR', стамбул: 'TR',
  казахстан: 'KZ', казахстан_: 'KZ', алматы: 'KZ', астана: 'KZ',
  украина: 'UA', украин: 'UA',
  беларусь: 'BY', белоруси: 'BY', минск: 'BY',
  армения: 'AM', армени: 'AM', ереван: 'AM',
  грузия: 'GE', грузи: 'GE', тбилиси: 'GE',
  латвия: 'LV', латви: 'LV', рига: 'LV',
  литва: 'LT', литв: 'LT', вильнюс: 'LT',
  эстония: 'EE', эстони: 'EE', таллин: 'EE',
  япония: 'JP', япони: 'JP', токио: 'JP',
  сингапур: 'SG',
  гонконг: 'HK',
  индия: 'IN', инди: 'IN',
  италия: 'IT', itali: 'IT',
  испания: 'ES', испани: 'ES', мадрид: 'ES',
  канада: 'CA', канад: 'CA', торонто: 'CA',
  австрия: 'AT', австри: 'AT', вена: 'AT',
  чехия: 'CZ', чехи: 'CZ', прага: 'CZ',
  румыния: 'RO', румыни: 'RO',
  болгария: 'BG', болгари: 'BG',
  сербия: 'RS', серби: 'RS',
  израиль: 'IL', израил: 'IL',
  оаэ: 'AE', эмират: 'AE', дубай: 'AE',
  корея: 'KR', коре: 'KR', сеул: 'KR',
  австралия: 'AU', австрали: 'AU', сидней: 'AU',
  бразилия: 'BR', бразили: 'BR',
  норвегия: 'NO', норвег: 'NO',
  дания: 'DK', дани: 'DK',
  ирландия: 'IE', ирланди: 'IE',
  португалия: 'PT', португали: 'PT',
  молдова: 'MD', молдов: 'MD',
  кыргызстан: 'KG', узбекистан: 'UZ', азербайджан: 'AZ',
  // английские названия и города
  russia: 'RU', moscow: 'RU',
  germany: 'DE', frankfurt: 'DE', berlin: 'DE', falkenstein: 'DE', nuremberg: 'DE',
  netherlands: 'NL', holland: 'NL', amsterdam: 'NL',
  finland: 'FI', helsinki: 'FI',
  sweden: 'SE', stockholm: 'SE',
  switzerland: 'CH', zurich: 'CH',
  'united states': 'US', usa: 'US', america: 'US', 'new york': 'US', 'los angeles': 'US', miami: 'US', dallas: 'US', chicago: 'US', seattle: 'US', ashburn: 'US',
  'united kingdom': 'GB', britain: 'GB', england: 'GB', london: 'GB',
  france: 'FR', paris: 'FR',
  poland: 'PL', warsaw: 'PL',
  turkey: 'TR', turkiye: 'TR', istanbul: 'TR',
  kazakhstan: 'KZ', almaty: 'KZ',
  ukraine: 'UA', belarus: 'BY', armenia: 'AM', georgia: 'GE',
  latvia: 'LV', lithuania: 'LT', estonia: 'EE',
  japan: 'JP', tokyo: 'JP', singapore: 'SG', 'hong kong': 'HK', hongkong: 'HK',
  india: 'IN', italy: 'IT', spain: 'ES', madrid: 'ES', canada: 'CA', toronto: 'CA',
  austria: 'AT', vienna: 'AT', czech: 'CZ', prague: 'CZ', romania: 'RO', bulgaria: 'BG', serbia: 'RS',
  israel: 'IL', emirates: 'AE', dubai: 'AE', korea: 'KR', seoul: 'KR', australia: 'AU', sydney: 'AU',
  brazil: 'BR', norway: 'NO', denmark: 'DK', ireland: 'IE', portugal: 'PT', moldova: 'MD',
  kyrgyzstan: 'KG', uzbekistan: 'UZ', azerbaijan: 'AZ', taiwan: 'TW', vietnam: 'VN', thailand: 'TH', indonesia: 'ID',
  mexico: 'MX', argentina: 'AR', chile: 'CL', 'south africa': 'ZA', egypt: 'EG', iceland: 'IS', luxembourg: 'LU', belgium: 'BE',
  greece: 'GR', hungary: 'HU', slovakia: 'SK', slovenia: 'SI', croatia: 'HR', cyprus: 'CY', malta: 'MT'
}

const CODES = new Set(
  (
    'AD AE AF AL AM AO AR AT AU AZ BA BD BE BG BH BR BY CA CH CL CN CO CR CY CZ DE DK DO DZ EC EE EG ES FI FR GB GE GR HK HR HU ID IE IL IN IQ IR IS IT JO JP KE KG KR KW KZ LB LI LK LT LU LV MA MD ME MK MN MT MX MY NG NL NO NP NZ OM PA PE PH PK PL PT QA RO RS RU SA SE SG SI SK TH TJ TM TN TR TW UA US UY UZ VE VN ZA'
  ).split(' ')
)

/** Флаг-эмодзи (пара «региональных индикаторов») → код страны. */
export function flagEmojiToCode(text: string): string | undefined {
  const cps = Array.from(text).map((c) => c.codePointAt(0)!)
  for (let i = 0; i < cps.length - 1; i++) {
    const a = cps[i]!
    const b = cps[i + 1]!
    if (a >= 0x1f1e6 && a <= 0x1f1ff && b >= 0x1f1e6 && b <= 0x1f1ff) {
      return String.fromCharCode(a - 0x1f1e6 + 65, b - 0x1f1e6 + 65)
    }
  }
  return undefined
}

/** Убирает флаги-эмодзи: в Windows они рисуются как две буквы, а настоящие флаги мы показываем сами. */
export function stripFlagEmoji(text: string): string {
  return text.replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, '').replace(/\s{2,}/g, ' ').trim()
}

export function guessCountry(name: string): string | undefined {
  const fromFlag = flagEmojiToCode(name)
  if (fromFlag) return fromFlag
  const lower = name.toLowerCase()
  // двухбуквенный код отдельным словом: «NL-1», «DE | Frankfurt», «[us] fast»
  const tokens = name.split(/[^A-Za-z]+/).filter((t) => t.length === 2)
  for (const t of tokens) {
    const up = t.toUpperCase()
    if (t === up && CODES.has(up)) return up
  }
  // по названию (длинные ключи проверяем раньше коротких)
  const keys = Object.keys(NAMES).sort((a, b) => b.length - a.length)
  for (const key of keys) {
    if (key.length < 4) continue
    if (lower.includes(key)) return NAMES[key]
  }
  for (const t of tokens) {
    const up = t.toUpperCase()
    if (CODES.has(up)) return up
  }
  return undefined
}
