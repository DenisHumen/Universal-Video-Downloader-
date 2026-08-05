import type { UvdApi, AppInfo } from '../../../preload/index'
import type {
  AppSettings,
  DownloadItem,
  MediaInfo,
  SearchResult,
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

function fakeInfo(url: string): MediaInfo {
  return {
    id: 'mock',
    title: 'Big Buck Bunny — official 4K remaster',
    thumbnail: 'https://picsum.photos/seed/uvd/480/270',
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
      thumbnail: `https://picsum.photos/seed/uvd${i}/480/270`,
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
    thumbnail: 'https://picsum.photos/seed/anime/300/440',
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
      thumbnail: 'https://picsum.photos/seed/anime/300/440',
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
const ytdlpListeners = new Set<YtdlpListener>()
const updateListeners = new Set<UpdateListener>()

/** Preview-only: drive a state the mock bridge would otherwise never enter. */
declare global {
  interface Window {
    __uvdMock?: {
      ytdlp: (status: YtDlpStatus) => void
      update: (status: UpdateStatus) => void
    }
  }
}

export function installMockApi(): void {
  window.__uvdMock = {
    ytdlp: (status) => ytdlpListeners.forEach((cb) => cb(status)),
    update: (status) => updateListeners.forEach((cb) => cb(status))
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
    browserDownload: async () => null,
    browserRefreshState: async () => undefined,
    onBrowserState: () => () => undefined,
    onBrowserMedia: () => () => undefined,
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
    onDownloadUpdated: () => () => undefined,
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
