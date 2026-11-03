/**
 * Wheel-scroll regression check, in real layout (Chromium via Playwright,
 * against the preview and its mock bridge): `npm run check:scroll`.
 *
 * Settings' panels once did not scroll at all: the scroller wrapped a
 * navigation stack whose host clipped (`overflow-hidden` + `flex-1
 * min-h-0`), so the stack shrank to the scroller and the scroller never
 * overflowed. jsdom has no layout and cannot see that; this can.
 *
 * For every view, every Settings panel and subpage, the narrow panel list,
 * the palette and a long dialog, at 1220x700 and 720x600: if anything in the
 * pane runs past the bottom of the window, a wheel over the pane must change
 * some element's scrollTop.
 */
import { spawn } from 'child_process'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { chromium } from 'playwright-core'
import { DRIVER } from './shot-driver.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.argv.find((a) => a.startsWith('--port='))?.slice(7) ?? 5194)
const BASE = `http://localhost:${PORT}`

const SETTINGS_ROUTES = [
  'appearance',
  'downloads',
  'processing',
  'watching',
  'watching/shares',
  'watching/telegram',
  'detection',
  'access',
  'access/cookies-file',
  'network',
  'network/proxy#address',
  'system',
  'system/startup',
  'system/updates',
  'system/backup',
  'system/logs',
  'system/about',
  'system/about/troubleshooting',
  'system/about/credits',
  'system/about/legal'
]

const WATCH = `await window.api.autoAdd({ url: 'https://example.com/s', title: 'Series', provider: 'yummyani', translatorId: 'a',
  translatorName: 'AniLibria', quality: '1080p', enabled: true, intervalMinutes: 360, nextCheckAt: Date.now() + 7200e3,
  failures: 0, seen: [], steps: [{ id: 'd', kind: 'download', enabled: true }] });`

/** Each case: how to get there, and a selector for the pane to wheel over (centre of the window when absent). */
const CASES = [
  { name: 'home', setup: `await __uvdShot.view('home')` },
  { name: 'search', setup: `await __uvdShot.view('search'); await __uvdShot.search('big buck bunny')` },
  {
    name: 'activity',
    setup: `for (let i = 0; i < 4; i++) __uvdShot.seedQueue(); await __uvdShot.view('downloads')`
  },
  { name: 'watching', setup: `${WATCH} await __uvdShot.view('automation')` },
  { name: 'settings-list', setup: `await __uvdShot.view('settings')`, narrowOnly: true },
  ...SETTINGS_ROUTES.map((route) => ({
    name: `settings/${route}`,
    setup: `__uvdStore.getState().openSettings(${JSON.stringify(route)}); await new Promise((r) => setTimeout(r, 300))`
  })),
  // Long dialogs: a panel taller than the window scrolls inside itself.
  {
    name: 'shortcuts-dialog',
    setup: `await __uvdShot.view('home'); __uvdStore.getState().setShortcutsOpen(true); await new Promise((r) => setTimeout(r, 200))`,
    pane: '[role="dialog"]'
  },
  {
    name: 'add-watch-dialog',
    setup: `__uvdStore.getState().requestWatch({ url: '' }); await new Promise((r) => setTimeout(r, 400))`,
    pane: '[role="dialog"]'
  },
  {
    name: 'palette',
    setup: `await __uvdShot.view('home'); __uvdStore.getState().setPaletteOpen(true); await new Promise((r) => setTimeout(r, 200))`,
    pane: '[role="listbox"]'
  }
]

const SIZES = [
  { width: 1220, height: 700 },
  { width: 720, height: 600 }
]

function startPreview() {
  const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js')
  return spawn(process.execPath, [vite, '--config', 'vite.preview.config.ts', '--port', String(PORT), '--strictPort'], {
    cwd: root,
    stdio: 'ignore'
  })
}

async function waitForServer() {
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(BASE)).ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`preview did not start on ${BASE}`)
}

/** In the page: does the pane's content run past the window, and the sum of all scrollTops. */
const MEASURE = (paneSel) => {
  const pane = paneSel ? document.querySelector(paneSel) : document.querySelector('main') ?? document.body
  const box = pane.getBoundingClientRect()
  const bottom = Math.min(window.innerHeight, box.bottom)
  let overflows = false
  for (const el of pane.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    if (r.height > 0 && r.width > 0 && r.bottom > bottom + 4 && getComputedStyle(el).visibility !== 'hidden') {
      overflows = true
      break
    }
  }
  let total = 0
  for (const el of document.querySelectorAll('*')) total += el.scrollTop
  return { overflows, total, x: box.left + box.width / 2, y: Math.max(box.top, 0) + Math.min(box.height, bottom - box.top) / 2 }
}

async function main() {
  const server = startPreview()
  let browser
  const failures = []
  let checked = 0
  try {
    await waitForServer()
    browser = await chromium.launch()
    // Warm the dev server: its first transform (and a dep re-optimisation reload) must not land in a case.
    {
      const warm = await browser.newPage()
      await warm.goto(`${BASE}/?still`)
      await warm.waitForFunction(() => window.__uvdStore?.getState().ready === true, null, { timeout: 60_000 }).catch(() => undefined)
      await warm.close()
    }
    for (const size of SIZES) {
      for (const c of CASES) {
        if (c.narrowOnly && size.width > 860) continue
        for (let attempt = 1; attempt <= 2; attempt++) {
        const context = await browser.newContext({ viewport: size, reducedMotion: 'reduce' })
        const page = await context.newPage()
        try {
          await page.goto(`${BASE}/?still`)
          await page.waitForFunction(() => window.__uvdStore?.getState().ready === true, null, { timeout: 30_000 })
          await page.evaluate(DRIVER)
          const error = await page.evaluate(`(async () => { try { ${c.setup}; return null } catch (e) { return String(e) } })()`)
          if (error) throw new Error(error)
          await page.waitForTimeout(150)
          const before = await page.evaluate(MEASURE, c.pane ?? null)
          if (!before.overflows) break
          checked++
          await page.mouse.move(before.x, before.y)
          await page.mouse.wheel(0, 400)
          await page.waitForTimeout(200)
          const after = await page.evaluate(MEASURE, c.pane ?? null)
          if (after.total === before.total) failures.push(`${c.name} @ ${size.width}x${size.height}: content overflows but the wheel scrolled nothing`)
          break
        } catch (e) {
          // One retry for a slow page load; a real scroll failure is not an exception and is not retried.
          if (attempt === 2) failures.push(`${c.name} @ ${size.width}x${size.height}: ${e.message}`)
        } finally {
          await context.close()
        }
        }
      }
    }
  } finally {
    await browser?.close()
    server.kill()
  }
  for (const f of failures) console.log(`  ✗ ${f}`)
  console.log(failures.length ? `✗ ${failures.length} scroll failure(s)` : `✓ wheel scrolls every overflowing pane (${checked} checked)`)
  process.exit(failures.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
