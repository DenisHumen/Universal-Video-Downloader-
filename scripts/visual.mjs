/**
 * Visual-diff harness (UVD 4.0, plan item 1.1).
 *
 *   npm run visual          # compare every scene against tests/visual/baseline
 *   npm run visual:update   # re-baseline (only when a change is intended)
 *
 * Starts the browser preview (vite + the mock bridge) on its own port, drives
 * it with Playwright's Chromium, and screenshots every scene in both themes at
 * 720 and 1220 px, plus a Russian pass at 720 px in both themes - the width
 * where long Russian labels overflow first.
 *
 * Determinism (plan [v3] SE-c): fonts are the bundled Ubuntu Sans files the app
 * already ships, animations and transitions are off (reduced motion plus an
 * injected `transition:none; animation:none`), the clock is pinned, and the
 * comparison allows a small per-pixel tolerance for antialiasing.
 *
 * Flags: `--only=<substring>` limits the scenes, `--port=<n>` moves the
 * preview server, `--update` writes baselines instead of comparing.
 */
import { spawn } from 'child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { chromium } from 'playwright-core'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
import { DRIVER } from './shot-driver.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const UPDATE = process.argv.includes('--update')
const ONLY = arg('only', '')
const PORT = Number(arg('port', '5191'))
const BASE = `http://localhost:${PORT}`
const OUT_DIR = arg('out', '')
const BASELINE = join(root, 'tests', 'visual', 'baseline')
const ACTUAL = join(root, 'tests', 'visual', '.out')

/**
 * Per-pixel colour distance pixelmatch tolerates (0..1; antialiased pixels are
 * ignored on top), and the share of pixels that may still differ: ~50 px at
 * 1220x820. Renders are deterministic, so this only absorbs rasteriser noise;
 * at 0.2% a renamed nav label (~500 px) slipped through.
 */
const PIXEL_THRESHOLD = 0.03
const MAX_DIFF_RATIO = 0.00005
const HEIGHT = 820
/** 2026-01-15 12:00 UTC: every "in 2 h", "today" and date stamp reads the same on every run. */
const FIXED_TIME = Date.UTC(2026, 0, 15, 12, 0, 0)

const WATCH = `
  await window.api.autoAdd({
    url: 'https://example.com/catalog/item/series', title: 'Frieren: Beyond Journey’s End',
    provider: 'yummyani', translatorId: 'a', translatorName: 'AniLibria', quality: '1080p',
    enabled: true, intervalMinutes: 360, nextCheckAt: Date.now() + 2 * 3600e3, failures: 0, seen: [],
    steps: [
      { id: 'd', kind: 'download', enabled: true },
      { id: 'n', kind: 'notify', enabled: true }
    ]
  });
`

/** A watch whose chain is only the download, so every other step is one "+" away. */
const WATCH_BARE = WATCH.replace(`,
      { id: 'n', kind: 'notify', enabled: true }`, '')

/** Types into an entry the way a person does, so React's onChange runs. */
const TYPE = `
  const __uvdType = (input, value) => {
    if (!input) throw new Error('no entry to type into');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
`

/**
 * The automation forms are panels of fields, not whole views, so they take a
 * subset of the passes: both themes at full width in English, plus the 720 px
 * Russian pass for the share forms, whose labels and readout run longest.
 */
const FORM_PASSES = (pass) => (pass.width === 1220 && pass.lang === 'en') || (pass.width === 720 && pass.lang === 'ru')
const WIDE_EN = (pass) => pass.width === 1220 && pass.lang === 'en'

