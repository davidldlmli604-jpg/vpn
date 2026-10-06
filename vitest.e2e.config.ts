import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// Проверка настоящего приложения в Electron (на Linux — под виртуальным экраном): npm run test:e2e
export default defineConfig({
  resolve: { alias: { '@core': resolve(__dirname, 'core'), '@shared': resolve(__dirname, 'shared'), '@brand': resolve(__dirname, 'brand.json') } },
  test: { include: ['tests/e2e/**/*.e2e.ts'], testTimeout: 120000, hookTimeout: 120000, fileParallelism: false }
})
