// Shared types used by the main process, preload bridge and renderer.

export type DownloadMode = 'video' | 'audio'

/**
 * `best`, `audio`, or a target height as a string. Any height is allowed — the
 * quality row is built from what a video really offers, which is not always a
 * member of the usual ladder (240p, 576p and 1084p all turn up in the wild).
 */
export type QualityPreset = 'best' | 'audio' | `${number}`

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
  /**
   * The URL the queue should store. Differs from `webpageUrl` when the stream
   * has to be re-resolved on every start (universal detection, scraped sites).
   */
  downloadUrl?: string
  /** The stream was found by the universal resolver rather than the engine. */
  viaUniversal?: boolean
  /** Subtitle languages the engine reported for this video. */
  subtitleLanguages?: string[]
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

/**
 * Why something failed, in a form both processes agree on.
 *
 * The main process speaks yt-dlp and ffmpeg; the renderer speaks the user's
 * language. A code is what crosses between them — the English sentence travels
 * alongside it as a fallback for failures no rule has learned to recognise.
 */
export type AppErrorCode =
  | 'unavailable'
  | 'ageRestricted'
  | 'rateLimited'
  | 'signIn'
  | 'forbidden'
  | 'geo'
  | 'drm'
  | 'diskFull'
  | 'permission'
  | 'postprocess'
  | 'noFormats'
  | 'network'
  | 'timeout'
  | 'canceled'
  | 'sourceMissing'
  | 'noAudioTrack'
  | 'damagedSource'
  | 'unknownEncoder'
  | 'ffmpegMissing'
  | 'streamGone'
  | 'corruptLink'
  | 'emptyPage'

export type DownloadState =
  | 'queued'
  | 'detecting'
  | 'downloading'
  | 'processing'
  | 'completed'
  | 'error'
  | 'paused'
  | 'canceled'

/** A section of a video, in seconds from its start. */
export interface TrimRange {
  start?: number
  /** Undefined means "to the end". */
  end?: number
}

export function hasTrim(range?: TrimRange): boolean {
  if (!range) return false
  return (range.start ?? 0) > 0 || range.end != null
}

export const VIDEO_CONTAINERS = ['mp4', 'mkv', 'webm', 'mov', 'gif'] as const
export const AUDIO_CONTAINERS = ['mp3', 'm4a', 'opus', 'flac', 'wav', 'aac'] as const

export interface ConvertTarget {
  mode: DownloadMode
  /** mp4 / mkv / webm / mov / gif, or an audio container. */
  container: string
  /** Optional downscale, e.g. 720. */
  height?: number
}

/** What a queue entry is doing: fetching a video, or reworking a local file. */
export type QueueKind = 'download' | 'trim' | 'convert'

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
  /**
   * Fetch only this section of the video. The engine downloads just the
   * requested range, so trimming a clip out of a two-hour stream costs
   * seconds rather than the whole file.
   */
  section?: TrimRange
  /**
   * Re-encode the section so the cut lands exactly where it was asked for,
   * rather than on the nearest keyframe. Slower — often much slower — so it is
   * a choice rather than a rule. Defaults to true, which is what the app did
   * before it was a choice at all.
   */
  preciseSection?: boolean
  /**
   * How long the source is, when detection already knew. Used to turn ffmpeg's
   * output timestamp into a percentage for downloads the engine can only fetch
   * through ffmpeg (trimmed sections, some live and HLS streams).
   */
  duration?: number
  /**
   * The video height this request will actually produce, when it can be worked
   * out up front. `best` is not a resolution — the queue row should be able to
   * say which one it resolved to.
   */
  targetHeight?: number
}

/** What ffmpeg found inside a local file. */
export interface MediaProbe {
  duration?: number
  hasVideo: boolean
  hasAudio: boolean
}

/** Rework a file that's already on disk. */
export interface MediaJobRequest {
  kind: 'trim' | 'convert'
  sourcePath: string
  title: string
  thumbnail?: string
  /** trim only */
  range?: TrimRange
  /** trim only — re-encode for a frame-accurate cut instead of copying. */
  precise?: boolean
  /** convert only */
  target?: ConvertTarget
}

export interface DownloadItem {
  id: string
  url: string
  /** Downloading a video, or reworking a local file. Absent means 'download'. */
  kind?: QueueKind
  /** For trim/convert jobs: the file being reworked. */
  sourcePath?: string
  /** The section this entry covers, when the user trimmed it. */
  range?: TrimRange
  /** Trim jobs: re-encode for a frame-accurate cut rather than copying. */
  precise?: boolean
  /** Convert jobs: the requested output format. */
  convertTarget?: ConvertTarget
  /** Human-readable summary of a trim/convert job, shown on the card. */
  jobLabel?: string
  /** Source duration in seconds, when known — seeds the trim editor. */
  duration?: number
  /** Extra HTTP headers the stream needs, filled in when the URL is resolved. */
  headers?: Record<string, string>
  /** Tail of the engine's output — shown in the card's details drawer. */
  log?: string
  /** How many automatic retries this item has already burned. */
  attempts?: number
  /**
   * Paused because the app was quitting, not because the user asked. Only
   * these are picked back up on the next launch — a download someone
   * deliberately paused should stay paused.
   */
  interrupted?: boolean
  /**
   * Higher runs sooner. Absent means "normal", so the queue stays first-in
   * first-out unless somebody asks for something specific.
   */
  priority?: number
  /**
   * Which half of the job is running. Fetching is only the first part: a
   * trimmed download re-encodes afterwards, a video+audio download merges. The
   * bar gives the download 0–90% and post-processing the last 10%.
   */
  phase?: 'download' | 'postprocess'
  /** What that post-processing step is, when it is one worth naming. */
  postprocess?: 'trim' | 'merge' | 'convert'
  /** The phase has no percentage to report — show motion, not a figure. */
  indeterminate?: boolean
  /** The URL the user originally submitted — re-resolved on every (re)start so
   *  short-lived CDN stream links are always fresh. */
  sourceUrl?: string
  title: string
  thumbnail?: string
  extractor?: string
  mode: DownloadMode
  quality?: QualityPreset
  formatId?: string
  /** The height this download resolves to, when it was known at queue time. */
  targetHeight?: number
  state: DownloadState
  percent: number
  speed?: number
  eta?: number
  downloadedBytes?: number
  totalBytes?: number
  filepath?: string
  outputDir: string
  error?: string
  /** Machine-readable reason, so the UI can say it in the user's language. */
  errorCode?: AppErrorCode
  /** The failure looks like an access gate and cookies aren't set up yet. */
  cookieHint?: boolean
  referer?: string
  createdAt: number
  finishedAt?: number
}

