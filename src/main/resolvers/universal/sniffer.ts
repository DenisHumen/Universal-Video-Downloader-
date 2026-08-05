import { BrowserWindow } from 'electron'
import { UA } from '../http'
import { rank, scoreUrl, type MediaCandidate } from './candidates'
import { attachCapture, BROWSING_PARTITION, browsingSession } from './capture'

/**
 * The universal fallback: open the page in a real (hidden) Chromium window,
 * let its player do whatever it does, and watch the network for media.
 *
 * This is how a link works on a site nobody has written a resolver for — the
 * player fetches its own manifest, we capture that request together with the
 * exact headers (Referer/Origin/Cookie) the CDN wants, and hand both to the
 * download engine.
 *
 * It shares a session with the built-in browser, so anything the user did
 * there — accepting a consent banner, logging in, passing an age gate — is
 * still in effect when we come back to re-resolve the stream later.
 */

export interface SniffResult {
  candidate: MediaCandidate
  title?: string
  thumbnail?: string
  duration?: number
  /** Every plausible stream we saw, best first — useful for diagnostics. */
  all: MediaCandidate[]
}

interface PageMeta {
  title?: string
  thumbnail?: string
  duration?: number
  srcs: string[]
}

/**
 * Runs inside the page: unmute + start every <video>, nudge the usual "big play
 * button" shapes, and report whatever the player already exposes.
 */
const PROBE_SCRIPT = `(() => {
  const meta = { title: document.title || undefined, thumbnail: undefined, duration: undefined, srcs: [] };
  const metaContent = (sel) => {
    const el = document.querySelector(sel);
    return el && el.getAttribute('content') ? el.getAttribute('content') : undefined;
  };
  meta.title = metaContent('meta[property="og:title"]') || meta.title;
  meta.thumbnail = metaContent('meta[property="og:image"]') || undefined;

  const videos = Array.from(document.querySelectorAll('video'));
  for (const v of videos) {
    try { v.muted = true; v.volume = 0; } catch (e) {}
    if (v.currentSrc) meta.srcs.push(v.currentSrc);
    if (v.getAttribute('src')) meta.srcs.push(v.getAttribute('src'));
    for (const s of v.querySelectorAll('source')) {
      if (s.getAttribute('src')) meta.srcs.push(s.getAttribute('src'));
    }
    if (!meta.thumbnail && v.getAttribute('poster')) meta.thumbnail = v.getAttribute('poster');
    if (!meta.duration && isFinite(v.duration) && v.duration > 0) meta.duration = v.duration;
    try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  }

  const selectors = [
    '.vjs-big-play-button', '.jw-icon-display', '.plyr__control--overlaid',
    '.play-button', '.play-btn', '.player-play', '[data-testid="play-button"]',
    'button[aria-label*="lay"]', 'button[title*="lay"]', '[class*="playButton"]',
    '[class*="play-overlay"]', '[id*="play_button"]'
  ];
  let clicked = 0;
  for (const sel of selectors) {
    if (clicked >= 5) break;
    for (const el of document.querySelectorAll(sel)) {
      if (clicked >= 5) break;
      try { el.click(); clicked++; } catch (e) {}
    }
  }
  return meta;
})()`

/** Sniffs are serialised: one hidden window at a time is plenty. */
let queue: Promise<unknown> = Promise.resolve()

export function sniffPage(
  url: string,
  timeoutMs = 28_000,
  signal?: AbortSignal
): Promise<SniffResult | null> {
  const run = (): Promise<SniffResult | null> => sniffOnce(url, timeoutMs, signal)
  const next = queue.then(run, run)
  queue = next.then(
    () => undefined,
    () => undefined
  )
  return next
}

