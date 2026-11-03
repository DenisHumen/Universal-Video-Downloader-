import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { gzipSync } from 'zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'
import react from '@vitejs/plugin-react'

/*
  The renderer's size budget (UVD 4.0, plan 1.3).

  Builds the renderer the way electron-vite does (minified, same root and
  aliases) into a temp folder and holds the entry chunk and the stylesheet to a
  gzip budget. The budget is today's size plus a little headroom; a new runtime
  UI dependency of more than ~15 kB gzip cannot land without raising it here,
  on purpose and in review. Lazy chunks (the preview's mock bridge, anything
  split behind import()) do not count against the entry.
*/

const BUDGET = {
  /** Bundled fonts (L2): upright Ubuntu Sans + Ubuntu Sans Mono, unsubset. 1.31 MB today. */
  fonts: 1_500_000,
  /** Entry JS, gzip. 3.26.1 minified: ~180 kB; +15 kB headroom. */
  entryJs: 195_000,
  /** All CSS, gzip. 3.26.1: ~11 kB. */
  css: 16_000
}

const root = resolve(__dirname, '..')
let out = ''
let assets: { name: string; gzip: number }[] = []

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'uvd-budget-'))
  await build({
    configFile: false,
    logLevel: 'silent',
    mode: 'production',
    // Vitest runs with NODE_ENV=test, which would otherwise pull in React's development build.
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    root: join(root, 'src/renderer'),
    resolve: {
      alias: {
        '@': join(root, 'src/renderer/src'),
        '@shared': join(root, 'src/shared')
      }
    },
    plugins: [react()],
    build: { outDir: out, emptyOutDir: true, minify: 'esbuild', reportCompressedSize: false }
  })
  const dir = join(out, 'assets')
  assets = readdirSync(dir)
    .filter((f) => /\.(js|css)$/.test(f))
    .map((name) => ({ name, gzip: gzipSync(readFileSync(join(dir, name)), { level: 9 }).length }))
}, 120_000)

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true })
})

describe('renderer bundle budget', () => {
  it('keeps the entry chunk within budget', () => {
    const html = readFileSync(join(out, 'index.html'), 'utf-8')
    const entry = html.match(/assets\/([^"]+\.js)/)?.[1]
    const size = assets.find((a) => a.name === entry)?.gzip ?? Infinity
    expect(size, `entry ${entry} is ${size} B gzip`).toBeLessThanOrEqual(BUDGET.entryJs)
  })

  it('keeps the bundled fonts within budget, and ships them as built', () => {
    const dir = join(out, 'assets')
    const fonts = readdirSync(dir).filter((f) => /\.(ttf|woff2?)$/.test(f))
    expect(fonts.length).toBeGreaterThanOrEqual(2)
    const total = fonts.reduce((n, f) => n + readFileSync(join(dir, f)).length, 0)
    expect(total, `fonts are ${total} B`).toBeLessThanOrEqual(BUDGET.fonts)
  })

  it('keeps the stylesheet within budget', () => {
    const size = assets.filter((a) => a.name.endsWith('.css')).reduce((n, a) => n + a.gzip, 0)
    expect(size, `css is ${size} B gzip`).toBeLessThanOrEqual(BUDGET.css)
  })
})