/** Every view, plus the menu, dialog and toast states. */
const SCENES = [
  { name: 'home', setup: `await __uvdShot.view('home')` },
  {
    name: 'detected',
    setup: `await __uvdShot.view('home'); await __uvdShot.detect('https://www.youtube.com/watch?v=aqz-KE-bpKQ')`
  },
  // Plain text in the Download entry: the top results inline (5.4).
  { name: 'home-search', setup: `await __uvdShot.view('home'); await __uvdShot.detect('big buck bunny')` },
  { name: 'activity', setup: `__uvdShot.seedQueue(); await __uvdShot.view('downloads')` },
  {
    name: 'search',
    // Waits for the quality probes to settle, so no badge is caught mid-probe.
    setup: `await __uvdShot.view('search'); await __uvdShot.search('big buck bunny');
      for (let i = 0; i < 80 && /Quality…|Качество…/.test(document.querySelector('main')?.textContent ?? document.body.textContent); i++)
        await new Promise((r) => setTimeout(r, 100))`
  },
  { name: 'library', setup: `__uvdShot.seedQueue(); await __uvdShot.view('library'); await new Promise((r) => setTimeout(r, 300))` },
  { name: 'watching', setup: `${WATCH}; await __uvdShot.view('automation')` },
  { name: 'settings', setup: `await __uvdShot.view('settings')` },
  // A panel with a subpage, deep-linked (GNOME Network › Proxy).
  {
    name: 'settings-subpage',
    setup: `__uvdStore.getState().openSettings('network/proxy#address'); await new Promise((r) => setTimeout(r, 300))`
  },
  {
    name: 'menu',
    setup: `
      __uvdShot.seedQueue(); await __uvdShot.view('downloads');
      const trigger = document.querySelector('main [aria-haspopup="menu"]');
      if (!trigger) throw new Error('no row menu on screen');
      trigger.click();
      await new Promise((r) => setTimeout(r, 200));
      if (!document.querySelector('[role="menu"]')) throw new Error('menu did not open');
    `
  },
  {
    name: 'dialog',
    setup: `
      __uvdShot.seedQueue(); await __uvdShot.view('downloads');
      const go = document.querySelector('[data-uvd="cancel-download"]');
      if (!go) throw new Error('no cancel control on screen');
      go.click();
      await new Promise((r) => setTimeout(r, 200));
      if (!document.querySelector('[role="dialog"],[role="alertdialog"]')) throw new Error('dialog did not open');
    `
  },
  // First-run setup (6.3), its last step: notifications, style and accent.
  {
    name: 'setup',
    setup: `await __uvdShot.view('home'); __uvdStore.getState().setSetupOpen(true); await new Promise((r) => setTimeout(r, 150));
      document.querySelector('[data-uvd="setup-next"]').click(); await new Promise((r) => setTimeout(r, 100));
      document.querySelector('[data-uvd="setup-next"]').click(); await new Promise((r) => setTimeout(r, 200))`
  },
  // Settings › Watching › Network Shares › Add a Share, filled in: the host/share/folder readout under the path.
  {
    name: 'share-form',
    passes: FORM_PASSES,
    setup: `${TYPE}
      __uvdStore.getState().openSettings('watching/shares'); await new Promise((r) => setTimeout(r, 300));
      const add = document.querySelector('[data-uvd="share-add"]');
      if (!add) throw new Error('no add-share control on screen');
      add.click(); await new Promise((r) => setTimeout(r, 200));
      const fields = [...document.querySelectorAll('main input.field')];
      if (fields.length < 4) throw new Error('share form did not open');
      __uvdType(fields[0], '//nas.local/media/anime/Frieren');
      __uvdType(fields[1], 'denis');
      await new Promise((r) => setTimeout(r, 150));
      if (!document.querySelector('main dl')) throw new Error('no host/share/folder readout');`
  },
  // Settings › Watching › Telegram, as first met: nothing stored yet.
  {
    name: 'telegram-form',
    passes: WIDE_EN,
    setup: `__uvdStore.getState().openSettings('watching/telegram'); await new Promise((r) => setTimeout(r, 300));
      if (!document.querySelector('main input[type="password"]')) throw new Error('telegram form not on screen')`
  },
  // The step editor, from the chain's "+ Upload" on the Watching view: the share form inside a sheet.
  {
    name: 'step-upload',
    passes: FORM_PASSES,
    setup: `${WATCH_BARE}; await __uvdShot.view('automation');
      const go = document.querySelector('[data-uvd="step-add-upload"]');
      if (!go) throw new Error('no add-upload control on screen');
      go.click(); await new Promise((r) => setTimeout(r, 250));
      if (!document.querySelector('[role="dialog"]')) throw new Error('step editor did not open')`
  },
  // The same sheet from "+ Notify": the Telegram form inside it.
  {
    name: 'step-notify',
    passes: WIDE_EN,
    setup: `${WATCH_BARE}; await __uvdShot.view('automation');
      const go = document.querySelector('[data-uvd="step-add-notify"]');
      if (!go) throw new Error('no add-notify control on screen');
      go.click(); await new Promise((r) => setTimeout(r, 250));
      if (!document.querySelector('[role="dialog"]')) throw new Error('step editor did not open')`
  },
  {
    name: 'palette',
    setup: `await __uvdShot.view('home'); __uvdStore.getState().setPaletteOpen(true); await new Promise((r) => setTimeout(r, 200))`
  },
  {
    name: 'toast',
    setup: `
      await __uvdShot.view('home');
      __uvdToast('added to the queue', 'success', { label: 'View in Activity', run() {} });
      __uvdToast('Could not reach the server. Check the connection and try again.', 'error');
      await new Promise((r) => setTimeout(r, 200));
    `
  }
]

