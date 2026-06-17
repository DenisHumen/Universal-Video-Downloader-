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
