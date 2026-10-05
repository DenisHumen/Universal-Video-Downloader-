import { session, type Session, type OnBeforeSendHeadersListenerDetails } from 'electron'
import { UA } from '../http'
import { log } from '../../services/log'
import { scoreUrl, type MediaCandidate } from './candidates'
import { downloadVerdict, floodGuard } from './page-downloads'

/**
 * Network media capture for a session.
 *
 * Electron allows exactly one listener per `webRequest` event per session, so
 * the hidden sniffer and the visible built-in browser — which share a session
 * on purpose, to share cookies and logins — cannot each install their own.
 * This module owns the hooks and fans results out to every subscriber,
 * installing on the first attach and removing on the last detach.
 */

/**
 * The session used by both the hidden sniffer and the in-app browser.
 *
 * A session of its own, sharing nothing with the default one: whatever the app
 * sets on `session.defaultSession` - the proxy, most obviously - has to be set
 * here as well, or these windows quietly go without it. Not exported: windows
 * are built from `browsingSession()`, so there is one way in, and it is the one
 * that hardens the session first.
 */
const BROWSING_PARTITION = 'persist:uvd-browser'

let hardened = false

/** The hidden sniffer windows that exist right now, by webContents id. */
export const sniffers = new Set<number>()

/** A download the visible browser's page started, on its way to the queue. */
export interface QueuedPageDownload {
  url: string
  /** What the browser sent for that URL, cookies included: the CDN may want them. */
  headers: Record<string, string>
  /** The name the server suggested for the file. */
  filename: string
  pageUrl: string
  pageTitle: string
}

/** The built-in browser's page, the one place in this session a person is looking at. */
export interface BrowserPage {
  webContentsId: number
  onScreen: () => boolean
  queue: (download: QueuedPageDownload) => void
}

let browserPage: BrowserPage | null = null

/**
 * Let the built-in browser's page download. Returns the undo, for when its
 * window closes. Every other page in the session has its downloads cancelled.
 */
export function registerBrowserPage(page: BrowserPage): () => void {
  browserPage = page
  return () => {
    if (browserPage === page) browserPage = null
  }
}

/** Five in fifteen seconds is more than a person clicks; a page in a loop is not. */
const tooManyDownloads = floodGuard(5, 15_000)

function onWillDownload(
  ses: Session,
  event: Electron.Event,
  item: Electron.DownloadItem,
  wc: Electron.WebContents | undefined
): void {
  const id = wc?.id
  const sniffer = id !== undefined && sniffers.has(id)
  const page = !sniffer && id !== undefined && browserPage?.webContentsId === id ? browserPage : null
  const onScreen = Boolean(page?.onScreen())
  const url = item.getURL()
  const mimeType = item.getMimeType()
  const flooding = onScreen && tooManyDownloads(String(id))
  const verdict = downloadVerdict({ url, mimeType, onScreen, flooding })
  if (verdict === 'ask') return

  event.preventDefault()
  const type = mimeType || 'unknown'
  if (verdict === 'cancel' || !page || !wc) {
    log.info('browser', 'Cancelled a download a page started', {
      reason: sniffer ? 'detection window' : flooding ? 'too many at once' : 'page not on screen',
      type
    })
    return
  }
  page.queue({
    url,
    headers: installations.get(ses)?.recentHeaders.get(url) ?? {
      Referer: wc.getURL(),
      'User-Agent': UA
    },
    filename: item.getFilename(),
    pageUrl: wc.getURL(),
    pageTitle: wc.getTitle()
  })
  log.info('browser', 'Sent a download the page started to the queue', { type })
}

/**
 * The session both the visible browser and the hidden sniffer load pages into.
 *
 * Hardened on first use. Electron grants **every** permission a page asks for
 * when no handler is installed, and this session is where arbitrary,
 * unexamined websites run — including in a window the user cannot see, opened
 * automatically when a link needs the universal fallback, with autoplay policy
 * relaxed and a synthetic user gesture behind the probe script. A page loaded
 * that way could ask for the camera, the microphone or the location and simply
 * be given them.
 *
 * Nothing this app does needs any of them: it watches network requests and
 * reads the DOM. Fullscreen is the one thing a video player legitimately wants
 * in the visible browser, so that is the only one allowed through.
 */
export function browsingSession(): Session {
  const ses = session.fromPartition(BROWSING_PARTITION)
  if (!hardened) {
    hardened = true
    ses.setPermissionRequestHandler((_wc, permission, callback) =>
      callback(permission === 'fullscreen')
    )
    ses.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen')
    ses.setDevicePermissionHandler(() => false)
    /*
      Without this, a download any page in here started got Electron's default:
      a native Save dialog. The hidden sniffer clicks every play-button shape on
      pages nobody has looked at, so that dialog could appear from nowhere, as
      many times as the page liked. Only the browser's visible page may
      download now; see `downloadVerdict` for what happens to what it starts.
    */
    ses.on('will-download', (event, item, wc) => onWillDownload(ses, event, item, wc))
  }
  return ses
}

