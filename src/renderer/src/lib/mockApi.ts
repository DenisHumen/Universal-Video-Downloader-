import {
  EMPTY_LIBRARY,
  entryFromItem,
  keptLinkOf,
  listLibrary,
  rekeyEntry,
  removeEntry,
  upsertEntry,
  type LibraryEntry,
  type LibraryFile
} from '@shared/library'
import { normalizeUrl } from '@shared/urls'
import type { ButtonLayout } from '@shared/desktop'
import type { UvdApi, AppInfo } from '../../../preload/index'
import type {
  AppSettings,
  CliStatus,
  DownloadItem,
  DownloadsChanged,
  MediaInfo,
  SearchResult,
  BrowserMedia,
  BrowserState,
  UpdateStatus,
  YtDlpStatus
} from '@shared/types'
import { allowedSearchServices, SEARCH_ALL_SERVICES } from '@shared/types'

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
  playlistNumbering: true,
  playlistFolder: true,
  autoUpdate: true,
  resumeOnLaunch: true,
  keepFinished: 0,
  theme: 'night',
  accent: 'orange',
  language: 'auto',
  notifications: true,
  clipboardWatch: false,
  autoDownload: false,
  autoDownloadOff: [],
  trayEnabled: false,
  universalFallback: true,
  showAdultServices: false,
  preferCompatible: true,
  automationEnabled: false,
  autostart: false,
  smbTargets: [],
  telegramChatId: '',
  logVerbose: false,
  proxy: '',
  cookiesFromBrowser: '',
  browserStaySignedIn: true,
  browserSavePasswords: true,
  cookiesFile: '',
  errorReports: 'ask',
  // The preview and tests start past the first-run setup; ?firstRun=1 shows it.
  setupDone: !/[?&]firstRun=1/.test(typeof location === 'undefined' ? '' : location.search)
}

