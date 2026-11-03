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
 * `--scale=2` renders at twice the pixel density (for video, where a shot gets
 * zoomed into), and `--out=<dir>` writes somewhere other than docs/screenshots.
 */
import { app, BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { DRIVER } from './shot-driver.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const BASE = arg('url', 'http://localhost:5174')
const THEME = arg('theme', 'night')
const outDir = resolve(root, arg('out', join('docs', 'screenshots')))
const SCALE = Number(arg('scale', '1')) || 1
// Must be set before the app is ready; the window keeps its CSS size either way.
if (SCALE !== 1) app.commandLine.appendSwitch('force-device-scale-factor', String(SCALE))
const WIDTH = 1280
const HEIGHT = 860

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * The shots, in the order the README tells the story: what you paste into,
 * what comes back, what the queue looks like while it works, then the screens
 * that answer "can it do X": search, watching a series, settings.
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
    name: 'watch',
    setup: `
      await window.api.autoAdd({
        url: 'https://example.com/catalog/item/series', title: 'Frieren: Beyond Journey’s End',
        provider: 'yummyani', translatorId: 'a', translatorName: 'AniLibria', quality: '1080p',
        enabled: true, intervalMinutes: 360, nextCheckAt: Date.now() + 2 * 3600e3, failures: 0, seen: [],
        steps: [
          { id: 'd', kind: 'download', enabled: true },
          { id: 'r', kind: 'rename', enabled: true, template: '{title} - S{season2}E{episode2}', replacements: [] },
          { id: 'u', kind: 'upload', enabled: true, targetId: 't', remotePath: '{title}', createDirs: true, deleteLocalAfter: true },
          { id: 'n', kind: 'notify', enabled: true }
        ]
      });
      await window.__uvdShot.view('automation');
    `
  },
  {
    name: 'settings',
    setup: `await window.__uvdShot.view('settings')`
  }
]

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
