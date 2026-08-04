import { BrowserWindow, session, type OnBeforeSendHeadersListenerDetails } from 'electron'
import { UA } from '../http'
import { rank, scoreUrl, type MediaCandidate } from './candidates'

/**
 * The universal fallback: open the page in a real (hidden) Chromium window,
 * let its player do whatever it does, and watch the network for media.
 *
 * This is how a link works on a site nobody has written a resolver for — the
 * player fetches its own manifest, we capture that request together with the
 * exact headers (Referer/Origin/Cookie) the CDN wants, and hand both to the
 * download engine.
 */

export interface SniffResult {
  candidate: MediaCandidate
  title?: string
  thumbnail?: string
  duration?: number
  /** Every plausible stream we saw, best first — useful for diagnostics. */
  all: MediaCandidate[]
}

const PARTITION = 'persist:uvd-sniffer'

/** Requests that only add noise (and slow the page down). */
const BLOCKED =
  /(doubleclick|googlesyndication|google-analytics|googletagmanager|analytics\.|adservice|adsystem|scorecardresearch|popads|propellerads|exoclick|juicyads|trafficjunky|hotjar|mc\.yandex|facebook\.net|connect\.facebook)/i

const MEDIA_EXT = /\.(m3u8|mpd|mp4|m4v|webm|mov|flv)(\?|#|$)/i
const MEDIA_TYPE =
  /(application\/(x-mpegurl|vnd\.apple\.mpegurl|dash\+xml)|video\/(mp4|webm|x-flv|quicktime|mp2t))/i

const INTERESTING_HEADERS = ['Referer', 'Origin', 'Cookie', 'User-Agent', 'Authorization']

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

/** Sniffs are serialised: the webRequest hooks are per-session, not per-window. */
let queue: Promise<unknown> = Promise.resolve()

export function sniffPage(url: string, timeoutMs = 28_000): Promise<SniffResult | null> {
  const run = (): Promise<SniffResult | null> => sniffOnce(url, timeoutMs)
  const next = queue.then(run, run)
  queue = next.then(
    () => undefined,
    () => undefined
  )
  return next
}

function headerValue(headers: Record<string, string | string[]> | undefined, name: string): string {
  if (!headers) return ''
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) return Array.isArray(v) ? v.join('; ') : String(v)
  }
  return ''
}

function pickHeaders(raw: OnBeforeSendHeadersListenerDetails['requestHeaders']): Record<string, string> {
  const out: Record<string, string> = {}
  for (const wanted of INTERESTING_HEADERS) {
    const value = headerValue(raw, wanted.toLowerCase())
    if (value) out[wanted] = value
  }
  if (!out['User-Agent']) out['User-Agent'] = UA
  return out
}

async function sniffOnce(pageUrl: string, timeoutMs: number): Promise<SniffResult | null> {
  const ses = session.fromPartition(PARTITION)
  const found: MediaCandidate[] = []
  const requestHeaders = new Map<string, Record<string, string>>()
  let resolveEarly: (() => void) | null = null

  const remember = (url: string, headers: Record<string, string>, source: string): void => {
    const { kind, score } = scoreUrl(url, source === 'network' ? 12 : 0)
    if (!score) return
    found.push({ url, kind, score, headers, source })
    // A manifest is as good as it gets — stop waiting.
    if (score >= 100 && resolveEarly) resolveEarly()
  }

  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: BLOCKED.test(details.url) })
  })

  ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    const headers = pickHeaders(details.requestHeaders)
    if (requestHeaders.size < 400) requestHeaders.set(details.url, headers)
    if (MEDIA_EXT.test(details.url)) remember(details.url, headers, 'network')
    callback({ requestHeaders: details.requestHeaders })
  })

  ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
    const type = headerValue(details.responseHeaders, 'content-type')
    if (MEDIA_TYPE.test(type)) {
      remember(details.url, requestHeaders.get(details.url) ?? { Referer: pageUrl, 'User-Agent': UA }, 'network')
    }
    callback({ responseHeaders: details.responseHeaders })
  })

  let win: BrowserWindow | null = null
  let meta: PageMeta = { srcs: [] }

  // The webRequest hooks above are attached to a *persistent* session — leaving
  // them behind would block requests and misattribute headers for every later
  // sniff, so this must run even if the window fails to open at all.
  const cleanup = (): void => {
    ses.webRequest.onBeforeRequest(null)
    ses.webRequest.onBeforeSendHeaders(null)
    ses.webRequest.onHeadersReceived(null)
    if (win && !win.isDestroyed()) win.destroy()
  }

  try {
    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        partition: PARTITION,
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

    const deadline = new Promise<void>((resolve) => {
      resolveEarly = resolve
      setTimeout(resolve, timeoutMs)
    })

    // Navigation failures are fine — the player may still have fired requests.
    const navigation = win
      .loadURL(pageUrl, { userAgent: UA, httpReferrer: safeOrigin(pageUrl) })
      .catch(() => undefined)

    await Promise.race([navigation, deadline])

    // Give players a few nudges: some only attach after their own scripts run.
    for (let attempt = 0; attempt < 4; attempt++) {
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

    for (const src of meta.srcs) {
      if (!/^https?:/i.test(src)) continue
      remember(src, { Referer: pageUrl, 'User-Agent': UA }, 'dom')
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
