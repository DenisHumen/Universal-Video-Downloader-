import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Browser-only preview of the renderer (no Electron) — used for visual UI
// testing. The app installs a mock window.api when the preload bridge is
// absent (see src/renderer/src/lib/mockApi.ts).
export default defineConfig({
  root: 'src/renderer',
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  plugins: [react()],
  // As in electron.vite.config.ts: icons are never inlined.
  build: { assetsInlineLimit: (file: string) => (file.endsWith('.svg') ? false : undefined) },
  server: { port: 5174 }
})
