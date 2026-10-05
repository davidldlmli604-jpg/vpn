import { motion } from 'framer-motion'
import type { ReactElement } from 'react'
import brand from '@brand'
import type { MotionLevel, Palette, ThemeMode } from '@shared/types'
import { Icon } from '../components/Icon'
import { Chips, Setting, Toggle } from '../components/controls'
import { withThemeTransition } from '../lib/themeTransition'
import { useApp, vpn } from '../store'

const PALETTES: Array<{ id: Palette; name: string; desc: string; a: string; b: string }> = [
  { id: 'aurora', name: 'Сияние', desc: 'Бирюза и фиолет — спокойно и свежо', a: '#35f0cf', b: '#8b7bff' },
  { id: 'sunset', name: 'Закат', desc: 'Коралл и малина — тепло и ярко', a: '#ff9a62', b: '#ff4d8d' },
  { id: 'forest', name: 'Хвоя', desc: 'Изумруд и золото — глубоко и строго', a: '#4be59b', b: '#e8c85a' }
]

export function Settings(): ReactElement {
  const app = useApp((s) => s.app)!
  const { settings, system } = app
  const set = (patch: Parameters<ReturnType<typeof vpn>['updateSettings']>[0]): void => void vpn().updateSettings(patch)
  const withWave = (e: React.MouseEvent, change: () => void): void => withThemeTransition({ x: e.clientX, y: e.clientY }, settings.motion, change)

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">Настройки</h1>
          <p className="page__lead">Внешний вид и поведение программы.</p>
        </div>
      </div>

      <section className="section">
        <h2 className="section__title">Оформление</h2>
        <div className="palettes" role="radiogroup" aria-label="Набор оформления">
          {PALETTES.map((p) => (
            <motion.button
              key={p.id}
              className="palette"
              role="radio"
              aria-checked={settings.palette === p.id}
              data-hint={`Набор цветов «${p.name}»: ${p.desc.toLowerCase()}. Меняется всё окно, включая цвет ошейника у меня.`}
              style={{ ['--p-a' as string]: p.a, ['--p-b' as string]: p.b }}
              whileTap={{ scale: 0.97 }}
              onClick={(e) => withWave(e, () => set({ palette: p.id }))}
            >
              <div className="palette__preview"><i /></div>
              <div className="palette__name">{p.name}</div>
              <div className="palette__desc">{p.desc}</div>
              {settings.palette === p.id && (
                <motion.span className="palette__tick" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }}><Icon name="check" size={14} strokeWidth={3} /></motion.span>
              )}
            </motion.button>
          ))}
        </div>
        <div className="glass card">
          <Setting name="Тема" hint="Тёмная — основная; светлая удобнее днём. «Как в системе» следует настройке Windows.">
            <div onClick={(e) => e.stopPropagation()}>
              <Chips<ThemeMode>
                label="Тема"
                value={settings.theme}
                onChange={(v) => set({ theme: v })}
                items={[{ value: 'dark', title: 'Тёмная', icon: 'moon', hint: 'Тёмная тема: приятнее вечером и в тёмной комнате.' }, { value: 'light', title: 'Светлая', icon: 'sun', hint: 'Светлая тема: удобнее днём и при ярком свете.' }, { value: 'system', title: 'Как в системе', icon: 'monitor', hint: 'Окно само станет светлым или тёмным — как настроено в Windows.' }]}
              />
            </div>
          </Setting>
          <Setting name="Анимации" hint="Чем их меньше, тем меньше нагрузка на слабый компьютер.">
            <Chips<MotionLevel>
              label="Анимации"
              value={settings.motion}
              onChange={(v) => set({ motion: v })}
              items={[{ value: 'full', title: 'Все', hint: 'Все эффекты: переливы фона, частицы вокруг кнопки, плавные переходы. Красиво, но требует мощности.' }, { value: 'calm', title: 'Спокойные', hint: 'Без тяжёлых фоновых эффектов — окно легче для слабого компьютера.' }, { value: 'off', title: 'Выключены', hint: 'Никакого движения: всё меняется мгновенно. Самый лёгкий вариант.' }]}
            />
          </Setting>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">Помощник</h2>
        <div className="glass card">
          <Setting name="Шелти-помощник" hint="Собака внизу слева: следит за курсором и подсказывает, что делает кнопка, на которую вы навели мышку." help="Это я! Если включено — я подсказываю по наведению мыши. Выключите, если мешаю, — мне будет немного грустно, но я пойму.">
            <Toggle label="Шелти-помощник" checked={settings.assistant} onChange={(v) => set({ assistant: v })} />
          </Setting>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">Подключение</h2>
        <div className="glass card">
          <Setting name="Переподключаться при обрыве" tech="автопереподключение" hint="Если связь пропала, программа сама попробует подключиться снова. Лучше оставить включённым.">
            <Toggle label="Переподключаться при обрыве" checked={settings.autoReconnect} onChange={(v) => set({ autoReconnect: v })} />
          </Setting>
          <Setting name="Уведомления" hint="Небольшие сообщения справа внизу: подключено, отключено, связь оборвалась.">
            <Toggle label="Уведомления" checked={settings.notifications} onChange={(v) => set({ notifications: v })} />
          </Setting>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">О программе</h2>
        <div className="glass card" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div className="card__title">{brand.name} {system.appVersion}</div>
            <div className="card__hint">{brand.tagline}</div>
          </div>
          <div style={{ marginLeft: 'auto' }} className="tech">
            движок sing-box {system.singbox.version ?? (system.singbox.found ? '' : 'не найден')}
          </div>
        </div>
      </section>
    </div>
  )
}
