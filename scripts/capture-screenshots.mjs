/**
 * Screenshots for the README, taken from the real renderer.
 *
 * Run with the browser preview already serving:
 *
 *   npx vite --config vite.preview.config.ts     # terminal 1
 *   npx electron scripts/capture-screenshots.mjs # terminal 2
 *
 * It loads the actual React app — the same bundle the packaged product runs —
 * against the mock bridge in `src/renderer/src/lib/mockApi.ts`, so the pictures
 * are of the interface rather than of a mock-up of it. Nothing here is part of
 * the app; it exists so the README can show what the thing looks like without
 * anyone hand-cropping a window at 3am and forgetting to redo it next release.
 *
 * Pass `--url` to point at a different server, and `--theme night|day|both`.
 */
import { app, BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const outDir = join(root, 'docs', 'screenshots')

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const BASE = arg('url', 'http://localhost:5174')
const THEME = arg('theme', 'night')
const WIDTH = 1280
const HEIGHT = 860

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * The shots, in the order the README tells the story: what you paste into,
 * what comes back, what the queue looks like while it works, and the two
 * screens that answer "can it do X".
 */
const SHOTS = [
  {
    name: 'home',
    setup: `await window.__uvdShot.view('home')`
  },
  {
    name: 'detected',
    setup: `
      await window.__uvdShot.view('home');
      await window.__uvdShot.detect('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
    `
  },
  {
    name: 'queue',
    setup: `
      window.__uvdShot.seedQueue();
      await window.__uvdShot.view('downloads');
    `
  },
  {
    name: 'search',
    setup: `
      await window.__uvdShot.view('search');
      await window.__uvdShot.search('big buck bunny');
    `
  },
  {
    name: 'settings',
    setup: `await window.__uvdShot.view('settings')`
  }
]

/**
 * Injected into the page: a thin driver over the store and the mock bridge.
 *
 * Clicking through the UI with synthetic events is possible and fragile — a
 * renamed button silently produces a screenshot of the wrong screen. Driving
 * the store directly fails loudly instead.
 */
const DRIVER = `
window.__uvdShotPoster = (seed, label) => {
  const hue = (seed * 47) % 360
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="480" y2="270" gradientUnits="userSpaceOnUse">' +
    '<stop stop-color="hsl(' + hue + ' 42% 30%)"/><stop offset="1" stop-color="hsl(' + ((hue + 40) % 360) + ' 38% 14%)"/>' +
    '</linearGradient></defs><rect width="480" height="270" fill="url(#g)"/>' +
    '<circle cx="240" cy="135" r="42" fill="rgba(255,255,255,0.14)"/>' +
    '<path d="M228 113 L268 135 L228 157 Z" fill="rgba(255,255,255,0.72)"/>' +
    '<text x="24" y="246" fill="rgba(255,255,255,0.55)" font-family="monospace" font-size="16">' + label + '</text></svg>'
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}

window.__uvdShot = {
  async view(id) {
    const store = window.__uvdStore
    if (!store) throw new Error('store not exposed')
    store.getState().setView(id)
    // React renders on the next tick; the callers below reach straight into
    // the DOM of the view they just asked for.
    await new Promise((r) => setTimeout(r, 250))
  },
  async detect(url) {
    const input = document.getElementById('uvd-url')
    if (!input) throw new Error('no url field on screen')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, url)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const go = document.querySelector('[data-uvd="detect"]')
    if (!go) throw new Error('no detect button on screen')
    go.click()
    await new Promise((r) => setTimeout(r, 1600))
  },
  async search(query) {
    const input = document.getElementById('uvd-search')
    if (!input) throw new Error('no search field on screen')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, query)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const go = document.querySelector('[data-uvd="search"]')
    if (!go) throw new Error('no search button on screen')
    go.click()
    await new Promise((r) => setTimeout(r, 1800))
  },
  seedQueue() {
    const q = window.__uvdMock.queue
    q({
      id: 'shot-1',
      title: 'Big Buck Bunny — official 4K remaster',
      thumbnail: window.__uvdShotPoster(1, '4K'),
      state: 'downloading',
      percent: 62,
      targetHeight: 2160,
      speed: 8_400_000,
      eta: 94,
      downloadedBytes: 560_000_000,
      totalBytes: 900_000_000,
      phase: 'download'
    })
    q({
      id: 'shot-2',
      title: 'Sintel (2010) — 1080p',
      thumbnail: window.__uvdShotPoster(2, '1080p'),
      state: 'processing',
      percent: 93,
      targetHeight: 1080,
      phase: 'postprocess',
      postprocess: 'merge',
      indeterminate: true
    })
    q({
      id: 'shot-3',
      title: 'Tears of Steel — trailer (clip)',
      thumbnail: window.__uvdShotPoster(3, 'clip'),
      kind: 'trim',
      jobLabel: '00:01:12 → 00:02:40',
      state: 'queued',
      percent: 0
    })
    q({
      id: 'shot-4',
      title: 'Elephants Dream — 720p',
      thumbnail: window.__uvdShotPoster(4, '720p'),
      state: 'completed',
      percent: 100,
      targetHeight: 720,
      totalBytes: 240_000_000,
      filepath: 'C:\\\\Users\\\\demo\\\\Downloads\\\\Elephants Dream [ed].mp4'
    })
    q({
      id: 'shot-5',
      title: 'members-only-stream',
      state: 'error',
      percent: 0,
      errorCode: 'signIn',
      cookieHint: true
    })
  }
}
true
`

let failures = 0

async function shoot(win, theme) {
  for (const shot of SHOTS) {
    await win.webContents.executeJavaScript(
      `document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)}); true`
    )
    /*
      A setup that throws must fail loudly and move on. Letting the rejection
      escape left the whole run hanging with no output at all — the worst
      possible outcome for a script whose entire job is to notice that a screen
      no longer looks the way it should.
    */
    const error = await win.webContents.executeJavaScript(
      `(async () => { try { ${shot.setup}; return null } catch (e) { return String(e && e.message || e) } })()`,
      true
    )
    if (error) {
      failures++
      console.error(`  ! ${shot.name} (${theme}): ${error}`)
      continue
    }
    // Let the entry animation settle; the system runs on 240ms transitions.
    await wait(700)
    const image = await win.webContents.capturePage()
    const suffix = theme === 'night' ? '' : `-${theme}`
    const file = join(outDir, `${shot.name}${suffix}.png`)
    writeFileSync(file, image.toPNG())
    console.log(`  • ${file.replace(root, '.')}`)
  }
}

app.whenReady().then(async () => {
  mkdirSync(outDir, { recursive: true })
  /*
    A *visible* window, and no background throttling.

    Chromium stops servicing requestAnimationFrame in a window nobody can see,
    and Framer Motion's entry animations start every element at opacity 0 — so
    a hidden window produced perfectly composed screenshots of a blank page.
    The same throttling is why the app's own view switching deliberately avoids
    depending on exit animations.
  */
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: true,
    backgroundColor: '#09090b',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })

  process.on('unhandledRejection', (err) => {
    console.error('Capture failed:', err)
    app.exit(1)
  })

  await win.loadURL(BASE)
  // The mock bridge and the store both need a mounted app behind them.
  await wait(1500)
  await win.webContents.executeJavaScript(DRIVER, true)

  console.log(`Capturing from ${BASE}…`)
  for (const theme of THEME === 'both' ? ['night', 'day'] : [THEME]) {
    await shoot(win, theme)
  }
  console.log(failures ? `Done, with ${failures} failed shot(s).` : 'Done.')
  app.exit(failures ? 1 : 0)
})
