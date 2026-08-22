import type { UvdApi, AppInfo } from '../../../preload/index'
import type {
  AppSettings,
  DownloadItem,
  MediaInfo,
  SearchResult,
  BrowserMedia,
  BrowserState,
  UpdateStatus,
  YtDlpStatus
} from '@shared/types'

/**
 * Browser-only stand-in for the preload bridge so the renderer can be opened
 * (and visually tested) at the vite dev URL without Electron. Never active in
 * the real app — the preload script defines window.api before we run.
 */

const settings: AppSettings = {
  downloadDir: 'C:\\Users\\demo\\Downloads',
  concurrentDownloads: 3,
  defaultMode: 'video',
  defaultQuality: 'best',
  audioFormat: 'mp3',
  embedThumbnail: true,
  embedSubtitles: false,
  embedMetadata: true,
  embedChapters: true,
  writeSubtitles: false,
  subtitleLanguages: 'en,ru',
  sponsorBlock: false,
  restrictFilenames: false,
  filenameTemplate: '%(title)s [%(id)s].%(ext)s',
  createSubfolders: false,
  speedLimit: '',
  playlistLimit: 500,
  autoUpdate: true,
  resumeOnLaunch: true,
  theme: 'night',
  language: 'auto',
  notifications: true,
  clipboardWatch: false,
  trayEnabled: false,
  universalFallback: true,
  preferCompatible: true,
  proxy: '',
  cookiesFromBrowser: '',
  cookiesFile: ''
}

