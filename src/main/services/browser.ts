import { BrowserWindow, WebContentsView, ipcMain, nativeImage, shell } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { IPC } from '@shared/ipc'
import { UA } from '../resolvers/http'
import { attachCapture, BROWSING_PARTITION, browsingSession } from '../resolvers/universal/capture'
import { isPlausible, scoreUrl, type MediaCandidate } from '../resolvers/universal/candidates'
import { directUrlFor } from '../resolvers'
import { startDownload } from './downloader'
import { getSettings } from './settings'
import { mt } from './locale'
import type { BrowserMedia, BrowserState, DownloadItem } from '@shared/types'

/**
 * The built-in browser.
 *
 * When automatic detection finds nothing, the honest answer is "let me look at
 * the page myself". This opens a real Chromium view inside the app: the user
 * browses to the video and plays it, every media request is captured as it
 * happens, and anything found is one click from the queue. For pages where the
 * capture is ambiguous there's a pick mode — click the video on the page and
 * the app takes that element's source.
 *
 * It shares its session with the headless sniffer, so logins and consent
 * banners the user clears here also apply when a queued item is re-resolved.
 */

const MAX_MEDIA = 60

/**
 * Where to put the page before the renderer has measured anything.
 *
 * Only a first-paint guess. The window's chrome and its media panel are laid
 * out in the renderer, which reports the real rectangle over `browserSetBounds`
 * as soon as it mounts and on every resize after that — these numbers exist so
 * the page is roughly in place for the frame or two before that arrives.
 *
 * They were wrong for a while: 96px of chrome left over from a two-row toolbar
 * that the redesign replaced with a single 48px bar, and no allowance at all
 * for the panel, so the guess covered it. That was invisible at startup and
 * obvious on resize, where it used to be re-applied.
 */
const CHROME_HEIGHT = 48
const PANEL_WIDTH = 300

let win: BrowserWindow | null = null
let view: WebContentsView | null = null
let detach: (() => void) | null = null
let picking = false

const media = new Map<string, BrowserMedia>()

function shellPreload(): string {
  return join(__dirname, '../preload/index.js')
}

function sitePreload(): string {
  return join(__dirname, '../preload/site.js')
}

function icon(): Electron.NativeImage | undefined {
  if (process.platform === 'darwin') return undefined
  // `resources/` ships with the app; `build/` does not — see iconPath in index.ts.
  const path = join(__dirname, '../../resources/icons/app.png')
  const image = nativeImage.createFromPath(path)
  if (image.isEmpty()) console.error(`Browser window icon missing at ${path}`)
  return image
}

function labelFor(url: string): string {
  try {
    const parsed = new URL(url)
    const name = parsed.pathname.split('/').filter(Boolean).pop() || parsed.host
    return decodeURIComponent(name).slice(0, 64)
  } catch {
    return url.slice(0, 64)
  }
}

function sendState(): void {
  if (!win || win.isDestroyed() || !view) return
  const wc = view.webContents
  const state: BrowserState = {
    url: wc.getURL(),
    title: wc.getTitle(),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
    loading: wc.isLoading(),
    picking
  }
  win.webContents.send(IPC.evtBrowserState, state)
}

function sendMedia(): void {
  if (!win || win.isDestroyed()) return
  const list = [...media.values()].sort((a, b) => b.score - a.score || b.seenAt - a.seenAt)
  win.webContents.send(IPC.evtBrowserMedia, list)
}

function rememberCandidate(candidate: MediaCandidate): void {
  if (!isPlausible(candidate)) return
  if (media.has(candidate.url)) return
  if (media.size >= MAX_MEDIA) {
    // Drop the weakest entry so a long browsing session can't grow unbounded.
    const weakest = [...media.values()].sort((a, b) => a.score - b.score)[0]
    if (weakest) {
      media.delete(weakest.url)
      // The headers belong to that candidate; without this the map they live
      // in keeps growing past the cap that was supposed to bound it.
      candidateHeaders.delete(weakest.url)
    }
  }
  const wc = view?.webContents
  media.set(candidate.url, {
    id: randomUUID(),
    url: candidate.url,
    kind: candidate.kind,
    label: labelFor(candidate.url),
    score: candidate.score,
    pageUrl: wc?.getURL() ?? '',
    pageTitle: wc?.getTitle(),
    // What the server said it was sending. On a page offering three MP4s, the
    // size is the only thing in the panel that tells the film from the trailer.
    bytes: candidate.bytes,
    seenAt: Date.now()
  })
  sendMedia()
  candidateHeaders.set(candidate.url, candidate.headers ?? {})
}

