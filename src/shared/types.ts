import type { AccentChoice } from './accent'
import type { SmbTarget } from './automation'
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
  /** The language of the audio in this format, as the site names it. */
  language?: string
  /** How much the site favours that language; its own original track ranks far above the rest. */
  languagePreference?: number
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
  /**
   * The listing depth this list ran into, when it did: there may be more past
   * it. Reaching the depth is the signal, because `playlist_count` often only
   * counts what was listed.
   */
  listingCut?: number
  // For streaming sites needing translator/episode/quality selection
  streaming?: StreamingInfo
  /**
   * The URL the queue should store. Differs from `webpageUrl` when the stream
   * has to be re-resolved on every start (universal detection, scraped sites).
   */
  downloadUrl?: string
  /** The stream was found by the universal resolver rather than the engine. */
  viaUniversal?: boolean
  /** Subtitle languages the engine reported for this video: the ones people wrote. */
  subtitleLanguages?: string[]
  /** Machine-made captions on offer. On YouTube this is every language it can translate to. */
  autoCaptionLanguages?: string[]
}

export interface PlaylistEntry {
  url: string
  title: string
  thumbnail?: string
  /** The extractor that handles this entry, which is rarely the playlist's own. */
  extractor?: string
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
  provider: 'rezka' | 'yummyani' | 'kodik' | 'aniliberty'
  host: string
  id: string
  title: string
  thumbnail?: string
  isSeries: boolean
  /** One episode on a player of its own (Kodik's /seria/): downloaded like a film, but not called one. */
  loneEpisode?: boolean
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
  /** YouTube asking this network to prove it is not a bot - not about the video. */
  | 'botCheck'
  /** A site's own bot check, in front of its player: a person passes it in the built-in browser. */
  | 'siteBotCheck'
  /** The site has no video for this dub and episode. */
  | 'noStream'
  /** The dub is for the site's paying members. */
  | 'premiumOnly'
  /** A site's player answered in a shape the resolver cannot read: it has probably changed. */
  | 'playerChanged'
  /** The cookies setting could not be read: a locked or encrypted browser profile. */
  | 'cookiesLocked'
  /** The chosen browser has no cookie database: not installed, or no profile. */
  | 'cookiesNotFound'
  | 'cookiesFileBad'
  /** The engine never ran: usually antivirus. */
  | 'engineBlocked'
  | 'pathTooLong'
  /** Windows: another program holds the file. */
  | 'fileBusy'
  /** The download folder cannot be reached, as on a drive that was unplugged. */
  | 'folderMissing'
  /** The transfer broke off partway. */
  | 'interrupted'
  /** The site's server failed (5xx). */
  | 'serverError'
  /** The picked quality does not exist. A link with no video at all is `noFormats`. */
  | 'noSuchFormat'
  | 'notLive'
  | 'privateVideo'
  | 'membersOnly'
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
  | 'notALink'
  | 'emptyPage'
  | 'cutFailed'
  | 'upcoming'
  | 'badSetting'
  | 'unsupportedPlayer'
  | 'notOnYummyAnime'
  | 'engineMissing'
  | 'adultHidden'
  /** A queued page that needs its stream picked on Home: a series player or a listing. */
  | 'needsPicker'
  /** Stop and Save found nothing recorded yet. */
  | 'liveEmpty'
  /** Stop and Save found a recording it could not turn into a playable file. */
  | 'liveNotSaved'

export type DownloadState =
  | 'queued'
  | 'detecting'
  /** The engine is holding on for a premiere or a stream to start; nothing is being fetched yet. */
  | 'waiting'
  | 'downloading'
  | 'processing'
  | 'completed'
  | 'error'
  | 'paused'
  | 'canceled'

/** A section of a video, in seconds from its start. */
/**
 * What main wanted to tell the window while nothing was listening.
 *
 * IPC messages are not buffered: a link or a view handed to a webContents
 * before the renderer has subscribed is dropped, and there is no second
 * attempt. Main keeps them here instead and the window collects them once it
 * is ready.
 */
export interface PendingDelivery {
  /** A URL from the command line, a second launch, or the clipboard watcher. */
  link?: string
  /** A view the application menu asked for. */
  view?: string
}

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

/**
 * Where a download sits in the playlist or channel it was picked from, which
 * gives it its number, its folder and its track tag. Each entry runs with
 * `--no-playlist`, so the engine itself knows nothing of the list; see
 * main's playlist.ts.
 */
export interface PlaylistPlace {
  /** The playlist's own title: names its folder. */
  title: string
  /** 1-based position in the whole list as the site lists it, not in the selection. */
  index: number
  /** How long the whole list is, which sets the width of the number. */
  count: number
  /**
   * Chosen on the card when the entry was queued, and kept with it rather than
   * read from Settings at start: a paused entry resumes with `--continue` into
   * the file it began, which a later change of mind would have renamed.
   */
  folder: boolean
  numbered: boolean
}

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
   * Which site this came from, as the engine names it. Used for the per-site
   * subfolder — without it every natively-supported site shares one folder.
   */
  extractor?: string
  /**
   * The video height this request will actually produce, when it can be worked
   * out up front. `best` is not a resolution — the queue row should be able to
   * say which one it resolved to.
   */
  targetHeight?: number
  /** Picked from a playlist or channel: its number, its folder, its track tag. */
  playlist?: PlaylistPlace
  /** Who published it, when detection said. The Library groups and searches by it. */
  uploader?: string
  /** The show an episode belongs to (a watch, a streaming site), for the Library's grouping. */
  series?: string
  /** Subtitles picked for this video, by language code, over what Settings says. */
  subtitles?: string[]
  /** The audio track to fetch, by the language code the formats carry. Absent is the site's default. */
  audioLanguage?: string
  /** It has not started yet: wait for it, however long that takes, then download. */
  waitForVideo?: boolean
  /** A live broadcast: it runs until somebody stops it, and stopping it keeps what was recorded. */
  live?: boolean
}

