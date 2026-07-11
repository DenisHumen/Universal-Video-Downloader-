// Shared types used by the main process, preload bridge and renderer.

export type DownloadMode = 'video' | 'audio'

export type QualityPreset =
  | 'best'
  | '2160'
  | '1440'
  | '1080'
  | '720'
  | '480'
  | '360'
  | 'audio'

export type FormatKind = 'video+audio' | 'video' | 'audio' | 'unknown'

export interface VideoFormat {
  id: string
  ext: string
  kind: FormatKind
  resolution: string
  height?: number
  width?: number
  fps?: number
  vcodec?: string
  acodec?: string
  abr?: number
  vbr?: number
  tbr?: number
  filesize?: number
  filesizeApprox?: number
  formatNote?: string
  dynamicRange?: string
}

export interface MediaInfo {
  id: string
  title: string
  description?: string
  thumbnail?: string
  duration?: number
  durationString?: string
  uploader?: string
  channel?: string
  webpageUrl: string
  originalUrl: string
  extractor: string
  isLive: boolean
  viewCount?: number
  formats: VideoFormat[]
  // For playlists: number of entries detected
  playlistCount?: number
  isPlaylist?: boolean
  entries?: PlaylistEntry[]
  // For streaming sites needing translator/episode/quality selection
  streaming?: StreamingInfo
}

export interface PlaylistEntry {
  url: string
  title: string
  thumbnail?: string
}

export interface StreamTranslator {
  id: string
  name: string
  /** Translation is locked behind the site's Premium subscription — not downloadable. */
  premium?: boolean
}

export interface StreamSeason {
  season: number
  episodes: number[]
}

/** Rich info for streaming sites that need translator/episode/quality selection. */
export interface StreamingInfo {
  provider: 'rezka' | 'yummyani'
  host: string
  id: string
  title: string
  thumbnail?: string
  isSeries: boolean
  translators: StreamTranslator[]
  defaultTranslator: string
  seasons: StreamSeason[]
  /** Per-translator season/episode lists, when they differ between translators (e.g. anime dubbings). */
  episodesByTranslator?: Record<string, StreamSeason[]>
  qualities: string[]
}

export type DownloadState =
  | 'queued'
  | 'detecting'
  | 'downloading'
  | 'processing'
  | 'completed'
  | 'error'
  | 'paused'
  | 'canceled'

export interface DownloadRequest {
  url: string
  title?: string
  thumbnail?: string
  mode: DownloadMode
  /** A specific yt-dlp format id, when the user picked one explicitly. */
  formatId?: string
  /** A quality preset, used when no explicit formatId is provided. */
  quality?: QualityPreset
  outputDir?: string
  audioFormat?: string
  embedThumbnail?: boolean
  embedSubtitles?: boolean
  embedMetadata?: boolean
}

export interface DownloadItem {
  id: string
  url: string
  /** The URL the user originally submitted — re-resolved on every (re)start so
   *  short-lived CDN stream links are always fresh. */
  sourceUrl?: string
  title: string
  thumbnail?: string
  extractor?: string
  mode: DownloadMode
  quality?: QualityPreset
  formatId?: string
  state: DownloadState
  percent: number
  speed?: number
  eta?: number
  downloadedBytes?: number
  totalBytes?: number
  filepath?: string
  outputDir: string
  error?: string
  referer?: string
  createdAt: number
  finishedAt?: number
}

export interface DownloadProgress {
  id: string
  state: DownloadState
  percent: number
  speed?: number
  eta?: number
  downloadedBytes?: number
  totalBytes?: number
  fragmentIndex?: number
  fragmentCount?: number
}

export interface AppSettings {
  downloadDir: string
  concurrentDownloads: number
  defaultMode: DownloadMode
  defaultQuality: QualityPreset
  audioFormat: string
  embedThumbnail: boolean
  embedSubtitles: boolean
  embedMetadata: boolean
  restrictFilenames: boolean
  filenameTemplate: string
  autoUpdate: boolean
  theme: 'dark' | 'midnight' | 'aurora'
  proxy: string
  /** Read cookies from this installed browser (e.g. 'chrome', 'firefox', 'safari'). Empty = off. */
  cookiesFromBrowser: string
  /** Optional path to a Netscape-format cookies.txt file (takes precedence over the browser). */
  cookiesFile: string
}

export const SUPPORTED_COOKIE_BROWSERS = [
  'chrome',
  'firefox',
  'edge',
  'safari',
  'brave',
  'chromium',
  'opera',
  'vivaldi'
] as const

export type YtDlpState = 'idle' | 'checking' | 'downloading' | 'ready' | 'error'

export interface YtDlpStatus {
  state: YtDlpState
  version?: string
  percent?: number
  message?: string
}

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateStatus {
  state: UpdateState
  version?: string
  releaseNotes?: string
  releaseDate?: string
  percent?: number
  bytesPerSecond?: number
  message?: string
}

export interface DetectResult {
  ok: boolean
  info?: MediaInfo
  error?: string
}

// ---- Title search ----

/** Services searchable by title (verified to return real results). */
export type SearchService = 'youtube' | 'soundcloud' | 'pornhub' | 'yummyani'

export const SEARCH_SERVICES: readonly SearchService[] = [
  'youtube',
  'soundcloud',
  'pornhub',
  'yummyani'
] as const

/** What the user searches: one service, or all of them in parallel. */
export type SearchScope = SearchService | 'all'

export interface SearchResult {
  id: string
  title: string
  /** Canonical web page — used for "open in browser". */
  url: string
  /**
   * For streaming providers (anime), the internal URL that opens the
   * episode/translator/quality picker instead of downloading directly.
   */
  pickerUrl?: string
  thumbnail?: string
  duration?: number
  uploader?: string
  viewCount?: number
  service: SearchService
}

export interface SearchResponse {
  ok: boolean
  results?: SearchResult[]
  error?: string
}
