import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

/**
 * Most unit tests cover pure logic; component tests (`*.test.tsx`) render in
 * jsdom with @testing-library and an axe pass (see test/setup-dom.ts).
 *
 * Originally unit tests covered the pure logic only — URL scoring, error classification,
 * quality selection, formatting, version comparison and translation coverage.
 * Anything that needs Electron lives behind those helpers on purpose. The
 * packaging checks in scripts/ are pure in the same way, and tested alongside.
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
    environmentMatchGlobs: [['src/renderer/**/*.test.tsx', 'jsdom']],
    setupFiles: ['test/setup-dom.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
    reporters: 'default'
  }
})