/** Send a finished file to a configured share. The file is looked up from `id`, never taken from the window. */
export interface ShareSendRequest {
  /** The queue row or Library entry. */
  id: string
  targetId: string
  /** Share-relative and '/'-joined; '' for the share itself. */
  folder: string
  /** The person has answered "replace" for a name already taken. */
  replace?: boolean
}

export type ShareSendResult =
  | { status: 'sent'; remotePath: string }
  /** The name is taken and nothing was changed: ask, and send again with `replace`. */
  | { status: 'exists'; name: string }
  | {
      status: 'failed'
      kind: 'auth' | 'network' | 'path' | 'full' | 'busy' | 'unknown' | 'noTarget' | 'noPassword' | 'noFile'
      message: string
    }

export interface ShareSendProgress {
  id: string
  bytes: number
  total: number
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
  /** The page the source file came from, when it has one: what "Download Again" goes back to. */
  originUrl?: string
  /** Handed on from the source, so a clip lands beside it in the Library's groups. */
  extractor?: string
  uploader?: string
  series?: string
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
  /**
   * For trim/convert jobs: the page that file came from. Not `sourceUrl`, which
   * says what this row fetched: everything that asks "is this link already
   * handled?" reads that, and a clip of a video is not the video.
   */
  originUrl?: string
  /** The section this entry covers, when the user trimmed it. */
  range?: TrimRange
  /**
   * Cut exactly where asked by re-encoding, rather than landing on the nearest
   * keyframe. Applies to a trim job on a local file and to a trimmed download
   * alike — the engine and ffmpeg take the same instruction either way.
   */
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
  playlist?: PlaylistPlace
  /** Who published it, and the show it belongs to: see DownloadRequest. */
  uploader?: string
  series?: string
  /** Kept with the row, so a pause, a retry or a restart fetches what was picked. */
  subtitles?: string[]
  audioLanguage?: string
  waitForVideo?: boolean
  state: DownloadState
  percent: number
  speed?: number
  eta?: number
  downloadedBytes?: number
  totalBytes?: number
  filepath?: string
  /**
   * The name a custom-resolved stream is saved under, chosen on its first run
   * and kept, so a resume finds its own partial. See naming.ts.
   */
  outputStem?: string
  /**
   * ` (2)` and so on, when the name the template gave this entry turned out
   * to belong to a different download's file. See naming.ts.
   */
  copySuffix?: string
  /**
   * Fetch this item's HLS stream with ffmpeg instead of the engine's own
   * fragment downloader. Set when that downloader refused the playlist, and
   * kept, so a pause, a retry or a restart does not run into the same refusal.
   */
  hlsViaFfmpeg?: boolean
  /** A live broadcast being recorded; see DownloadRequest. */
  live?: boolean
  /**
   * The files the engine announced for this recording. Kept across a restart:
   * they are how Stop and Save finds what an interrupted run left behind.
   */
  partialPaths?: string[]
  /** Stop and Save is under way: the engine is finishing, or the pieces are being joined. */
  savingLive?: boolean
  /** A recording that could not be made playable: the file it is still in. */
  keptPartial?: string
  /**
   * Where an automated episode was uploaded, as `share/folder/name`. With no
   * `filepath`, the local copy was deleted afterwards and this is the only copy.
   */
  remotePath?: string
  outputDir: string
  error?: string
  /** Machine-readable reason, so the UI can say it in the user's language. */
  errorCode?: AppErrorCode
  /** The failure looks like an access gate and cookies aren't set up yet. */
  cookieHint?: boolean
  /**
   * The failure main kept for an error report, when it is one worth offering.
   * Memory only — it means nothing after a restart, or once the item is retried.
   */
  reportId?: string
  referer?: string
  createdAt: number
  finishedAt?: number
}