/** Headers captured alongside each stream, needed to actually fetch it. */
const candidateHeaders = new Map<string, Record<string, string>>()

function setPicking(next: boolean): void {
  picking = next
  // The site view has no dictionary of its own; the wording travels with the mode.
  view?.webContents.send('browser-site:set-pick-mode', next, mt('pick.hint'))
  sendState()
}

type Bounds = { x: number; y: number; width: number; height: number }

/** The last rectangle the renderer measured — the authority once it exists. */
let reportedBounds: Bounds | null = null

function layoutView(bounds?: Bounds): void {
  if (bounds) reportedBounds = bounds
  if (!win || win.isDestroyed() || !view) return
  const content = win.getContentBounds()
  const rect = bounds ??
    reportedBounds ?? {
      x: 0,
      y: CHROME_HEIGHT,
      width: Math.max(0, content.width - PANEL_WIDTH),
      height: Math.max(0, content.height - CHROME_HEIGHT)
    }
  view.setBounds({
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height))
  })
}

function normalizeInput(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return 'about:blank'
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  // A bare domain is a URL; anything else is a search.
  if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(trimmed)) return `https://${trimmed}`
  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`
}

export function openBrowserWindow(initialUrl?: string): void {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.focus()
    if (initialUrl) void view?.webContents.loadURL(normalizeInput(initialUrl), { userAgent: UA })
    return
  }

  media.clear()
  candidateHeaders.clear()

  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#08080a',
    icon: icon(),
    webPreferences: {
      preload: shellPreload(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  view = new WebContentsView({
    webPreferences: {
      partition: BROWSING_PARTITION,
      preload: sitePreload(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // The user is driving; let them play things without fighting the policy.
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  win.contentView.addChildView(view)
  layoutView()

  detach = attachCapture(browsingSession(), rememberCandidate)

  const wc = view.webContents
  wc.setUserAgent(UA)
  wc.setWindowOpenHandler(({ url }) => {
    // Keep popups inside the browser rather than spawning stray windows.
    if (/^https?:\/\//i.test(url)) void wc.loadURL(url, { userAgent: UA })
    return { action: 'deny' }
  })
  wc.on('did-start-loading', () => sendState())
  wc.on('did-stop-loading', () => sendState())
  wc.on('did-navigate-in-page', () => sendState())
  wc.on('page-title-updated', () => sendState())
  wc.on('did-navigate', () => {
    // Media from the previous page is no longer downloadable context.
    media.clear()
    candidateHeaders.clear()
    sendMedia()
    if (picking) setPicking(false)
    sendState()
  })

  /*
    Only guess until the renderer has spoken. Its ResizeObserver watches the
    element the page actually sits in, so it re-reports on every window resize
    anyway — re-applying the guess here just moved the page to the wrong place
    for a frame before the correct bounds arrived.
  */
  win.on('resize', () => {
    if (!reportedBounds) layoutView()
  })
  win.on('ready-to-show', () => win?.show())
  win.on('closed', () => {
    detach?.()
    detach = null
    view = null
    win = null
    picking = false
    reportedBounds = null
    media.clear()
    candidateHeaders.clear()
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(`${devUrl}#/browser`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/browser' })
  }

  win.webContents.once('did-finish-load', () => {
    sendState()
    sendMedia()
  })

  void wc.loadURL(normalizeInput(initialUrl || 'https://duckduckgo.com'), { userAgent: UA })
}

