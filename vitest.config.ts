import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

/**
 * Unit tests cover the pure logic only — URL scoring, error classification,
 * quality selection, formatting, version comparison and translation coverage.
 * Anything that needs Electron lives behind those helpers on purpose. The
 * packaging checks in scripts/ are pure in the same way, and tested alongside.
 *
 * Some of them still import modules that `require('electron')`, and since
 * Electron 42 that require downloads the ~100 MB binary when it is missing.
 * No test runs Electron, so unless one is named already it resolves to a
 * path in a directory that does not exist, and nothing is downloaded.
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
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    reporters: 'default',
    env: {
      ELECTRON_OVERRIDE_DIST_PATH:
        process.env.ELECTRON_OVERRIDE_DIST_PATH ?? resolve(__dirname, 'node_modules/.no-electron')
    }
  }
})
