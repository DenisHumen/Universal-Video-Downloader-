import type { UvdApi, AppInfo } from '../../../preload/index'
import type {
  AppSettings,
  DownloadItem,
  MediaInfo,
  SearchResult
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
  restrictFilenames: false,
  filenameTemplate: '%(title)s [%(id)s].%(ext)s',
  autoUpdate: true,
  theme: 'midnight',
  proxy: '',
  cookiesFromBrowser: '',
  cookiesFile: ''
}

const appInfo: AppInfo = {
  version: 'dev',
  name: 'universal-video-downloader',
  platform: 'win32' as NodeJS.Platform,
  arch: 'x64',
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
    formats: [
      { id: '137', ext: 'mp4', kind: 'video', resolution: '1080p', height: 1080, vcodec: 'avc1' },
      { id: '22', ext: 'mp4', kind: 'video+audio', resolution: '720p', height: 720, vcodec: 'avc1', acodec: 'mp4a' },
      { id: '18', ext: 'mp4', kind: 'video+audio', resolution: '360p', height: 360, vcodec: 'avc1', acodec: 'mp4a' },
      { id: '140', ext: 'm4a', kind: 'audio', resolution: 'audio', acodec: 'mp4a' }
    ]
  }
}

function fakeResults(query: string): SearchResult[] {
  return Array.from({ length: 9 }, (_, i) => ({
    id: `mock-${i}`,
    title: `${query} — result ${i + 1}: an adequately long video title to test clamping`,
    url: `https://example.com/watch?v=mock-${i}`,
    thumbnail: `https://picsum.photos/seed/uvd${i}/480/270`,
    duration: 63 + i * 137,
    uploader: ['Blender Foundation', 'NASA', 'Kurzgesagt'][i % 3],
    viewCount: 1000 * (i + 1) ** 3,
    service: 'youtube' as const
  }))
}

let itemSeq = 0

export function installMockApi(): void {
  const api: UvdApi = {
    detect: async (url) => {
      await delay(700)
      return { ok: true, info: fakeInfo(url) }
    },
    searchVideos: async (query) => {
      await delay(800)
      return { ok: true, results: fakeResults(query) }
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
        title: req.title || req.url,
        thumbnail: req.thumbnail,
        mode: req.mode,
        quality: req.quality,
        state: 'queued',
        percent: 0,
        outputDir: settings.downloadDir,
        createdAt: Date.now()
      }
      return item
    },
    pauseDownload: async () => undefined,
    resumeDownload: async () => undefined,
    cancelDownload: async () => undefined,
    retryDownload: async () => undefined,
    removeDownload: async () => undefined,
    clearFinished: async () => undefined,
    listDownloads: async () => [],
    getSettings: async () => ({ ...settings }),
    setSettings: async (partial) => Object.assign(settings, partial),
    chooseDirectory: async () => null,
    openPath: async () => '',
    showInFolder: async () => undefined,
    openExternal: async (url) => {
      window.open(url, '_blank')
    },
    ensureYtdlp: async () => appInfo.ytdlp,
    updateYtdlp: async () => 'mock',
    checkForUpdates: async () => appInfo.update,
    downloadUpdate: async () => undefined,
    installUpdate: async () => undefined,
    getAppInfo: async () => appInfo,
    minimizeWindow: async () => undefined,
    maximizeWindow: async () => false,
    closeWindow: async () => undefined,
    isWindowMaximized: async () => false,
    onDownloadProgress: () => () => undefined,
    onDownloadUpdated: () => () => undefined,
    onYtdlpStatus: () => () => undefined,
    onUpdateStatus: () => () => undefined
  }
  window.api = api
}
