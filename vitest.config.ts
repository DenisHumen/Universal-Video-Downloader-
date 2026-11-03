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
    environmentMatchGlobs: [['src/renderer/**/*.test.tsx', 'jsdom']],
    setupFiles: ['test/setup-dom.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
    // Agent worktrees and other checkouts nested under .claude/ are never this checkout's tests.
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**', '**/.claude/worktrees/**'],
    reporters: 'default',
    env: {
      ELECTRON_OVERRIDE_DIST_PATH:
        process.env.ELECTRON_OVERRIDE_DIST_PATH ?? resolve(__dirname, 'node_modules/.no-electron')
    }
  }
})
