import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Окно приложения (то, что видно на экране). Режим «mock» нужен только для
// того, чтобы смотреть оформление в обычном браузере без Electron.
export default defineConfig({
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
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'chrome130',
    sourcemap: false
  },
  server: { port: 5173, strictPort: true }
})