/** Queue whatever the user picked in the browser. */
async function download(target: { mediaId?: string; url?: string }): Promise<DownloadItem | null> {
  const settings = getSettings()
  const mode = settings.defaultMode
  const quality = mode === 'audio' ? 'audio' : settings.defaultQuality

  if (target.url) {
    // A page link — let the normal detection pipeline handle it.
    return startDownload({ url: target.url, title: target.url, mode, quality })
  }

  const entry = [...media.values()].find((m) => m.id === target.mediaId)
  if (!entry) return null
  const headers = { ...(candidateHeaders.get(entry.url) ?? {}) }
  const referer = headers.Referer || entry.pageUrl
  delete headers.Referer

  return startDownload({
    url: directUrlFor({
      url: entry.url,
      headers: Object.keys(headers).length ? headers : undefined,
      referer,
      pageUrl: entry.pageUrl,
      title: entry.pageTitle || entry.label
    }),
    title: entry.pageTitle || entry.label,
    mode,
    quality
  })
}

export function registerBrowserIpc(): void {
  ipcMain.handle(IPC.browserOpen, (_e, url?: string) => openBrowserWindow(url))
  ipcMain.handle(IPC.browserNavigate, (_e, url: string) => {
    void view?.webContents.loadURL(normalizeInput(url), { userAgent: UA })
  })
  ipcMain.handle(IPC.browserBack, () => {
    if (view?.webContents.navigationHistory.canGoBack()) view.webContents.navigationHistory.goBack()
  })
  ipcMain.handle(IPC.browserForward, () => {
    if (view?.webContents.navigationHistory.canGoForward()) {
      view.webContents.navigationHistory.goForward()
    }
  })
  ipcMain.handle(IPC.browserReload, () => view?.webContents.reload())
  ipcMain.handle(IPC.browserStop, () => view?.webContents.stop())
  ipcMain.handle(IPC.browserSetBounds, (_e, bounds) => layoutView(bounds))
  ipcMain.handle(IPC.browserSetPick, (_e, enabled: boolean) => setPicking(Boolean(enabled)))
  ipcMain.handle(IPC.browserClearMedia, () => {
    media.clear()
    candidateHeaders.clear()
    sendMedia()
  })
  ipcMain.handle(IPC.browserDownload, (_e, target: { mediaId?: string; url?: string }) =>
    download(target)
  )
  ipcMain.handle(IPC.browserState, () => {
    sendState()
    sendMedia()
  })

  // ---- messages from the site preload ----
  ipcMain.on('browser-site:pick', (_e, result: { kind: string; src?: string; poster?: string }) => {
    picking = false
    sendState()
    if (!result || result.kind === 'none' || !result.src) return
    if (result.kind === 'link') {
      // The user pointed at a thumbnail — open that page and keep watching.
      void view?.webContents.loadURL(result.src, { userAgent: UA })
      return
    }
    if (result.kind === 'iframe') {
      void view?.webContents.loadURL(result.src, { userAgent: UA })
      return
    }
    rememberCandidate({
      url: result.src,
      kind: 'file',
      // A source the user pointed at directly outranks anything we guessed.
      score: 130,
      source: 'picked',
      headers: { Referer: view?.webContents.getURL() ?? '', 'User-Agent': UA }
    })
  })

  /*
    Sources the page exposes on its own <video> elements.

    Scored through the same ranking as everything else, with a bonus for having
    come from the DOM rather than the wire. A flat score bypassed every penalty
    in that table, so a pre-roll ad sitting in a <video> tag arrived rated as
    highly as the film — and the panel is sorted by score, which put the advert
    at the top of the list of things to download.
  */
  ipcMain.on(
    'browser-site:media',
    (_e, payload: { items: { src: string; poster?: string }[] }) => {
      for (const item of payload?.items ?? []) {
        const { kind, score } = scoreUrl(item.src, 8)
        if (!score) continue
        rememberCandidate({
          url: item.src,
          kind,
          score,
          source: 'dom',
          headers: { Referer: view?.webContents.getURL() ?? '', 'User-Agent': UA }
        })
      }
    }
  )
}

export function openExternalFromBrowser(url: string): void {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
}