export interface DownloadProgress {
  id: string
  state: DownloadState
  percent: number
  phase?: 'download' | 'postprocess'
  postprocess?: 'trim' | 'merge' | 'convert'
  indeterminate?: boolean
  speed?: number
  eta?: number
  downloadedBytes?: number
  totalBytes?: number
  fragmentIndex?: number
  fragmentCount?: number
}

/**
 * Two themes, one accent.
 *
 * The previous build shipped four palettes and seven accents — 28 combinations,
 * of which only the default was ever really designed. The system now carries a
 * single saturated colour, so the only choice left is the one that depends on
 * the room you're sitting in.
 */
export const THEMES = ['night', 'day'] as const
export type ThemeId = (typeof THEMES)[number]

/** Palettes that existed before the redesign, mapped onto the two that remain. */
export const LEGACY_THEMES: Record<string, ThemeId> = {
  midnight: 'night',
  carbon: 'night',
  nebula: 'night',
  daylight: 'day'
}

export type LanguageId = 'auto' | 'en' | 'ru'

export interface AppSettings {
  downloadDir: string
  concurrentDownloads: number
  defaultMode: DownloadMode
  defaultQuality: QualityPreset
  audioFormat: string
  embedThumbnail: boolean
  embedSubtitles: boolean
  embedMetadata: boolean
  embedChapters: boolean
  /** Save subtitles next to the video as .srt files too. */
  writeSubtitles: boolean
  /** Comma-separated language codes, or 'all'. */
  subtitleLanguages: string
  /** Strip sponsor/intro segments from YouTube videos via SponsorBlock. */
  sponsorBlock: boolean
  restrictFilenames: boolean
  filenameTemplate: string
  /** Put each download in a subfolder named after the site. */
  createSubfolders: boolean
  /** Engine rate limit, e.g. '2M' or '500K'. Empty = unlimited. */
  speedLimit: string
  /**
   * How many entries to pull when expanding a channel or playlist. Big
   * channels run to thousands of videos; listing them is cheap, but the user
   * decides how deep to go.
   */
  playlistLimit: number
  autoUpdate: boolean
  /** Pick interrupted downloads back up when the app starts. */
  resumeOnLaunch: boolean
  theme: ThemeId
  language: LanguageId
  /** Show a desktop notification when a download finishes. */
  notifications: boolean
  /** Watch the clipboard and offer to download links copied elsewhere. */
  clipboardWatch: boolean
  /** Keep running in the tray when the window is closed. */
  trayEnabled: boolean
  /**
   * Let the app open unknown pages in a hidden browser to find their stream.
   * This is what makes sites without a dedicated resolver work.
   */
  universalFallback: boolean
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
  /**
   * True when this build can't install updates itself (unsigned macOS builds,
   * .deb/.rpm installs). The UI then offers the download page instead.
   */
  manual?: boolean
  /** Where to send the user when `manual` is set. */
  downloadUrl?: string
}

export interface DetectResult {
  ok: boolean
  info?: MediaInfo
  error?: string
  errorCode?: AppErrorCode
  cookieHint?: boolean
}

// ---- Built-in browser ----

/** A media stream seen on the page currently open in the built-in browser. */
export interface BrowserMedia {
  id: string
  url: string
  kind: 'hls' | 'dash' | 'file' | 'unknown'
  /** Short label for the list — usually the filename. */
  label: string
  /** How confident we are that this is the real video. */
  score: number
  /** Where it was seen. */
  pageUrl: string
  pageTitle?: string
  thumbnail?: string
  /** Bytes, when the response advertised a Content-Length. */
  bytes?: number
  seenAt: number
}

export interface BrowserState {
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
  /** Click-to-pick mode is armed. */
  picking: boolean
}

/** What the detector is currently doing, streamed to the UI while it works. */
export type DetectStage =
  | 'idle'
  | 'resolving'
  | 'engine'
  | 'scraping'
  | 'browsing'
  | 'probing'
  | 'done'

export interface DetectStatus {
  stage: DetectStage
  url: string
}

// ---- Title search ----

/** Services searchable by title (each verified to return real results). */
export type SearchService =
  | 'youtube'
  | 'soundcloud'
  | 'dailymotion'
  | 'bilibili'
  | 'niconico'
  | 'pornhub'
  | 'yummyani'

export const SEARCH_SERVICES: readonly SearchService[] = [
  'youtube',
  'soundcloud',
  'dailymotion',
  'bilibili',
  'niconico',
  'pornhub',
  'yummyani'
] as const

/**
 * The subset queried when the user searches "everything". Kept small on
 * purpose: every extra service is another round trip before results appear.
 */
export const SEARCH_ALL_SERVICES: readonly SearchService[] = [
  'youtube',
  'soundcloud',
  'dailymotion',
  'yummyani',
  'pornhub'
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
  errorCode?: AppErrorCode
}