/**
 * Everything that happened to the queue in one turn of the main process, sent
 * as one message. An id appears in at most one of the two lists, carrying its
 * latest state; see queue-events.ts for why this is batched at all.
 */
export interface DownloadsChanged {
  updated: DownloadItem[]
  removed: string[]
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
 * Night, Day, or System (4.0, plan 4.4), which follows the OS (Electron's
 * nativeTheme, i.e. `prefers-color-scheme` in the renderer) and switches live.
 * Only Night and Day are ever painted; see `PaintedTheme` in theme-boot.ts.
 *
 * 3.x had collapsed four palettes into these two because only the default had
 * ever been designed; System adds no palette, it picks one of the two.
 */
export const THEMES = ['night', 'day', 'system'] as const
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
  /**
   * Prefer H.264 video and AAC audio when the site offers a choice.
   *
   * Resolution still wins: this only decides between two formats of the same
   * size, so a 4K video that exists only as VP9 or AV1 still comes down as 4K.
   */
  preferCompatible: boolean
  /** Keep checking and downloading with the window closed. Implies the tray. */
  automationEnabled: boolean
  /** Start with the system, so a schedule survives a reboot. */
  autostart: boolean
  /** Shares the upload step can send to. Passwords live in the secret store. */
  smbTargets: SmbTarget[]
  /** Where notifications go. The bot token lives in the secret store. */
  telegramChatId: string
  /** Turn the log up when a bug report is being prepared. */
  logVerbose: boolean
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
  /** Start each playlist entry's file name with its number: `07 - …`. Set on the playlist card. */
  playlistNumbering: boolean
  /** Put a playlist's files in a folder named after it. Set on the playlist card. */
  playlistFolder: boolean
  autoUpdate: boolean
  /** Pick interrupted downloads back up when the app starts. */
  resumeOnLaunch: boolean
  /**
   * How many finished downloads the queue keeps, oldest dropped first. 0 keeps
   * them all. Counts what "clear finished" clears - completed and cancelled -
   * so a failure stays until somebody has looked at it.
   */
  keepFinished: number
  theme: ThemeId
  /** The accent colour (see shared/accent.ts); `system` follows the OS where it reports one. */
  accent: AccentChoice
  language: LanguageId
  /** Show a desktop notification when a download finishes. */
  notifications: boolean
  /** Watch the clipboard and offer to download links copied elsewhere. */
  clipboardWatch: boolean
  /** Download a copied link to a video on a known site without asking. */
  autoDownload: boolean
  /** Sites `autoDownload` leaves alone, by `AutoSource.id`. */
  autoDownloadOff: string[]
  /** Keep running in the tray when the window is closed. */
  trayEnabled: boolean
  /**
   * Let the app open unknown pages in a hidden browser to find their stream.
   * This is what makes sites without a dedicated resolver work.
   */
  universalFallback: boolean
  /** Offer adult sites (`ADULT_SEARCH_SERVICES`) in title search. Off by default. */
  showAdultServices: boolean
  proxy: string
  /** Read cookies from this installed browser (e.g. 'chrome', 'firefox', 'safari'). Empty = off. */
  cookiesFromBrowser: string
  /** Optional path to a Netscape-format cookies.txt file (takes precedence over the browser). */
  cookiesFile: string
  /**
   * Stay signed in to sites in the built-in browser across restarts, and give
   * the engine its cookies when no other cookies are set. On by default.
   */
  browserStaySignedIn: boolean
  /** Offer to save passwords typed into the built-in browser, and fill them in. */
  browserSavePasswords: boolean
  /**
   * Offer to send the developer a report when a link fails. 'ask' still asks
   * every time — there is deliberately no setting that sends on its own.
   */
  errorReports: 'ask' | 'off'
  /**
   * The first-run setup (6.3) was finished or skipped. It shows once; the
   * primary menu opens it again. Not carried in a backup: it is about this
   * install, not about the user's choices.
   */
  setupDone: boolean
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

/**
 * The browsers worth offering on this computer. Safari exists only on a Mac,
 * and on Windows the engine cannot decrypt Chrome's or Edge's cookies at all
 * (app-bound encryption): choosing either broke every later download, public
 * videos included. A choice already saved stays valid; it just isn't offered.
 */
export function cookieBrowsersFor(platform: string | undefined): (typeof SUPPORTED_COOKIE_BROWSERS)[number][] {
  return SUPPORTED_COOKIE_BROWSERS.filter((b) => {
    if (b === 'safari') return platform === 'darwin'
    if (b === 'chrome' || b === 'edge') return platform !== 'win32'
    return true
  })
}

export type YtDlpState = 'idle' | 'checking' | 'downloading' | 'ready' | 'error'

export interface YtDlpStatus {
  state: YtDlpState
  version?: string
  percent?: number
  message?: string
}

/**
 * The answer to "update the engine now". A refusal travels as data rather
 * than as a rejection, because Electron carries only a rejected invoke's
 * message across the bridge - never its class or a `code` - so the renderer
 * could not tell "a download is still using it" from a real failure.
 */
export interface EngineUpdateResult {
  ok: boolean
  version?: string
  /** Set when the update was refused because a download is using the engine. */
  code?: 'engineBusy'
  error?: string
}

/**
 * How this build puts `uvd <link>` within reach of a terminal.
 *
 *  - `none`: Windows, where the command is not shipped, or a build with no
 *    wrapper script in it. Settings shows nothing.
 *  - `development`: a run from the source tree, which has no installed app
 *    for the command to start.
 *  - `package`: a .deb, .rpm or AUR install. The package itself links
 *    /usr/bin/uvd, so there is nothing to do.
 *  - `link`: macOS. A link in /usr/local/bin to the script inside the app,
 *    made with an administrator password, because a disk image cannot do it.
 *  - `script`: an AppImage. A few lines in ~/.local/bin that start it, since
 *    the AppImage is one file with no script of its own to link to.
 */
export type CliInstallMethod = 'none' | 'development' | 'package' | 'link' | 'script'

/** Whether the terminal command is there, and what Settings can do about it. */
export interface CliStatus {
  method: CliInstallMethod
  /** Typing `uvd` reaches this copy of the app. */
  installed: boolean
  /** Where the command is, or where installing it would put it. */
  path?: string
  /** Something else called uvd is already at `path`; installing replaces it. */
  occupied?: boolean
  /** The folder `path` is in is on the PATH the app was started with. */
  onPath?: boolean
  /**
   * The app is running from somewhere a link would not outlive - a mounted
   * disk image, or the copy macOS makes of an app it has not let out of
   * quarantine - so installing would leave a command pointing at nothing.
   */
  temporary?: boolean
}

export interface CliInstallResult {
  ok: boolean
  /** The password prompt was dismissed. Nothing went wrong and nothing changed. */
  canceled?: boolean
  error?: string
  /** The status after the attempt, so the row redraws without asking again. */
  status: CliStatus
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
   * .deb/.rpm installs). The UI then offers the download instead.
   */
  manual?: boolean
  /**
   * Where to send the user when `manual` is set: the installer for this copy
   * when the release has one, otherwise the release page.
   */
  downloadUrl?: string
}