const appInfo: AppInfo = {
  version: 'dev',
  name: 'universal-video-downloader',
  platform: 'win32' as NodeJS.Platform,
  arch: 'x64',
  locale: 'en-US',
  manualUpdates: false,
  ytdlp: { state: 'ready', version: 'mock' },
  update: { state: 'idle' }
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Poster art that always renders.
 *
 * These used to point at picsum.photos, which meant every tile in the preview
 * was a grey rectangle the moment the machine was offline — and the thumbnail
 * is half of what a card, a queue row and a search tile are made of, so the
 * layout could not honestly be judged without it. An inline SVG needs no
 * network and no CSP exception.
 */
function poster(seed: number, label: string): string {
  const hue = (seed * 47) % 360
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270">
    <defs><linearGradient id="g" x1="0" y1="0" x2="480" y2="270" gradientUnits="userSpaceOnUse">
      <stop stop-color="hsl(${hue} 42% 30%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 38% 14%)"/>
    </linearGradient></defs>
    <rect width="480" height="270" fill="url(#g)"/>
    <circle cx="240" cy="135" r="42" fill="rgba(255,255,255,0.14)"/>
    <path d="M228 113 L268 135 L228 157 Z" fill="rgba(255,255,255,0.72)"/>
    <text x="24" y="246" fill="rgba(255,255,255,0.55)" font-family="monospace" font-size="16">${label}</text>
  </svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}


function fakeInfo(url: string): MediaInfo {
  return {
    id: 'mock',
    title: 'Big Buck Bunny — official 4K remaster',
    thumbnail: poster(3, '4K · 09:56'),
    duration: 596,
    uploader: 'Blender Foundation',
    webpageUrl: url,
    originalUrl: url,
    extractor: 'youtube',
    isLive: false,
    viewCount: 1234567,
    subtitleLanguages: ['en', 'ru', 'de'],
    formats: [
      { id: '137', ext: 'mp4', kind: 'video', resolution: '1080p', height: 1080, vcodec: 'avc1' },
      {
        id: '22',
        ext: 'mp4',
        kind: 'video+audio',
        resolution: '720p',
        height: 720,
        vcodec: 'avc1',
        acodec: 'mp4a'
      },
      {
        id: '18',
        ext: 'mp4',
        kind: 'video+audio',
        resolution: '360p',
        height: 360,
        vcodec: 'avc1',
        acodec: 'mp4a'
      },
      { id: '140', ext: 'm4a', kind: 'audio', resolution: 'audio', acodec: 'mp4a' }
    ]
  }
}

function fakeResults(query: string, scope: string): SearchResult[] {
  const services =
    scope === 'all'
      ? (['youtube', 'soundcloud', 'dailymotion', 'yummyani', 'pornhub'] as const)
      : ([scope] as unknown as readonly SearchResult['service'][])
  return Array.from({ length: scope === 'all' ? 12 : 9 }, (_, i) => {
    const service = services[i % services.length]
    const isAnime = service === 'yummyani'
    return {
      id: `mock-${i}`,
      title: `${query} — result ${i + 1}: an adequately long ${isAnime ? 'anime' : 'video'} title to test clamping`,
      url: `https://example.com/watch?v=mock-${i}`,
      pickerUrl: isAnime ? `uvd-yummy-item://${100 + i}` : undefined,
      thumbnail: poster(i + 1, service),
      duration: isAnime ? undefined : 63 + i * 137,
      uploader: isAnime ? '2021' : ['Blender Foundation', 'NASA', 'Kurzgesagt'][i % 3],
      viewCount: 1000 * (i + 1) ** 3,
      service
    }
  })
}

function fakeAnimeInfo(url: string): MediaInfo {
  return {
    id: 'anime-mock',
    title: 'Mock Anime — Season 1',
    thumbnail: poster(7, 'anime'),
    webpageUrl: url,
    originalUrl: url,
    extractor: 'YummyAnime',
    isLive: false,
    formats: [],
    streaming: {
      provider: 'yummyani',
      host: 'old.yummyani.me',
      id: 'anime-mock',
      title: 'Mock Anime',
      thumbnail: poster(7, 'anime'),
      isSeries: true,
      translators: [
        { id: 'dub-a', name: 'AniLibria' },
        { id: 'dub-b', name: 'AniDUB' }
      ],
      defaultTranslator: 'dub-a',
      seasons: [{ season: 1, episodes: [1, 2, 3, 4, 5, 6, 7, 8] }],
      episodesByTranslator: {
        'dub-a': [{ season: 1, episodes: [1, 2, 3, 4, 5, 6, 7, 8] }],
        'dub-b': [{ season: 1, episodes: [1, 2, 3, 4, 5] }]
      },
      qualities: ['360p', '480p', '720p']
    }
  }
}

let itemSeq = 0
const items: DownloadItem[] = []

type YtdlpListener = (status: YtDlpStatus) => void
type UpdateListener = (status: UpdateStatus) => void
type BrowserStateListener = (state: BrowserState) => void
type BrowserMediaListener = (media: BrowserMedia[]) => void
const ytdlpListeners = new Set<YtdlpListener>()
const updateListeners = new Set<UpdateListener>()
const browserStateListeners = new Set<BrowserStateListener>()
const browserMediaListeners = new Set<BrowserMediaListener>()
type UpdatedListener = (item: DownloadItem) => void
const updatedListeners = new Set<UpdatedListener>()

/** Preview-only: drive a state the mock bridge would otherwise never enter. */
declare global {
  interface Window {
    __uvdMock?: {
      ytdlp: (status: YtDlpStatus) => void
      update: (status: UpdateStatus) => void
      browserState: (state: Partial<BrowserState>) => void
      browserMedia: (media: BrowserMedia[]) => void
      /** Put a queue row into any state — including ones only the engine reaches. */
      queue: (patch: Partial<DownloadItem>) => DownloadItem
    }
  }
}

export function installMockApi(): void {
  const browserState: BrowserState = {
    url: '',
    title: '',
    canGoBack: false,
    canGoForward: false,
    loading: false,
    picking: false
  }
  window.__uvdMock = {
    ytdlp: (status) => ytdlpListeners.forEach((cb) => cb(status)),
    update: (status) => updateListeners.forEach((cb) => cb(status)),
    browserState: (patch) => {
      Object.assign(browserState, patch)
      browserStateListeners.forEach((cb) => cb({ ...browserState }))
    },
    browserMedia: (list) => browserMediaListeners.forEach((cb) => cb(list)),
    queue: (patch) => {
      const item: DownloadItem = {
        id: `mock-row-${++itemSeq}`,
        kind: 'download',
        url: 'https://example.com/watch?v=preview',
        title: 'Preview item',
        state: 'downloading',
        percent: 0,
        outputDir: 'C:/Downloads',
        mode: 'video',
        createdAt: Date.now(),
        ...patch
      }
      const at = items.findIndex((i) => i.id === item.id)
      if (at >= 0) items[at] = item
      else items.unshift(item)
      updatedListeners.forEach((cb) => cb({ ...item }))
      return item
    }
  }
  const api: UvdApi = {
    detect: async (url) => {
      await delay(700)
      if (url.startsWith('uvd-yummy-item://')) return { ok: true, info: fakeAnimeInfo(url) }
      return { ok: true, info: fakeInfo(url) }
    },
    cancelDetect: async () => undefined,
    searchVideos: async (query, scope) => {
      await delay(800)
      return { ok: true, results: fakeResults(query, scope) }
    },
    openSearchWindow: async (query) => {
      window.location.hash = `/search?q=${encodeURIComponent(query)}`
      window.location.reload()
    },
    onSearchQuery: () => () => undefined,
    startDownload: async (req) => {
      await delay(200)
      const item: DownloadItem = {
        id: `mock-item-${++itemSeq}`,
        url: req.url,
        sourceUrl: req.url,
        title: req.title || req.url,
        thumbnail: req.thumbnail,
        mode: req.mode,
        quality: req.quality,
        state: 'queued',
        percent: 0,
        outputDir: settings.downloadDir,
        createdAt: Date.now()
      }
      items.unshift(item)
      return item
    },
    pauseDownload: async () => undefined,
    resumeDownload: async () => undefined,
    cancelDownload: async () => undefined,
    retryDownload: async () => undefined,
    removeDownload: async () => undefined,
    clearFinished: async () => undefined,
    listDownloads: async () => items,
    startMediaJob: async (req) => {
      const item: DownloadItem = {
        id: `mock-job-${++itemSeq}`,
        kind: req.kind,
        url: req.sourcePath,
        sourcePath: req.sourcePath,
        title: req.title,
        thumbnail: req.thumbnail,
        mode: req.target?.mode ?? 'video',
        state: 'queued',
        percent: 0,
        outputDir: settings.downloadDir,
        createdAt: Date.now()
      }
      items.unshift(item)
      return item
    },
    probeMedia: async () => ({ duration: 596, hasVideo: true, hasAudio: true }),
    fetchThumbnail: async () => null,
    openBrowser: async () => undefined,
    browserNavigate: async () => undefined,
    browserBack: async () => undefined,
    browserForward: async () => undefined,
    browserReload: async () => undefined,
    browserStop: async () => undefined,
    browserSetBounds: async () => undefined,
    browserSetPick: async () => undefined,
    browserClearMedia: async () => undefined,
    /* Returning null meant the browser panel's queued markers could never be
       reached in the preview — and those markers are what the navigation reset
       is about. */
    browserDownload: async (target) => {
      const item: DownloadItem = {
        id: `mock-browser-${++itemSeq}`,
        url: target.url ?? target.mediaId ?? 'https://site.test/stream.m3u8',
        sourceUrl: target.url,
        title: 'Captured stream',
        mode: 'video',
        state: 'queued',
        percent: 0,
        outputDir: settings.downloadDir,
        createdAt: Date.now()
      }
      items.unshift(item)
      return item
    },
    browserRefreshState: async () => undefined,
    onBrowserState: (cb) => {
      browserStateListeners.add(cb)
      return () => browserStateListeners.delete(cb)
    },
    onBrowserMedia: (cb) => {
      browserMediaListeners.add(cb)
      return () => browserMediaListeners.delete(cb)
    },
    pauseAll: async () => undefined,
    resumeAll: async () => undefined,
    retryFailed: async () => undefined,
    prioritizeDownload: async () => undefined,
    getSettings: async () => ({ ...settings }),
    /**
     * Returns a *copy*, exactly as the real bridge does.
     *
     * This used to hand back the same object it had just mutated. The store
     * assigns the result straight into state, so zustand compared the old and
     * new references, found them identical and skipped the re-render — which
     * made every control in Settings look broken in the preview while working
     * fine in the app. The real `setSettings` builds a fresh object and sends
     * it over IPC (structured clone), so it can never have this problem; the
     * stand-in has to behave the same way or it lies about the UI.
     */
    setSettings: async (partial) => {
      Object.assign(settings, partial)
      return { ...settings }
    },
    resetSettings: async () => ({ ...settings }),
    chooseDirectory: async () => null,
    chooseCookiesFile: async () => null,
    openPath: async () => '',
    showInFolder: async () => undefined,
    openExternal: async (url) => {
      window.open(url, '_blank')
    },
    readClipboard: async () => '',
    ensureYtdlp: async () => appInfo.ytdlp,
    updateYtdlp: async () => 'mock',
    checkForUpdates: async () => appInfo.update,
    downloadUpdate: async () => undefined,
    installUpdate: async () => undefined,
    openReleasesPage: async () => undefined,
    getAppInfo: async () => appInfo,
    minimizeWindow: async () => undefined,
    maximizeWindow: async () => false,
    closeWindow: async () => undefined,
    isWindowMaximized: async () => false,
    onDownloadProgress: () => () => undefined,
    onDownloadUpdated: (cb) => {
      updatedListeners.add(cb)
      return () => updatedListeners.delete(cb)
    },
    /*
     * These two used to drop the callback on the floor, which meant the states
     * they drive — the first-run engine download, the update banner — could
     * never be seen in the browser preview at all. The stand-in keeps them and
     * exposes a way to fire one, so the states are reachable while working on
     * them. Real events come over IPC; nothing here exists in the packaged app.
     */
    onYtdlpStatus: (cb) => {
      ytdlpListeners.add(cb)
      return () => ytdlpListeners.delete(cb)
    },
    onUpdateStatus: (cb) => {
      updateListeners.add(cb)
      return () => updateListeners.delete(cb)
    },
    onDetectStatus: () => () => undefined,
    onClipboardLink: () => () => undefined,
    onNavigate: () => () => undefined
  }
  window.api = api
}
