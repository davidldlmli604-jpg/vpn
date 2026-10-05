import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'core'),
      '@shared': resolve(__dirname, 'shared'),
      '@brand': resolve(__dirname, 'brand.json')
    }
  },
  test: {
    include: ['core/**/*.test.ts', 'tests/**/*.test.ts', 'electron/**/*.test.ts', 'shared/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000
  }
})