export interface DetectResult {
  ok: boolean
  info?: MediaInfo
  error?: string
  errorCode?: AppErrorCode
  cookieHint?: boolean
  /** A failure main kept for an error report; see `DownloadItem.reportId`. */
  reportId?: string
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
/** How a detect was asked for. */
export interface DetectOptions {
  /**
   * Speculative: nobody is waiting on it yet. The engine probe only - no page
   * scrape, no hidden browser - so a link that is merely sitting on the
   * clipboard never opens a window or fetches a page behind the user's back.
   */
  prefetch?: boolean
  /** List a channel or playlist this deep instead of the setting's depth: "Load More". */
  playlistEnd?: number
}

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
  /** The request this stage belongs to: the same link detected twice is two requests. */
  requestId?: string
}

/**
 * What a link is, from its site's oEmbed endpoint, ahead of the detect: enough
 * to draw the result card's top while the engine works out the formats.
 */
export interface DetectPreview {
  url: string
  requestId?: string
  title?: string
  author?: string
  thumbnail?: string
}

// ---- Title search ----

/**
 * Services searchable by title.
 *
 * YouTube, SoundCloud and Pornhub are searched through the engine; anime,
 * Dailymotion, Niconico and Bilibili through the sites' own JSON APIs, because
 * the engine's search returned nothing for the last three. This used to say
 * every service was verified to return real results while three of them
 * answered every query with "nothing found" - `search-apis.test.ts` now pins
 * the answer shapes, and its live checks can be run by hand.
 */
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