/** Both themes at both widths in English, both themes at 720 in Russian, and Russian at the 1000 px breakpoint. */
const PASSES = [
  { theme: 'night', width: 1220, lang: 'en' },
  { theme: 'day', width: 1220, lang: 'en' },
  { theme: 'night', width: 720, lang: 'en' },
  { theme: 'day', width: 720, lang: 'en' },
  { theme: 'night', width: 720, lang: 'ru' },
  { theme: 'day', width: 720, lang: 'ru' },
  // The sidebar's breakpoint (plan 4.2): the full sidebar's longest labels, in Russian.
  { theme: 'night', width: 1000, lang: 'ru' }
]

/** `--demo`: the set shown to the user at a checkpoint (en at 1220/1000/720 and ru at 720, both themes). */
const DEMO_PASSES = ['night', 'day'].flatMap((theme) => [
  { theme, width: 1220, lang: 'en' },
  { theme, width: 1000, lang: 'en' },
  { theme, width: 720, lang: 'en' },
  { theme, width: 720, lang: 'ru' }
])
const RUN_PASSES = process.argv.includes('--demo') ? DEMO_PASSES : PASSES

const STILL = `
  *, *::before, *::after {
    transition: none !important;
    animation: none !important;
    caret-color: transparent !important;
  }
`