/** Requests that only add noise (and slow the page down). */
const BLOCKED =
  /(doubleclick|googlesyndication|google-analytics|googletagmanager|analytics\.|adservice|adsystem|scorecardresearch|popads|propellerads|exoclick|juicyads|trafficjunky|hotjar|mc\.yandex|facebook\.net|connect\.facebook)/i

const MEDIA_EXT = /\.(m3u8|mpd|mp4|m4v|webm|mov|flv|mp3|m4a|flac|aac|ogg|oga|opus|wav)(\?|#|$)/i
const MEDIA_TYPE =
  /(application\/(x-mpegurl|vnd\.apple\.mpegurl|dash\+xml)|video\/(mp4|webm|x-flv|quicktime|mp2t)|audio\/(mpeg|mp4|aac|ogg|opus|flac|wav|x-m4a))/i

const INTERESTING_HEADERS = ['Referer', 'Origin', 'Cookie', 'User-Agent', 'Authorization']

/**
 * A sink is told which webContents made the request.
 *
 * The hooks are installed on the session, and the hidden sniffer window and the
 * visible in-app browser share one — deliberately, so a login made in the
 * browser is available to the sniffer. But every candidate was fanned out to
 * every subscriber with nothing saying whose request it was, so a video playing
 * in the browser window fed straight into a sniff of an unrelated page. An HLS
 * manifest scores 112, which is enough to end that sniff early and win the
 * ranking, so the app would download the video the user happened to be watching
 * instead of the one it was asked for.
 *
 * Undefined for requests that belong to no webContents at all.
 */
export type CaptureSink = (candidate: MediaCandidate, webContentsId?: number) => void

interface Installation {
  sinks: Set<CaptureSink>
  recentHeaders: Map<string, Record<string, string>>
}

const installations = new Map<Session, Installation>()

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

function install(ses: Session): Installation {
  const state: Installation = { sinks: new Set(), recentHeaders: new Map() }

  const emit = (
    url: string,
    headers: Record<string, string>,
    meta: { contentType?: string; bytes?: number; webContentsId?: number } = {}
  ): void => {
    const { kind, score } = scoreUrl(url, 12, meta.contentType)
    if (!score) return
    const candidate: MediaCandidate = {
      url,
      kind,
      score,
      headers,
      source: 'network',
      bytes: meta.bytes
    }
    for (const sink of state.sinks) {
      try {
        sink(candidate, meta.webContentsId)
      } catch {
        /* a broken subscriber must not stop the others */
      }
    }
  }

  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: BLOCKED.test(details.url) })
  })

  ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    const headers = pickHeaders(details.requestHeaders)
    if (state.recentHeaders.size > 400) state.recentHeaders.clear()
    state.recentHeaders.set(details.url, headers)
    if (MEDIA_EXT.test(details.url)) {
      emit(details.url, headers, { webContentsId: details.webContentsId })
    }
    callback({ requestHeaders: details.requestHeaders })
  })

  /*
    What the server says it sent, for the URLs whose path gives nothing away.

    Plenty of CDNs serve manifests from extensionless paths, and this hook has
    always watched for them — but it handed the URL to a scorer that only ever
    read the file extension, so every one of those responses scored zero and was
    dropped on the next line. Passing the content type through is what makes
    this branch do the job it was written for.

    Content-Length comes along too: it is the tie-break between a real video and
    a decoy of the same kind, and nothing had ever filled it in.
  */
  ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
    const contentType = headerValue(details.responseHeaders, 'content-type')
    if (MEDIA_TYPE.test(contentType)) {
      const length = Number(headerValue(details.responseHeaders, 'content-length'))
      emit(details.url, state.recentHeaders.get(details.url) ?? { 'User-Agent': UA }, {
        contentType,
        bytes: Number.isFinite(length) && length > 0 ? length : undefined,
        webContentsId: details.webContentsId
      })
    }
    callback({ responseHeaders: details.responseHeaders })
  })

  installations.set(ses, state)
  return state
}

function uninstall(ses: Session): void {
  ses.webRequest.onBeforeRequest(null)
  ses.webRequest.onBeforeSendHeaders(null)
  ses.webRequest.onHeadersReceived(null)
  installations.delete(ses)
}

/** Subscribe to media seen on `ses`. Returns an unsubscribe function. */
export function attachCapture(ses: Session, sink: CaptureSink): () => void {
  const state = installations.get(ses) ?? install(ses)
  state.sinks.add(sink)
  let detached = false
  return () => {
    if (detached) return
    detached = true
    state.sinks.delete(sink)
    if (state.sinks.size === 0) uninstall(ses)
  }
}
