import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Окно приложения (то, что видно на экране). Режим «mock» нужен только для
// того, чтобы смотреть оформление в обычном браузере без Electron.
export default defineConfig(({ mode }) => ({
  root: resolve(__dirname, 'src'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'core'),
      '@shared': resolve(__dirname, 'shared'),
      '@brand': resolve(__dirname, 'brand.json')
    }
  },
  build: {
    // Android-версия (mode android) собирается в отдельную папку — оттуда её забирает Capacitor
    outDir: resolve(__dirname, mode === 'android' ? 'dist-mobile' : 'dist'),
    emptyOutDir: true,
    // WebView на Android 8 обновляется через Google Play, но может быть и старше — берём с запасом
    target: mode === 'android' ? 'chrome90' : 'chrome130',
    sourcemap: false
  },
  server: { port: 5173, strictPort: true }
}))