async function sniffOnce(
  pageUrl: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<SniffResult | null> {
  if (signal?.aborted) return null
  const found: MediaCandidate[] = []
  let resolveEarly: (() => void) | null = null
  let deadlineTimer: NodeJS.Timeout | null = null
  let onAbort: (() => void) | null = null

  const detach = attachCapture(browsingSession(), (candidate) => {
    found.push(candidate)
    // A manifest is as good as it gets — stop waiting.
    if (candidate.score >= 100 && resolveEarly) resolveEarly()
  })

  let win: BrowserWindow | null = null
  let meta: PageMeta = { srcs: [] }

  const cleanup = (): void => {
    detach()
    if (deadlineTimer) clearTimeout(deadlineTimer)
    if (onAbort) signal?.removeEventListener('abort', onAbort)
    if (win && !win.isDestroyed()) win.destroy()
  }

  try {
    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        partition: BROWSING_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        // Autoplay needs a user gesture unless we say otherwise; the probe
        // script also mutes every element so nothing can make noise.
        autoplayPolicy: 'no-user-gesture-required'
      }
    })
    win.webContents.setAudioMuted(true)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    /*
      Three ways this ends: a manifest turns up, the clock runs out, or the user
      cancels. Cancellation used to have no path in here at all — the hidden
      window kept loading and playing for the full timeout after the UI had
      already said the detection was cancelled, and because sniffs are
      serialised the next one queued up behind it.
    */
    const deadline = new Promise<void>((resolve) => {
      resolveEarly = resolve
      deadlineTimer = setTimeout(resolve, timeoutMs)
      if (signal) {
        onAbort = (): void => resolve()
        signal.addEventListener('abort', onAbort, { once: true })
      }
    })

    // Navigation failures are fine — the player may still have fired requests.
    const navigation = win
      .loadURL(pageUrl, { userAgent: UA, httpReferrer: safeOrigin(pageUrl) })
      .catch(() => undefined)

    await Promise.race([navigation, deadline])
    if (signal?.aborted) return null

    // Give players a few nudges: some only attach after their own scripts run.
    for (let attempt = 0; attempt < 4; attempt++) {
      if (signal?.aborted) return null
      if (found.some((c) => c.score >= 100)) break
      const probed = await runProbe(win)
      if (probed) {
        meta = {
          title: meta.title || probed.title,
          thumbnail: meta.thumbnail || probed.thumbnail,
          duration: meta.duration || probed.duration,
          srcs: [...meta.srcs, ...probed.srcs]
        }
      }
      await Promise.race([wait(attempt === 0 ? 1500 : 3500), deadline])
    }

    await Promise.race([wait(600), deadline])
    if (signal?.aborted) return null

    for (const src of meta.srcs) {
      if (!/^https?:/i.test(src)) continue
      const { kind, score } = scoreUrl(src)
      if (score) {
        found.push({
          url: src,
          kind,
          score,
          headers: { Referer: pageUrl, 'User-Agent': UA },
          source: 'dom'
        })
      }
    }

    const all = rank(found)
    const candidate = all.find((c) => c.score >= 40)
    if (!candidate) return null
    return {
      candidate,
      title: meta.title,
      thumbnail: meta.thumbnail,
      duration: meta.duration,
      all
    }
  } finally {
    cleanup()
  }
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin + '/'
  } catch {
    return undefined
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Run the probe in the main frame and in every child frame (players nest). */
async function runProbe(win: BrowserWindow): Promise<PageMeta | null> {
  if (win.isDestroyed()) return null
  const merged: PageMeta = { srcs: [] }
  // framesInSubtree already includes the main frame.
  const targets = win.webContents.mainFrame?.framesInSubtree ?? []
  for (const frame of targets) {
    if (!frame) continue
    try {
      const result = (await frame.executeJavaScript(PROBE_SCRIPT, true)) as PageMeta | undefined
      if (!result) continue
      merged.title = merged.title || result.title
      merged.thumbnail = merged.thumbnail || result.thumbnail
      merged.duration = merged.duration || result.duration
      if (Array.isArray(result.srcs)) merged.srcs.push(...result.srcs)
    } catch {
      /* cross-origin frame or navigation in flight — skip it */
    }
  }
  return merged
}
