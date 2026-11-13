/**
 * The README's short video tour, recorded from the real renderer.
 *
 * Run with the browser preview already serving, and ffmpeg on the PATH:
 *
 *   npx vite --config vite.preview.config.ts --port 5174   # terminal 1
 *   npx electron scripts/record-tour.mjs                   # terminal 2
 *
 * Like capture-screenshots.mjs it drives the actual app against the mock
 * bridge, but with the animations left on, grabbing frames as it goes. The
 * frames become docs/assets/tour.webp (what the README shows) and
 * docs/assets/tour.mp4 (what it links to). Silent: there is nothing to hear.
 *
 * `--offscreen` renders without a window on screen and takes each frame as it is
 * painted, for a machine where grabbing a visible window fails (UnknownVizError).
 */
import { app, BrowserWindow } from 'electron'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { DRIVER } from './shot-driver.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:5174'
const OUT = join(root, 'docs', 'assets')
/** `--theme=day` records the day theme, into tour-day.mp4 and tour-day.webp (the website crossfades the two). */
const THEME = process.argv.find((a) => a.startsWith('--theme='))?.slice(8) ?? 'night'
const SUFFIX = THEME === 'night' ? '' : `-${THEME}`
const FPS = 15
const WIDTH = 1280
const HEIGHT = 800
const OFFSCREEN = process.argv.includes('--offscreen')

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** Each beat: what to do, then how long to hold on it. */
const BEATS = [
  {
    hold: 900,
    run: `await window.__uvdStore.getState().saveSettings({ theme: '${THEME}' }); await window.__uvdShot.view('home')`
  },
  {
    hold: 2600,
    run: `
      const input = document.getElementById('uvd-url')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      const url = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'
      input.focus()
      for (let i = 1; i <= url.length; i++) {
        setter.call(input, url.slice(0, i))
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise((r) => setTimeout(r, 28))
      }
      document.querySelector('[data-uvd="detect"]').click()
    `
  },
  { hold: 2600, run: `window.__uvdShot.seedQueue(); await window.__uvdShot.view('downloads')` },
  { hold: 2200, run: `await window.__uvdShot.view('library')` },
  { hold: 2600, run: `await window.__uvdShot.view('search'); await window.__uvdShot.search('big buck bunny')` },
  {
    hold: 2600,
    run: `
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
      })
      await window.__uvdShot.view('automation')
    `
  },
  { hold: 2200, run: `window.__uvdStore.getState().setPaletteOpen(true)` },
  {
    hold: 2600,
    run: `window.__uvdStore.getState().setPaletteOpen(false); window.__uvdStore.getState().openSettings('access')`
  }
]

app.whenReady().then(async () => {
  const frames = mkdtempSync(join(tmpdir(), 'uvd-tour-'))
  // Visible, and never throttled: a hidden window stops animating (see capture-screenshots.mjs).
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: !OFFSCREEN,
    backgroundColor: '#242424',
    webPreferences: { contextIsolation: true, sandbox: false, backgroundThrottling: false, offscreen: OFFSCREEN }
  })
  let painted = null
  if (OFFSCREEN) {
    win.webContents.setFrameRate(FPS)
    win.webContents.on('paint', (_event, _dirty, image) => {
      painted = image.toPNG()
    })
  }
  await win.loadURL(BASE)
  await wait(1500)
  await win.webContents.executeJavaScript(DRIVER, true)

  let n = 0
  let recording = true
  const started = Date.now()
  // Frames are taken on a clock, and a slow grab is made up by repeating it.
  const grab = async () => {
    while (recording) {
      const due = Math.floor(((Date.now() - started) / 1000) * FPS)
      const image = OFFSCREEN ? painted : (await win.webContents.capturePage()).toPNG()
      while (n <= due) writeFileSync(join(frames, `${String(n++).padStart(5, '0')}.png`), image)
      await wait(Math.max(0, started + (n * 1000) / FPS - Date.now()))
    }
  }
  const grabbing = grab()

  for (const beat of BEATS) {
    const error = await win.webContents.executeJavaScript(
      `(async () => { try { ${beat.run}; return null } catch (e) { return String(e && e.message || e) } })()`,
      true
    )
    if (error) {
      console.error('Beat failed:', error)
      app.exit(1)
    }
    await wait(beat.hold)
  }
  recording = false
  await grabbing

  mkdirSync(OUT, { recursive: true })
  const input = ['-y', '-framerate', String(FPS), '-i', join(frames, '%05d.png')]
  execFileSync('ffmpeg', [...input, '-vf', 'scale=1280:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', '-movflags', '+faststart', join(OUT, `tour${SUFFIX}.mp4`)], { stdio: 'ignore' })
  // The README's animated image is the night one; the day tour is only the website's video.
  if (!SUFFIX) execFileSync('ffmpeg', [...input, '-vf', 'fps=12,scale=960:-1:flags=lanczos', '-c:v', 'libwebp', '-loop', '0', '-quality', '62', '-compression_level', '6', join(OUT, `tour${SUFFIX}.webp`)], { stdio: 'ignore' })
  rmSync(frames, { recursive: true, force: true })
  for (const f of SUFFIX ? [`tour${SUFFIX}.mp4`] : ['tour.mp4', 'tour.webp']) {
    console.log(`  • docs/assets/${f} (${(statSync(join(OUT, f)).size / 1e6).toFixed(1)} MB, ${n} frames)`)
  }
  app.exit(0)
})
