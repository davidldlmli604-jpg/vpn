import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState, type ReactElement } from 'react'
import type { ConnStatus } from '@shared/types'
import { Sheltie, type Mood } from './Sheltie'

/** Шелти на телефоне: наведения мышью там нет, поэтому она просто рядом и коротко говорит, что происходит. */
function phrase(status: ConnStatus, noServers: boolean): string {
  if (noServers && status === 'off') return 'Привет! Скопируйте ключ и нажмите «Вставить ключ» — или отсканируйте QR-код.'
  switch (status) {
    case 'connecting': return 'Секунду, ищу дорогу к серверу…'
    case 'on': return 'Ура, подключились! Интернет идёт через VPN.'
    case 'error': return 'Ой, не получилось… Что случилось — написано над кнопкой.'
    case 'disconnecting': return 'Сворачиваю тропинку…'
    default: return 'Нажмите большую кнопку — и я поведу ваш интернет по тропе.'
  }
}

function moodOf(status: ConnStatus): Mood {
  if (status === 'on') return 'happy'
  if (status === 'connecting' || status === 'disconnecting') return 'alert'
  if (status === 'error') return 'worried'
  return 'idle'
}

export function MobileBuddy({ status, noServers }: { status: ConnStatus; noServers: boolean }): ReactElement {
  const [blinking, setBlinking] = useState(false)
  const [hop, setHop] = useState(0)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const loop = (): void => {
      t = setTimeout(() => {
        setBlinking(true)
        setTimeout(() => setBlinking(false), 140)
        loop()
      }, 2400 + Math.random() * 3600)
    }
    loop()
    return () => clearTimeout(t)
  }, [])
  const text = phrase(status, noServers)
  return (
    <div className="buddy">
      <button className="buddy__dog" aria-label="Шелти. Нажмите, чтобы погладить" onClick={() => setHop((h) => h + 1)}>
        <Sheltie mood={moodOf(status)} blinking={blinking} hop={hop > 0} key={`b${hop}`} />
      </button>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p key={text} className="buddy__say" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>
          {text}
        </motion.p>
      </AnimatePresence>
    </div>
  )
}
