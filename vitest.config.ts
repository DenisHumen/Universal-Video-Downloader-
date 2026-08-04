import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

/**
 * Unit tests cover the pure logic only — URL scoring, error classification,
 * quality selection, formatting, version comparison and translation coverage.
 * Anything that needs Electron lives behind those helpers on purpose.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    reporters: 'default'
  }
})