/**
 * Services whose results are adult content.
 *
 * They sat in the default pill row and in every "all services" search, for
 * everyone, so a search for a cartoon could put explicit thumbnails on the
 * screen of someone who had never asked for them. They are now opt-in, with
 * `AppSettings.showAdultServices`.
 */
export const ADULT_SEARCH_SERVICES: readonly SearchService[] = ['pornhub'] as const

/** The services in `list` the user's adult-content choice allows. */
export function allowedSearchServices<T extends SearchScope>(list: readonly T[], showAdult: boolean): T[] {
  return showAdult ? [...list] : list.filter((s) => !ADULT_SEARCH_SERVICES.includes(s as SearchService))
}

/** The most results one service is asked for: what the site APIs and the engine's own searches take. */
export const SEARCH_CAP = 30
/** The same when every service is searched at once, per service, so the wait stays bearable. */
export const SEARCH_CAP_PER_SERVICE = 12

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

/** The built-in browser offering to keep a password just typed. */
export interface BrowserLoginOffer {
  /** The site's host, for the sentence. */
  site: string
  username: string
  /** A password for that username is saved already, and this one differs. */
  update: boolean
}

/** A site with saved passwords, as Settings lists it: never the passwords. */
/** What importing another browser's sign-ins came to. */
export type SignInImport =
  | { ok: true; sites: number }
  | { ok: false; why: 'notFound' | 'locked' | 'encrypted' | 'empty' | 'failed' }

export interface SavedSiteLogins {
  origin: string
  usernames: string[]
}
