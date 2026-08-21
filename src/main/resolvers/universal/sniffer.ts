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

  /*
    Walk shadow roots too.
    A growing number of players — anything built on a web component, which
    includes several of the big embeddable ones — keep their <video> inside a
    shadow tree, where document.querySelectorAll cannot see it. Those pages
    reported no media element at all and no source to fall back on.
  */
  const roots = [document];
  const seenRoots = new Set();
  const collect = (root) => {
    if (!root || seenRoots.has(root)) return [];
    seenRoots.add(root);
    let all = [];
    try { all = Array.from(root.querySelectorAll('*')); } catch (e) { return []; }
    for (const el of all) {
      if (el.shadowRoot) roots.push(el.shadowRoot);
    }
    return all;
  };

  const elements = [];
  for (let i = 0; i < roots.length && i < 40; i++) {
    elements.push(...collect(roots[i]));
  }

  const players = elements.filter((el) => el.tagName === 'VIDEO' || el.tagName === 'AUDIO');
  for (const v of players) {
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

  /*
    Sources parked on attributes.
    Lazy players keep the real URL in a data-* attribute until something asks
    them to start, and plenty never get that far inside a hidden window.
  */
  const DATA_ATTRS = ['data-src', 'data-video', 'data-video-src', 'data-file', 'data-hls',
    'data-mp4', 'data-url', 'data-stream', 'data-source'];
  for (const el of elements) {
    for (const name of DATA_ATTRS) {
      const value = el.getAttribute && el.getAttribute(name);
      if (value && /^(https?:|\/\/)/.test(value)) meta.srcs.push(value);
    }
  }

  const selectors = [
    '.vjs-big-play-button', '.jw-icon-display', '.plyr__control--overlaid',
    '.play-button', '.play-btn', '.player-play', '[data-testid="play-button"]',
    'button[aria-label*="lay"]', 'button[title*="lay"]', '[class*="playButton"]',
    '[class*="play-overlay"]', '[id*="play_button"]',
    // Shapes seen on players that the list above walked straight past.
    '.ytp-large-play-button', '.fp-play', '.mejs__overlay-button', '.vjs-poster',
    '[class*="PlayButton"]', '[aria-label*="Play"]', '[aria-label*="роизв"]',
    '[class*="start-button"]', '[class*="bigPlay"]', '[class*="video-overlay"]'
  ];
  let clicked = 0;
  for (const el of elements) {
    if (clicked >= 8) break;
    // Never click a link. A player overlay that happens to sit inside an anchor
    // would navigate the hidden window away from the page we came to watch.
    if (el.tagName === 'A' || (el.closest && el.closest('a[href]'))) continue;
    let match = false;
    for (const sel of selectors) {
      try { if (el.matches(sel)) { match = true; break } } catch (e) {}
    }
    if (!match) continue;
    try { el.click(); clicked++; } catch (e) {}
  }
  return meta;
})()`

/**
 * How long to keep listening after the first manifest turns up.
 *
 * Long enough for the player's follow-up requests (the master, then the variant
 * it chose) to arrive, short enough that it is not felt.
 */
const MANIFEST_GRACE_MS = 1200

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

  /*
    A manifest is as good as it gets — but not necessarily the *first* one.

    Players routinely fetch the master playlist and then immediately fetch the
    variant they picked for the current window size, and both are manifests. We
    used to stop on whichever arrived first, which on a fast connection was
    often the variant — so an unknown site quietly downloaded at 480p while a
    master listing 1080p had gone past a fraction of a second earlier.

    So the first manifest starts a short grace period instead of ending the
    wait. Ranking then does its job: `master.m3u8` and `playlist.m3u8` carry a
    bonus over a bare variant path.
  */
  let graceTimer: NodeJS.Timeout | null = null
  const detach = attachCapture(browsingSession(), (candidate) => {
    found.push(candidate)
    if (candidate.score >= 100 && !graceTimer) {
      graceTimer = setTimeout(() => resolveEarly?.(), MANIFEST_GRACE_MS)
    }
  })

  let win: BrowserWindow | null = null
  let meta: PageMeta = { srcs: [] }

  const cleanup = (): void => {
    detach()
    if (graceTimer) clearTimeout(graceTimer)
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
      // Same rule as above: a manifest is not a reason to stop *immediately*,
      // only a reason to stop soon. `deadline` already carries the grace timer.
      if (graceTimer) break
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

    /*
      Let the grace period finish before ranking.

      `deadline` is resolved by the grace timer, so racing it against a wait at
      least as long means we settle the moment the window closes — and never
      before it, which would have thrown away the very follow-up requests the
      grace period exists to collect.
    */
    await Promise.race([wait(graceTimer ? MANIFEST_GRACE_MS : 600), deadline])
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
