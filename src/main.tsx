import '@fontsource-variable/manrope'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/theme.css'
import './styles/base.css'
import './styles/components.css'
import brand from '@brand'
import { App } from './App'

document.title = brand.name

const root = createRoot(document.getElementById('root')!)
const direction = import.meta.env.MODE === 'mock' ? new URLSearchParams(location.search).get('direction') : null
if (direction) {
  // только для выбора оформления в режиме просмотра; в собранную программу не попадает
  void import('./dev/directions/Directions').then(({ Directions }) => root.render(<StrictMode><Directions n={direction} /></StrictMode>))
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