function startPreview() {
  const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js')
  const child = spawn(
    process.execPath,
    [vite, '--config', 'vite.preview.config.ts', '--port', String(PORT), '--strictPort'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let log = ''
  child.stdout.on('data', (d) => (log += d))
  child.stderr.on('data', (d) => (log += d))
  return { child, log: () => log }
}

async function waitForServer(server) {
  const until = Date.now() + 30_000
  while (Date.now() < until) {
    try {
      const res = await fetch(BASE)
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    if (server.child.exitCode !== null) break
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`preview server did not start on ${BASE}\n${server.log()}`)
}

function fileName(scene, pass) {
  return `${scene.name}--${pass.theme}-${pass.width}-${pass.lang}.png`
}

async function shoot(browser, scene, pass) {
  const context = await browser.newContext({
    viewport: { width: pass.width, height: HEIGHT },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: pass.theme === 'day' ? 'light' : 'dark',
    locale: 'en-US',
    timezoneId: 'UTC'
  })
  const page = await context.newPage()
  try {
    await page.clock.setFixedTime(FIXED_TIME)
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${BASE}/?still`)
    await page.waitForFunction(() => window.__uvdStore?.getState().ready === true, null, { timeout: 30_000 })
    await page.addStyleTag({ content: STILL })
    await page.evaluate(DRIVER)
    await page.evaluate(
      ({ theme, lang }) => {
        document.documentElement.setAttribute('data-theme', theme)
        window.__uvdI18n.getState().setLanguage(lang)
      },
      { theme: pass.theme, lang: pass.lang }
    )
    const error = await page.evaluate(
      `(async () => { try { ${scene.setup}; return null } catch (e) { return String(e && e.message || e) } })()`
    )
    if (error) throw new Error(error)
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(150)
    if (errors.length) throw new Error(`page error: ${errors[0]}`)
    return await page.screenshot({ animations: 'disabled', caret: 'hide' })
  } finally {
    await context.close()
  }
}

function compare(actual, expected) {
  const a = PNG.sync.read(actual)
  const b = PNG.sync.read(expected)
  if (a.width !== b.width || a.height !== b.height) {
    return { ok: false, ratio: 1, reason: `size ${a.width}x${a.height} vs ${b.width}x${b.height}` }
  }
  const diff = new PNG({ width: a.width, height: a.height })
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: PIXEL_THRESHOLD })
  const ratio = n / (a.width * a.height)
  return { ok: ratio <= MAX_DIFF_RATIO, ratio, diff: PNG.sync.write(diff) }
}

async function main() {
  const scenes = SCENES.filter((s) => !ONLY || s.name.includes(ONLY))
  // A scene may name the passes it needs (`passes`); the rest take every one.
  const jobs = scenes.flatMap((scene) =>
    RUN_PASSES.filter((pass) => !scene.passes || scene.passes(pass)).map((pass) => ({ scene, pass }))
  )
  const target = OUT_DIR ? resolve(OUT_DIR) : UPDATE ? BASELINE : ACTUAL
  mkdirSync(target, { recursive: true })
  if (!UPDATE && !OUT_DIR) {
    rmSync(ACTUAL, { recursive: true, force: true })
    mkdirSync(ACTUAL, { recursive: true })
  }

  const server = startPreview()
  let browser
  let failed = 0
  try {
    await waitForServer(server)
    browser = await chromium.launch()
    // Warm the dev server once: its first transform of the app (and any dep
    // re-optimisation, which reloads the page) must not land inside a shot.
    await shoot(browser, SCENES[0], RUN_PASSES[0]).catch(() => undefined)
    const queue = [...jobs]
    const results = []
    const worker = async () => {
      while (queue.length) {
        const { scene, pass } = queue.shift()
        const name = fileName(scene, pass)
        try {
          // One retry: a cold module or a slow worker is not a visual change.
          const png = await shoot(browser, scene, pass).catch(() => shoot(browser, scene, pass))
          if (UPDATE || OUT_DIR) {
            writeFileSync(join(target, name), png)
            results.push(`  • ${name}`)
            continue
          }
          writeFileSync(join(ACTUAL, name), png)
          const base = join(BASELINE, name)
          if (!existsSync(base)) {
            failed++
            results.push(`  ✗ ${name}: no baseline (run npm run visual:update)`)
            continue
          }
          const res = compare(png, readFileSync(base))
          if (!res.ok) {
            failed++
            if (res.diff) writeFileSync(join(ACTUAL, name.replace('.png', '.diff.png')), res.diff)
            results.push(`  ✗ ${name}: ${res.reason ?? `${(res.ratio * 100).toFixed(2)}% of pixels differ`}`)
          }
        } catch (e) {
          failed++
          results.push(`  ✗ ${name}: ${e.message}`)
        }
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker))
    results.sort().forEach((r) => console.log(r))

    if (UPDATE && !ONLY) {
      // A scene that no longer exists should not keep a stale baseline.
      const wanted = new Set(jobs.map((j) => fileName(j.scene, j.pass)))
      for (const f of readdirSync(BASELINE)) if (!wanted.has(f)) rmSync(join(BASELINE, f))
    }
    if (UPDATE || OUT_DIR) console.log(`✓ wrote ${jobs.length - failed} screenshot(s) to ${target.replace(root, '.')}`)
    else if (failed) console.log(`✗ ${failed} of ${jobs.length} screenshot(s) differ; see tests/visual/.out`)
    else console.log(`✓ ${jobs.length} screenshot(s) match the baseline`)
  } finally {
    await browser?.close()
    server.child.kill()
  }
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