const appInfo: AppInfo = {
  version: 'dev',
  name: 'universal-video-downloader',
  // The preview (and the visual harness) render as the user's desktop: Ubuntu GNOME.
  platform: 'linux' as NodeJS.Platform,
  systemAccent: 'e95420',
  buttonLayout: { start: [], end: ['minimize', 'maximize', 'close'] } as ButtonLayout,
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


/** A link with "mock-dubbed" in it has its sound in several languages. */
const DUBBED: MediaInfo['formats'] = [
  { id: '140-en', ext: 'm4a', kind: 'audio', resolution: 'audio', language: 'en', languagePreference: 10000 },
  { id: '140-de', ext: 'm4a', kind: 'audio', resolution: 'audio', language: 'de', languagePreference: -1 },
  { id: '140-es', ext: 'm4a', kind: 'audio', resolution: 'audio', language: 'es-419', languagePreference: -1 }
]

function fakeInfo(url: string): MediaInfo {
  const info = fakeVideo(url)
  return /mock-dubbed/.test(url) ? { ...info, formats: [...info.formats, ...DUBBED] } : info
}

function fakeVideo(url: string): MediaInfo {
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
    autoCaptionLanguages: ['en-orig', 'en', 'ru', 'fr', 'ja', 'es-419'],
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

/** A link with "mock-channel" in it: a channel longer than the listing depth, for "Load More". */
function fakeChannel(url: string, depth: number): MediaInfo {
  const count = Math.min(depth, 730)
  return {
    id: 'mock-channel',
    title: 'A very long channel',
    webpageUrl: url,
    originalUrl: url,
    extractor: 'YoutubeTab',
    isLive: false,
    formats: [],
    isPlaylist: true,
    playlistCount: count,
    entries: Array.from({ length: count }, (_, i) => ({
      url: `https://example.com/watch?v=c${i}`,
      title: `Episode ${i + 1} of the channel`,
      extractor: 'Youtube'
    })),
    ...(count >= depth ? { listingCut: depth } : {})
  }
}

function fakeResults(query: string, scope: string, limit: number): SearchResult[] {
  // The same choice main makes, so the preview never shows what the setting hides.
  const services =
    scope === 'all'
      ? allowedSearchServices(SEARCH_ALL_SERVICES, settings.showAdultServices)
      : ([scope] as unknown as readonly SearchResult['service'][])
  // `limit` is per service when everything is searched, as it is in main.
  return Array.from({ length: scope === 'all' ? limit * services.length : limit }, (_, i) => {
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
let mockLibrary: LibraryFile = EMPTY_LIBRARY
const libraryListeners = new Set<() => void>()
const mockRemoved = new Set<string>()
/** Files the preview pretends are gone from disk: `__uvdMock.missing(['/v/old.mp4'])`. */
let mockMissing = new Set<string>()
let mockLocateFinds: 'found' | 'noMatch' = 'found'
let mockMovedFrom = ''
const isMockLost = (e: LibraryEntry): boolean => !e.remotePath && mockMissing.has(e.filepath)
function syncMockLibrary(): void {
  for (const item of items) {
    const entry = entryFromItem(item)
    if (entry && !mockRemoved.has(entry.id)) mockLibrary = upsertEntry(mockLibrary, entry)
  }
}

const sentLinkListeners = new Set<(url: string) => void>()

type YtdlpListener = (status: YtDlpStatus) => void
type UpdateListener = (status: UpdateStatus) => void
type BrowserStateListener = (state: BrowserState) => void
type BrowserMediaListener = (media: BrowserMedia[]) => void
const ytdlpListeners = new Set<YtdlpListener>()
const updateListeners = new Set<UpdateListener>()
const browserStateListeners = new Set<BrowserStateListener>()
const browserMediaListeners = new Set<BrowserMediaListener>()
type ChangedListener = (change: DownloadsChanged) => void
const changedListeners = new Set<ChangedListener>()
type MaximizedListener = (maximized: boolean) => void
const maximizedListeners = new Set<MaximizedListener>()
let maximized = false
const setMaximized = (next: boolean): void => {
  maximized = next
  maximizedListeners.forEach((cb) => cb(next))
}

/*
  The terminal command as a Mac that has not linked it yet sees it. The
  preview says it is Windows, where the row is hidden, and a hidden row cannot
  be looked at; `__uvdMock.cli({ method: 'script', onPath: false })` and the
  like reach the others.
*/
const cliState: CliStatus = { method: 'link', installed: false, path: '/usr/local/bin/uvd' }

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
      /** Maximise or restore the window the way Win+Up or Snap would, without the button. */
      maximize: (next: boolean) => void
      /** A link arriving from outside, as a `uvd://` link would bring it. */
      sendLink: (url: string) => void
      /** The terminal command's state, read when Settings next opens. */
      cli: (patch: Partial<CliStatus>) => void
      /** Which library files are gone from disk. */
      missing: (paths: string[]) => void
      /** What the next "Locate…" in a folder comes back with. */
      locate: (finds: 'found' | 'noMatch') => void
    }
  }
}

import {
  duplicateAfterEdit,
  exactDuplicate,
  inheritedSeen,
  settleRunError,
  type EpisodeRef,
  type Watch
} from '@shared/automation'
import { backupFileName, buildBackup, planImport } from '@shared/backup'

const mockWatches: Watch[] = []

const mockEpisodes = (n: number): EpisodeRef[] =>
  Array.from({ length: n }, (_, i) => ({ season: 1, episode: i + 1 }))

/** The folders on the preview's one share, keyed by their share-relative path. */
const mockShareTree: Record<string, string[]> = {
  '': ['video', 'music', 'Backups'],
  video: ['series', 'films'],
  'video/series': ['Severance', 'The Bear'],
  'video/films': [],
  music: [],
  Backups: []
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
    maximize: setMaximized,
    sendLink: (url) => sentLinkListeners.forEach((cb) => cb(url)),
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
      changedListeners.forEach((cb) => cb({ updated: [{ ...item }], removed: [] }))
      return item
    },
    cli: (patch) => {
      Object.assign(cliState, patch)
    },
    missing: (paths) => {
      mockMissing = new Set(paths)
      libraryListeners.forEach((cb) => cb())
    },
    locate: (finds) => {
      mockLocateFinds = finds
    }
  }
  const api: UvdApi = {
    detect: async (url, _requestId, options) => {
      await delay(700)
      if (/mock-channel/.test(url)) {
        return { ok: true, info: fakeChannel(url, options?.playlistEnd ?? settings.playlistLimit) }
      }
      if (url.startsWith('uvd-yummy-item://')) return { ok: true, info: fakeAnimeInfo(url) }
      // A link with "mock-premiere" in it has not started yet.
      if (/mock-premiere/.test(url)) {
        return { ok: false, error: 'Premieres in 3 days', errorCode: 'upcoming' }
      }
      // A link with "unsupported" in it fails the way an unknown site does, report offer and all.
      if (/unsupported/i.test(url)) {
        return { ok: false, error: `Unsupported URL: ${url}`, reportId: 'mock-detect' }
      }
      // A link with "mock-limited" in it comes the way YouTube answers with no runtime to solve its check.
      if (/mock-limited/.test(url)) return { ok: true, info: { ...fakeInfo(url), qualityLimit: 'noRuntime' } }
      return { ok: true, info: fakeInfo(url) }
    },
    cancelDetect: async () => undefined,
    searchVideos: async (query, scope, limit = 12) => {
      await delay(800)
      return { ok: true, results: fakeResults(query, scope, limit) }
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
        playlist: req.playlist,
        uploader: req.uploader,
        series: req.series,
        subtitles: req.subtitles,
        audioLanguage: req.audioLanguage,
        waitForVideo: req.waitForVideo,
        state: req.waitForVideo ? 'waiting' : 'queued',
        percent: 0,
        outputDir: req.outputDir || settings.downloadDir,
        createdAt: Date.now()
      }
      items.unshift(item)
      return item
    },
    pauseDownload: async () => undefined,
    stopLiveRecording: async () => undefined,
    downloadLog: async (id) => items.find((item) => item.id === id)?.log ?? '',
    shareSend: async (request) => ({ status: 'sent', remotePath: `shared/${request.folder}/file.mp4` }),
    onShareSendProgress: () => () => undefined,
    resumeDownload: async () => undefined,
    cancelDownload: async () => undefined,
    retryDownload: async () => undefined,
    removeDownload: async (id) => {
      const at = items.findIndex((i) => i.id === id)
      if (at >= 0) items.splice(at, 1)
      changedListeners.forEach((cb) => cb({ updated: [], removed: [id] }))
    },
    clearFinished: async () => undefined,
    clearFailed: async () => undefined,
    listDownloads: async () => items,
    startMediaJob: async (req) => {
      const item: DownloadItem = {
        id: `mock-job-${++itemSeq}`,
        kind: req.kind,
        url: req.sourcePath,
        sourcePath: req.sourcePath,
        originUrl: req.originUrl,
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
    // The preview has no page that could start a download of its own.
    onBrowserQueued: () => () => undefined,
    onBrowserLoginOffer: () => () => undefined,
    browserLoginAnswer: async () => undefined,
    browserLogins: async () => [{ origin: 'https://example.com', usernames: ['denis'] }],
    browserForgetLogins: async () => true,
    browserSignOut: async () => undefined,
    browserImportSignIns: async () => ({ ok: true as const, sites: 12 }),
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
    /*
      The preview has no file dialog. Export says it wrote what is in memory;
      import merges a made-up backup through the same rules main uses - from a
      machine whose download folder is not here, behind a proxy that signs in -
      so the result it reports and the series and share it adds can be looked
      at without a real file.
    */
    exportBackup: async () => ({
      ok: true,
      path: `C:\\Users\\demo\\Documents\\${backupFileName(new Date())}`,
      watches: mockWatches.length,
      targets: settings.smbTargets.length
    }),
    importBackup: async () => {
      await delay(300)
      const sample = buildBackup({
        settings: {
          ...settings,
          theme: 'day',
          downloadDir: 'D:\\Old PC\\Videos',
          proxy: 'http://demo@192.168.1.10:3128',
          smbTargets: [
            {
              id: 'mock-nas',
              name: 'nas',
              host: '192.168.1.10',
              share: 'shared',
              path: 'video/series',
              domain: '',
              username: 'demo'
            }
          ],
          telegramChatId: '100000000'
        },
        watches: [
          {
            id: 'mock-imported',
            url: 'https://example.com/series/imported',
            title: 'An imported series',
            provider: 'yummyani',
            translatorId: 'a',
            translatorName: 'A dub',
            quality: '720p',
            enabled: true,
            intervalMinutes: 360,
            nextCheckAt: 0,
            failures: 0,
            seen: mockEpisodes(4),
            steps: [{ id: 'd', kind: 'download', enabled: true }],
            createdAt: Date.now()
          }
        ],
        app: appInfo.version,
        now: new Date()
      })
      const plan = planImport(
        { backup: sample, invalid: 0 },
        { settings, watches: mockWatches },
        { now: Date.now(), newId: () => crypto.randomUUID(), exists: (path) => !path.startsWith('D:') }
      )
      Object.assign(settings, plan.settings)
      mockWatches.push(...plan.watches)
      return { ok: true, counts: plan.counts, settings: { ...settings } }
    },
    chooseDirectory: async () => null,
    chooseCookiesFile: async () => null,
    openPath: async () => '',
    showInFolder: async () => true,
    openExternal: async (url) => {
      window.open(url, '_blank')
    },
    readClipboard: async () => '',
    ensureYtdlp: async () => appInfo.ytdlp,
    updateYtdlp: async () => ({ ok: true, version: 'mock' }),
    checkForUpdates: async () => appInfo.update,
    downloadUpdate: async () => undefined,
    installUpdate: async () => undefined,
    openReleasesPage: async () => undefined,
    cliStatus: async () => ({ ...cliState }),
    // A pause for the password prompt the real one shows on a Mac.
    cliInstall: async () => {
      await delay(900)
      Object.assign(cliState, { installed: true, occupied: false })
      return { ok: true, status: { ...cliState } }
    },
    getAppInfo: async () => appInfo,
    minimizeWindow: async () => undefined,
    maximizeWindow: async () => {
      setMaximized(!maximized)
      return maximized
    },
    closeWindow: async () => undefined,
    isWindowMaximized: async () => maximized,
    onMaximizedChange: (cb) => {
      maximizedListeners.add(cb)
      return () => maximizedListeners.delete(cb)
    },
    onDownloadProgress: () => () => undefined,
    onDownloadsChanged: (cb) => {
      changedListeners.add(cb)
      return () => changedListeners.delete(cb)
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
    // No network in the preview build; a YouTube link still gets its poster from the id.
    onDetectPreview: () => () => undefined,
    onClipboardLink: () => () => undefined,
    onSentLink: (cb) => {
      sentLinkListeners.add(cb)
      return () => sentLinkListeners.delete(cb)
    },
    onAutoDownload: () => () => undefined,
    onPasteLink: () => () => undefined,
    takePending: async () => ({}),
    /*
      A sample report, so the prompt's preview and every state after "send" can
      be looked at in the browser. Nothing here touches the network: a real
      send exists only in main. A report id with "fail-send" in it fails —
      `__uvdMock.queue({ state: 'error', reportId: 'fail-send' })` — which is
      the only way to see the mail-app and copy fallbacks without a real one.
    */
    reportPreview: async () => ({
      subject: '[UVD dev] unsupported site: example.com',
      text: [
        'Universal Video Downloader error report',
        '',
        'what failed: detection',
        'site: example.com',
        'link: https://example.com/unsupported',
        'error code: unclassified',
        'message: Unsupported URL: https://example.com/watch',
        'detection: built-in resolver: none · universal detection: page scan → hidden browser, found nothing',
        'settings: cookies off · proxy off · custom filename template off',
        'app: dev',
        'system: win32 x64 10.0.26200',
        '',
        'engine output:',
        'ERROR: Unsupported URL: https://example.com/watch'
      ].join('\n')
    }),
    reportSend: async (id) => {
      await delay(900)
      return /fail-send/.test(id) ? { ok: false, reason: 'rejected' } : { ok: true }
    },
    /*
      A link with "upcoming" in it is a title that is not out yet, so the
      waiting state can be looked at without waiting for a real one.
    */
    autoDescribe: async (url: string) =>
      /upcoming/i.test(url)
        ? {
            url,
            title: 'A film that is not out yet',
            thumbnail: undefined,
            provider: 'yummyani',
            defaultTranslator: '',
            qualities: ['360p', '480p', '720p'],
            translators: [],
            upcoming: { releaseAt: Date.now() + 35 * 86_400_000 }
          }
        : {
            url,
            title: 'A series',
            thumbnail: undefined,
            provider: 'yummyani',
            defaultTranslator: 'a',
            qualities: ['360p', '480p', '720p'],
            // The second dub is long enough to show that a back catalogue arrives in batches.
            translators: [
              { id: 'a', name: 'A dub', episodes: 8, list: mockEpisodes(8) },
              { id: 'b', name: 'A long dub', episodes: 30, list: mockEpisodes(30) }
            ]
          },
    // Kept in memory, so the watch screen can be seen with something on it.
    autoList: async () => [...mockWatches],
    autoRuns: async () => [],
    // The same duplicate rules main applies.
    autoAdd: async (w) => {
      const existing = exactDuplicate(mockWatches, w)
      if (existing) return { ...existing, existing: true as const }
      const created = {
        ...w,
        seen: inheritedSeen(mockWatches, w),
        id: crypto.randomUUID(),
        createdAt: Date.now()
      }
      mockWatches.push(created)
      return created
    },
    autoUpdate: async (id, changes) => {
      const i = mockWatches.findIndex((x) => x.id === id)
      if (duplicateAfterEdit(mockWatches, id, changes)) return mockWatches[i]
      // The same rule main applies, so dismissing or pausing behaves here as it does there.
      if (i >= 0) mockWatches[i] = { ...mockWatches[i], ...settleRunError(changes) }
      return mockWatches[i]
    },
    autoRemove: async (id) => {
      const i = mockWatches.findIndex((x) => x.id === id)
      if (i >= 0) mockWatches.splice(i, 1)
    },
    // The commonest answer, or the waiting one for a title that is not out.
    autoCheckNow: async (id) => {
      const w = mockWatches.find((x) => x.id === id)
      return w?.pending
        ? { notOut: true, releaseAt: w.releaseAt }
        : { fresh: 0, queued: 0, paused: !w?.enabled }
    },
    autoRetryRun: async () => ({ started: true }),
    autoTestSmb: async () => 'Connected.',
    autoChooseShareFolder: async () => ({
      location: { host: '192.168.1.10', share: 'shared', folder: 'video/series', username: 'denis' }
    }),
    // A small share to walk around in the preview: folders by their '/'-joined path.
    autoListShareFolders: async (_target, _password, folder) => {
      const key = folder.split(/[\\/]+/).filter(Boolean).join('/')
      return [...(mockShareTree[key] ?? [])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    },
    autoCreateShareFolder: async (_target, _password, parent, name) => {
      const key = parent.split(/[\\/]+/).filter(Boolean).join('/')
      const clean = name.trim()
      const here = (mockShareTree[key] ??= [])
      if (here.some((n) => n.toLowerCase() === clean.toLowerCase())) {
        throw new Error('A file with that name already exists on the share.')
      }
      here.push(clean)
      const path = key ? `${key}/${clean}` : clean
      mockShareTree[path] = []
      return path
    },
    autoTestTelegram: async () => 'Connected.',
    autoSetSecret: async () => true,
    autoSecretState: async () => ({ telegram: false, smb: {}, proxy: false, persists: true }),
    getLogPath: async () => 'C:/mock/uvd.log',
    onAutomationChanged: () => () => undefined,
    onNavigate: () => () => undefined,
    onFocusRow: () => () => undefined,
    onNativeTheme: () => () => undefined,
    // The Library, as main builds it: every completed row with a file, kept apart from the queue.
    listLibrary: async (q) => {
      syncMockLibrary()
      return listLibrary(mockLibrary, q)
    },
    libraryMissing: async (paths) => paths.filter((p) => mockMissing.has(p)),
    libraryLookup: async (links) => {
      syncMockLibrary()
      return links.flatMap((link) => {
        const held = mockLibrary.entries.filter((e) => keptLinkOf(e) === normalizeUrl(link))
        const here = held.find((e) => !mockMissing.has(e.filepath))
        const entry = here ?? held.find((e) => e.remotePath)
        return entry ? [{ link, entry, onDisk: Boolean(here) }] : []
      })
    },
    libraryCountMissing: async () => mockLibrary.entries.filter(isMockLost).length,
    forgetMissingEntries: async () => {
      const lost = mockLibrary.entries.filter(isMockLost)
      for (const e of lost) {
        mockRemoved.add(e.id)
        mockLibrary = removeEntry(mockLibrary, e.id)
      }
      libraryListeners.forEach((cb) => cb())
      return lost.length
    },
    // The dialog's part is pretended: `__uvdMock.locate('noMatch')` makes the folder come up empty.
    locateLibraryEntry: async (id, how) => {
      const entry = mockLibrary.entries.find((e) => e.id === id)
      if (!entry) return { status: 'failed' }
      const name = entry.filepath.split(/[\\/]/).pop() ?? ''
      if (how === 'folder' && mockLocateFinds === 'noMatch') return { status: 'noMatch', name }
      const path = `/found/${name}`
      const folder = (p: string): string => p.slice(0, p.search(/[\\/][^\\/]*$/))
      mockMovedFrom = folder(entry.filepath)
      mockMissing.delete(entry.filepath)
      mockLibrary = rekeyEntry(mockLibrary, id, path)
      // Its queue row must not put the old path back on the next read.
      mockRemoved.add(id)
      libraryListeners.forEach((cb) => cb())
      const also = mockLibrary.entries.filter((e) => isMockLost(e) && folder(e.filepath) === mockMovedFrom).length
      return { status: 'found', path, also }
    },
    locateRestOfFolder: async () => {
      const folder = (p: string): string => p.slice(0, p.search(/[\\/][^\\/]*$/))
      const rest = mockLibrary.entries.filter((e) => isMockLost(e) && folder(e.filepath) === mockMovedFrom)
      for (const e of rest) {
        mockMissing.delete(e.filepath)
        mockLibrary = rekeyEntry(mockLibrary, e.id, `/found/${e.filepath.split(/[\\/]/).pop()}`)
        mockRemoved.add(e.id)
      }
      libraryListeners.forEach((cb) => cb())
      return rest.length
    },
    trashLibraryEntry: async (id) => {
      mockRemoved.add(id)
      mockLibrary = removeEntry(mockLibrary, id)
      libraryListeners.forEach((cb) => cb())
      return true
    },
    trashLibraryFile: async (filepath) => {
      syncMockLibrary()
      const entry = mockLibrary.entries.find((e) => e.filepath === filepath)
      if (!entry) return 'noEntry'
      mockRemoved.add(entry.id)
      mockLibrary = removeEntry(mockLibrary, entry.id)
      libraryListeners.forEach((cb) => cb())
      return 'trashed'
    },
    forgetLibraryEntry: async (id) => {
      mockRemoved.add(id)
      mockLibrary = removeEntry(mockLibrary, id)
      libraryListeners.forEach((cb) => cb())
    },
    onLibraryChanged: (cb) => {
      libraryListeners.add(cb)
      return () => libraryListeners.delete(cb)
    }
  }
  window.api = api
}
