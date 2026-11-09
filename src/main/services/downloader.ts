import { app } from 'electron'
import { EventEmitter } from 'events'
import { spawn, ChildProcess, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'fs'
import { basename, dirname, join } from 'path'
import { randomUUID } from 'crypto'
import { ytdlpBinaryPath, ensureYtdlp, ytdlpSpawnOptions } from './ytdlp'
import {
  buildConvertArgs,
  buildTrimArgs,
  classifyFfmpegError,
  FfmpegMissingError,
  ffmpegLocation,
  probeMedia,
  rangeDuration,
  runFfmpeg,
  toTimestamp,
  uniqueOutputPath
} from './ffmpeg'
import { getSettings } from './settings'
import { log } from './log'
import { failure, noteRefusedWrite, ReadFailure, readJsonStore, writeJsonAtomic } from './json-store'
import { clearedBy, finishedBeyond, forHistory, isFinished, isHistoryEntry } from './history'
import { knownSiteFor } from '@shared/auto-sources'
import { downloadFields } from './log-fields'
import {
  accessArgs,
  classifyYtdlpError,
  hasCookies,
  headerArgs,
  isTransientError,
  refusesMidStreamInit,
  subtitleMissIn,
  withPostprocessHeading
} from './options'
import { IN_FLIGHT_STATES, isSameDownload } from './dedupe'
import {
  freeCopySuffix,
  isInsideFolder,
  isMediaName,
  isSidecarName,
  isLoneEmbed,
  pickOutputStem,
  samePath,
  sectionSuffix,
  shouldTakeOwnName,
  templateFor,
  variantSuffix,
  waitsForNamesake,
  withNameSuffix
} from './naming'
import { interruptTree, killTree } from './process'
import { joinFragments, keptFile, piecesOnDisk, remuxArgs, removePieces, savedPath } from './live-recording'
import { markInterrupted, shouldResume } from './resume'
import { pendingOrder } from './schedule'
import { acceptsPostprocess, overallProgress, postprocessorLabel } from './progress'
import { ffmpegProgressSeconds, ffmpegTransfer, isFfmpegNoise, splitOutputLines } from './ffmpeg-output'
import { lineReader } from './engine-output'
import { markOf, shouldEmitProgress, type ProgressMark } from './throttle'
import { recordDownloadFailure } from './report'
import { normalisePlaylist, playlistDir, playlistTagArgs } from './playlist'
import { resolveUrl } from '../resolvers'
import { isAbsoluteUrl, isWebLink, normalizeUrl } from '@shared/urls'
import { infoKey, isStaleInfoError } from './info-cache'
import { infoCache } from './info-store'
import { numberedName } from '@shared/playlist'
import { pageUrlOf } from '@shared/page-url'
import { cleanLanguage, cleanLanguages } from '@shared/languages'
import { browserCookiesFile } from './browser-logins'
import { hasTrim } from '@shared/types'
import type {
  AppErrorCode,
  AppSettings,
  DownloadItem,
  DownloadProgress,
  DownloadRequest,
  MediaJobRequest,
  QualityPreset
} from '@shared/types'

export const downloadEvents = new EventEmitter()

export const PROGRESS_PREFIX = '@@UVD@@'
/** Post-processing progress, on its own channel so the parser can tell them apart. */
export const POSTPROCESS_PREFIX = '@@UVDPP@@'
/*
  Seconds between looks at a video that has not started: at the time the site
  gives if that is sooner, at least a minute apart, and at most half an hour,
  because a premiere's time moves and a stream can start early.
*/
const WAIT_FOR_VIDEO_RANGE = '60-1800'
/** Automatic retries for transient network failures before we bother the user. */
const AUTO_RETRIES = 2
/** How soon a wait that lost the network looks again. */
const WAIT_RETRY_MS = 60_000
const LOG_TAIL_CHARS = 4000

const items = new Map<string, DownloadItem>()
const procs = new Map<string, ChildProcess>()
const finalPaths = new Map<string, { path: string; priority: number }>()
const retryTimers = new Map<string, NodeJS.Timeout>()
/*
  Resolving is the one phase of a download with no process behind it, so
  cancel had nothing to kill. For a universal-resolved item that phase opens a
  hidden browser window and drives the page, and it carried on doing so after
  the user had stopped the download.
*/
const resolveAborts = new Map<string, AbortController>()

/*
  Ids whose process we killed on purpose.

  Killing is asynchronous everywhere, and on Windows `killTree` shells out to
  taskkill, so `close` can arrive a good fraction of a second after the pause.
  The handler decided whether a stop was deliberate by reading the item's state
  at that moment — but the user can press resume in the meantime, which sets the
  state to 'queued'. The late close then matched neither 'paused' nor 'canceled',
  fell through to `fail()`, and turned a pause-then-resume into a failed
  download complete with a "Download failed" notification. Pausing and resuming
  everything from the toolbar did it to every running item at once.
*/
const deliberateStops = new Set<string>()

/*
  Recordings told to finish, with the deadline for hearing back. See
  `stopLiveRecording`. Long enough for a slow disk to take ffmpeg's last write,
  and off once the engine says it heard: fixing the container of a long
  recording then takes as long as it takes.
*/
const liveStops = new Map<string, NodeJS.Timeout>()
const LIVE_STOP_GRACE = 20_000

/** Items whose next run must extract afresh: the detect's JSON just failed them once. */
const skipInfo = new Set<string>()

/*
  What we told the engine to name each file, so the result can be found again.

  Left to itself the engine writes its pipes in the console's own code page,
  not UTF-8 - measured here as cp1251 for a Cyrillic title, and neither
  PYTHONIOENCODING nor PYTHONUTF8 changes it. Every non-Latin character in the
  destination path came back as U+FFFD, and the file downloaded perfectly and
  then could not be found. `buildArgs` now passes `--encoding utf-8`, which is
  the actual fix; this is the second line of defence for the streams whose name
  the app chose itself. `readdirSync` hands back real strings, and the only
  thing the engine decides is the extension.
*/
const expectedNames = new Map<string, { dir: string; stem: string }>()

/*
  The file the engine skipped because one of that name already existed, per
  running item. Exit 0 then only means "nothing to do"; whether that file is
  the one this entry asked for is decided when the process closes - see
  `shouldTakeOwnName`.
*/
const alreadyOnDisk = new Map<string, string>()

/** Stop any in-flight link resolution for this item. */
function abortResolve(id: string): void {
  resolveAborts.get(id)?.abort()
  resolveAborts.delete(id)
}

function historyFile(): string {
  return join(app.getPath('userData'), 'history.json')
}

function num(value: string | undefined): number | undefined {
  if (!value || value === 'NA') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

/**
 * history.json is there but could not be read. Saving now would replace the
 * queue the user had with this session's few rows, so saves wait until a read
 * succeeds and the two have been put together. See json-store.ts.
 */
const historyUnread = new ReadFailure()

/**
 * Read history.json into the queue.
 *
 * Returns false when the file is there but could not be read. `announce` is for
 * a late read, after the window already has its list: the rows it brings back
 * are new to the window and have to be sent to it.
 *
 * They go out as 'restored', not 'updated'. Every 'updated' passes through the
 * desktop notifications, which announce any finished or failed row they have
 * not announced yet - and no restored row has been announced in this session.
 * A history of three hundred rows that a scanner had held at launch popped
 * three hundred "Download finished" toasts the moment it could be read, quite
 * possibly while the app was quitting. These rows finished in another session;
 * the window needs them, the notifications do not.
 */
function readHistory(announce: boolean): boolean {
  const read = readJsonStore(historyFile(), 'history', Array.isArray)
  if (read.status === 'unreadable') {
    historyUnread.set()
    return false
  }
  historyUnread.clear()
  if (read.status !== 'ok') return true
  for (const item of read.data as unknown[]) {
    // An id this session already has is this session's row, and newer.
    if (!isHistoryEntry(item) || items.has(item.id)) continue
    // Anything still in flight in the file was cut short — either the app was
    // killed before it could tidy up, or the shutdown path already parked it
    // and this is a no-op. Same rule either way; see resume.ts.
    markInterrupted(item)
    item.attempts = 0
    // The failure it pointed at lived in the previous run's memory.
    item.reportId = undefined
    items.set(item.id, item)
    if (announce) downloadEvents.emit('restored', publicItem(item))
  }
  return true
}

export function loadHistory(): void {
  try {
    if (readHistory(false)) applyHistoryLimit()
  } catch (err) {
    /*
      The queue the user had is gone for this session, and a packaged build
      has no console: the log is the only place that can say why.
    */
    log.error('history', 'Load failed', failure(err))
  }
}

let saveTimer: NodeJS.Timeout | null = null
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(flushHistory, 400)
}

/**
 * Persist atomically — a half-written history.json would lose the whole queue.
 *
 * Compact, not indented: nobody reads this file, and the indentation alone was
 * about a fifth of its size and of the time spent writing it. A completed
 * row's log is trimmed to its last lines on the way to disk (see history.ts).
 * Synchronous on purpose: it runs on the way out too, where nothing would wait
 * for an asynchronous write to land.
 *
 * `retryNow` is for that last save, which is the last chance to read a file
 * that could not be read before, however recently that was tried.
 */
export function flushHistory(retryNow = false): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  try {
    if (historyUnread.active) {
      if (!(retryNow || historyUnread.due()) || !readHistory(true)) {
        noteRefusedWrite(historyFile(), 'history')
        return
      }
      applyHistoryLimit()
    }
    writeJsonAtomic(historyFile(), [...items.values()].map((item) => forHistory(publicItem(item))))
  } catch (err) {
    log.error('history', 'Save failed', failure(err))
  }
}

/**
 * An item as anyone outside this module is allowed to see it.
 *
 * The captured headers stay behind. When the built-in browser or the sniffer
 * catches a stream, it keeps whatever the page sent with it — including
 * `Cookie` and `Authorization`, because that is often the only reason the CDN
 * will serve the file. Those are live session credentials for whatever site
 * the user was signed into, and every item was being written verbatim into
 * history.json and broadcast to the renderer on each update.
 *
 * Nothing outside needs them: the download re-resolves its source URL on every
 * start, so the headers are rebuilt fresh each time anyway. They live in memory
 * for exactly as long as the process does.
 */
function publicItem(item: DownloadItem): DownloadItem {
  if (!item.headers) return { ...item }
  const { headers: _headers, ...rest } = item
  return rest
}

export function listDownloads(): DownloadItem[] {
  return [...items.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(publicItem)
}

/** One queue item as it stands now, for something waiting on it that may have missed its events. */
export function getDownload(id: string): DownloadItem | undefined {
  const item = items.get(id)
  return item ? publicItem(item) : undefined
}

/**
 * Say where a finished item's file went after something else moved it.
 *
 * For the automation, which renames an episode after the queue is done with it
 * and may delete it once it is on a share. The row kept pointing at the name
 * the download landed under, so Play and Show in folder did nothing for every
 * automated episode. A field set to `undefined` is sent as such, so the screen
 * drops the old path too. An item somebody removed in the meantime stays gone.
 */
export function relocateItem(id: string, patch: { filepath?: string; remotePath?: string }): void {
  const item = items.get(id)
  if (!item) return
  Object.assign(item, patch)
  emitUpdated(item)
}

function emitUpdated(item: DownloadItem): void {
  /*
    Nothing to say about an item that is gone.

    Removing a running download kills its process, but the kill is a signal —
    the close handler still runs, still writes a terminal state, and still
    emitted. The renderer treats an id it doesn't know as a new row, so the
    entry the user had just deleted reappeared a second later as completed or
    failed, and stayed until the next restart — by which point history on disk
    and the list on screen disagreed.
  */
  if (!items.has(item.id)) return
  downloadEvents.emit('updated', publicItem(item))
  /*
    Here, as a row finishes, and not in flushHistory: a save happens after any
    change at all, and rows disappearing on a progress tick's save would be the
    queue changing under the user for no reason they could see. After the
    'updated', so anything waiting on this row hears that it finished first;
    being the newest finished row, it is never the one dropped.
  */
  if (isFinished(item.state)) applyHistoryLimit()
  scheduleSave()
}

/** The last progress payload sent per item, so the next can be rate-limited. */
const progressMarks = new Map<string, ProgressMark>()

/**
 * Tell the renderer where a job is, at a pace a person can read.
 *
 * The engine talks far faster than the interface needs to listen, and every
 * update replaced the store's list and redrew the queue. Changes of kind — a
 * new state, a new phase, the end of the bar — always go straight through; a
 * figure creeping up within one phase waits its turn. See throttle.ts.
 */
function emitProgress(progress: DownloadProgress): void {
  const now = Date.now()
  if (!shouldEmitProgress(progressMarks.get(progress.id), progress, now)) return
  progressMarks.set(progress.id, markOf(progress, now))
  downloadEvents.emit('progress', progress)
}

function forgetProgress(id: string): void {
  progressMarks.delete(id)
  resumedFigure.delete(id)
}

/**
 * Rows showing the figure their last run reached, until this run says its own.
 *
 * A resume starts the engine again, so that figure must not act as a floor: a
 * row paused during a merge would sit at 90% through all of a fresh download.
 * Zeroing it was worse to look at, though. A row at 72% before a restart read 0%
 * until the first progress line, which is seconds on a site that has to be asked.
 */
const resumedFigure = new Set<string>()

/**
 * The ways to get one audio language at a height, for the front of a selector.
 *
 * `bv`, not the `bv*` of the plain selector. `bv*` can choose a format that has
 * sound of its own, and the engine, keeping one audio track, then drops the one
 * asked for: checked against the real engine, `bv*[height<=?360]+ba[language=de]`
 * on a video with a combined 360p comes back as that format alone, in English.
 * Past these the selector goes on to the plain choices, so a language the site
 * has stopped offering by the time this runs still gets the video.
 */
function languageChoices(language: string, height?: number): string {
  const lang = `[language=${language}]`
  if (!height) return `bv+ba${lang}/b${lang}/`
  // The language was asked for by name, so it outranks a height with no silent video.
  return `bv[height<=?${height}]+ba${lang}/b[height<=?${height}]${lang}/bv+ba${lang}/`
}

function qualityFormat(quality: QualityPreset | undefined, language?: string): string {
  if (quality === 'audio') return language ? `ba[language=${language}]/bestaudio/best` : 'bestaudio/best'
  const height = Number(quality)
  // 'best' (and anything non-numeric) → let the engine pick the best available.
  if (!Number.isFinite(height) || height <= 0) return `${language ? languageChoices(language) : ''}bv*+ba/b`
  // `<=?` keeps formats with unknown height in play (common for HLS streams),
  // and the trailing `bv*+ba/b` means a request above what the site offers
  // falls back to the best available instead of erroring out.
  return `${language ? languageChoices(language, height) : ''}bv*[height<=?${height}]+ba/b[height<=?${height}]/bv*+ba/b`
}

/**
 * Strip characters no filesystem we support will accept.
 *
 * Control characters included. Titles are scraped off pages we did not write,
 * and a NUL in one ends up in the `-o` argument, where `spawn` refuses it by
 * throwing - which used to leave the row saying "downloading" for good, with
 * no process behind it and a concurrency slot gone until restart.
 */
export function safeName(title: string): string {
  return title
    .replace(/[%/\\:*?"<>|\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150)
}

/*
  Extractor names that say how a video was found rather than where it lives:
  the universal fallback, the engine's generic extractor, a pick from the
  built-in browser. Filed under those, every site without a resolver of its own
  - the long tail a folder per site is most useful for - shared one folder.
*/
const NOT_A_SITE = /^(universal|generic|browser)$/i

/** The site a download came from, for the per-site subfolder. */
export function siteFolder(item: Pick<DownloadItem, 'extractor' | 'sourceUrl' | 'url'>): string {
  /*
    `extractor` is only ever set by a hand-written resolver, and there are three
    of those. Every site the engine handles natively — which is to say YouTube,
    Vimeo, TikTok, all of them — arrived with it undefined and went into a
    single folder called `other`, so the setting that promises "a folder per
    site" delivered one folder for the entire internet.

    The detector knows the extractor and now sends it along; the host name is
    the fallback for anything queued before that, for links queued without a
    detect step at all, and for the labels in NOT_A_SITE.
  */
  const page = pageUrlOf(item.sourceUrl || item.url)
  /*
    A site the app knows by name goes by that name first, whatever spelled it.
    With no detect step (Download Now, a batch, the terminal) only the host is
    known, so one site landed in `youtube.com`, `youtu.be` and `Youtube`.
  */
  const known = knownSiteFor(page)
  if (known) return safeName(known.name)
  if (item.extractor && !NOT_A_SITE.test(item.extractor)) return safeName(item.extractor)
  try {
    return safeName(new URL(page).hostname.replace(/^www\./, ''))
  } catch {
    return ''
  }
}

/** Where this item's file goes, without touching the disk. */
export function plannedDir(item: DownloadItem, settings: AppSettings): string {
  if (item.runDir) return item.runDir
  const site = settings.createSubfolders
    ? join(item.outputDir, siteFolder(item) || 'other')
    : item.outputDir
  // A playlist's own folder goes inside the site's, not around it: the site is the broader sort.
  return playlistDir(site, item.playlist)
}

/**
 * The folder a row that ran before `runDir` existed was using, when it is there.
 *
 * Those went by extractor and then by host, before a site the app knows got its
 * own name: `youtube.com` is `YouTube` now. Going by the new name, a row cut short
 * under the old one would start from zero in a new folder and leave its partial
 * where nothing would ever find it. `log` is how to tell it has run, as in
 * `settleOutputStem`.
 */
function folderFromBefore(item: DownloadItem, settings: AppSettings): string | undefined {
  if (!settings.createSubfolders || item.log == null) return undefined
  let site = item.extractor && !NOT_A_SITE.test(item.extractor) ? safeName(item.extractor) : ''
  if (!site) {
    try {
      site = safeName(new URL(pageUrlOf(item.sourceUrl || item.url)).hostname.replace(/^www\./, ''))
    } catch {
      return undefined
    }
  }
  const dir = site ? playlistDir(join(item.outputDir, site), item.playlist) : undefined
  return dir && existsSync(dir) ? dir : undefined
}

/**
 * Where this run writes, made if need be. The first answer stands for every later
 * run: `--continue` only finds a partial in the folder it was left in, and the
 * rule can give another answer next time, because a resolve has since learned the
 * extractor, or because an update changed it.
 */
function outputDirFor(item: DownloadItem, settings: AppSettings): string {
  const dir = item.runDir ?? folderFromBefore(item, settings) ?? plannedDir(item, settings)
  if (dir !== item.outputDir) {
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    } catch {
      return item.outputDir
    }
  }
  if (item.runDir !== dir) {
    item.runDir = dir
    scheduleSave()
  }
  return dir
}

/**
 * The title the app names a custom-resolved stream after (e.g. a scraped
 * .m3u8), whose title according to the engine is meaningless. Undefined when
 * the engine's own filename template decides.
 */
function chosenStem(item: DownloadItem): string | undefined {
  if (!(item.referer || item.headers) || !item.title) return undefined
  // A playlist entry's number goes on the stem too: the finished file is looked for by it.
  return numberedName(safeName(item.title) || 'video', item.playlist)
}

/**
 * Settle the name a custom-resolved stream is saved under, for this run and
 * every later one. See `pickOutputStem` for the rules; this gathers what they
 * need - the folder's contents, and what the rest of the queue has claimed in
 * it.
 */
function settleOutputStem(item: DownloadItem, dir: string, settings: AppSettings): string | undefined {
  const base = chosenStem(item)
  if (!base) return undefined
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    /* not there yet: nothing in it can collide */
  }
  const held = new Set<string>()
  const finished = new Set<string>()
  for (const other of items.values()) {
    if (other.id === item.id) continue
    if (other.outputStem && IN_FLIGHT_STATES.includes(other.state)) {
      const otherDir = expectedNames.get(other.id)?.dir ?? plannedDir(other, settings)
      if (samePath(otherDir, dir)) held.add(other.outputStem.toLowerCase())
    }
    if (other.filepath && samePath(dirname(other.filepath), dir)) {
      finished.add(basename(other.filepath).toLowerCase())
    }
  }
  /*
    An entry that ran before this naming existed has no stem on record, and
    whatever partial it left is named after the bare title. Keeping that name is
    what lets an upgrade resume it; `log` is how to tell it from a new entry,
    which has never produced any output.
  */
  const ranBefore = !item.outputStem && item.log != null
  const legacy = ranBefore && partialsFor(names, base).length ? base : undefined
  const stem = pickOutputStem({
    // No language here: the file is found by this exact name, and a number keeps two languages apart.
    wanted: base + sectionSuffix(item.range),
    current: item.outputStem,
    legacy,
    held,
    finished,
    names
  })
  if (stem !== item.outputStem) {
    item.outputStem = stem
    scheduleSave()
  }
  return stem
}

/**
 * The engine's `-o` for a download, and the stem its file is looked for under
 * when the app chose the name itself. Pure, so naming is testable without
 * spawning anything: a playlist entry's number, a trim's section and a
 * collision's ` (2)` all land here, on the stem as well as the path.
 */
export function outputTarget(
  item: DownloadItem,
  settings: AppSettings,
  dir: string
): { path: string; stem?: string } {
  const base = chosenStem(item)
  if (base) {
    const stem = item.outputStem ?? base + sectionSuffix(item.range)
    return { path: join(dir, `${stem}.%(ext)s`), stem }
  }
  const template = numberedName(templateFor(settings.filenameTemplate || '%(title)s [%(id)s].%(ext)s', item), item.playlist)
  const suffix = variantSuffix(item) + (item.copySuffix ?? '')
  const name = withNameSuffix(template, suffix)
  // The engine's switch only reaches the fields; the spaces in the template itself are ours.
  return { path: join(dir, settings.restrictFilenames ? name.replace(/ (?![^(]*\))/g, '_') : name) }
}

/** An audio download into a container with no place for cover art. */
function audioHasNoCover(item: DownloadItem, settings: AppSettings): boolean {
  return item.mode === 'audio' && settings.audioFormat === 'wav'
}

/**
 * What to ask the engine for, for a format picked in Settings.
 *
 * Its `aac` is a trap, checked on the real engine and ffmpeg: it writes bare ADTS
 * audio and names the file `.m4a`, which is not what that name promises and which
 * a good many players refuse. `--embed-metadata` happened to rewrap it properly
 * when on; a cover on the bare file failed the whole download. Its `m4a` is the
 * same sound, in the container the name says, so that is what "AAC" gets.
 */
export function engineAudioFormat(format: string): string {
  return format === 'aac' ? 'm4a' : format
}

/**
 * The engine's command line for one download. Pure: the caller works out the
 * folder and the ffmpeg location, which touch the disk, so this can be tested.
 */
export function buildArgs(
  item: DownloadItem,
  settings: AppSettings,
  dir: string,
  ffmpeg?: string,
  /** The detect's JSON for this link, read instead of extracting it again. */
  infoJson?: string
): string[] {
  const args: string[] = [
    '--ignore-config',
    /*
      UTF-8 on its pipes. Left to itself yt-dlp.exe writes them in the console's
      ANSI code page, and the destination path is parsed out of those lines - so
      a Cyrillic title, a Downloads folder under a Cyrillic profile name, and even
      an English title with a colon in it (saved with a fullwidth `：` that cp1251
      cannot spell) all came back as a path that does not exist. The file was
      fine; Open, Show in folder and the notification click did nothing, and a
      cancel could not find the partials to clean up.
    */
    '--encoding',
    'utf-8',
    '--no-playlist',
    '--newline',
    '--no-color',
    '--continue',
    // Be resilient to flaky hosts and speed up fragmented (HLS/DASH) downloads.
    '--retries',
    '10',
    '--fragment-retries',
    '15',
    '--concurrent-fragments',
    '5',
    '--socket-timeout',
    '30'
  ]

  if (ffmpeg) args.push('--ffmpeg-location', ffmpeg)
  /*
    Only for an item whose playlist the engine's own HLS downloader has already
    refused (see refusesMidStreamInit). It stays the default otherwise: it
    fetches five fragments at a time and reports bytes, and ffmpeg does neither.
  */
  if (item.hlsViaFfmpeg) args.push('--downloader', 'm3u8:ffmpeg')
  /*
    A recording ends by being stopped, so its partial has to be worth having at
    any moment. An mp4 being written by ffmpeg has no index until it closes, and
    a forced kill left 48 bytes that nothing could read; a transport stream is
    readable wherever it is cut. The engine only does this for streams it knows
    are live, and the two do not always agree.
  */
  /*
    Saying so outright also tells the engine not to turn the file back into an mp4
    at the end, which it does only for a stream it knows is live and nobody asked
    about. Checked on the real engine: a finished HLS download then stays a
    transport stream named .mp4, which many players refuse, and a broadcast that
    ended by itself or a premiere fetched after it aired is exactly that. Run the
    fix-up by hand; it looks at the file and leaves anything else alone.
  */
  if (item.live) args.push('--hls-use-mpegts', '--use-postprocessor', 'FFmpegFixupM3u8')
  args.push(...accessArgs(settings, browserCookiesFile()))
  args.push(...headerArgs(item.headers))
  if (item.referer) args.push('--referer', item.referer)
  if (settings.restrictFilenames) args.push('--restrict-filenames')
  if (settings.speedLimit.trim()) args.push('--limit-rate', settings.speedLimit.trim())
  if (item.waitForVideo) args.push('--wait-for-video', WAIT_FOR_VIDEO_RANGE)

  /*
    Output template. For custom-resolved streams we bake in the title we
    scraped, under the stem `settleOutputStem` made unique. Either way a
    trimmed download carries its section in the name - see naming.ts for what
    sharing one name used to cost.
  */
  args.push('-o', outputTarget(item, settings, dir).path)
  // The file and its tags say what the card said; see `isLoneEmbed`.
  if (isLoneEmbed(item.extractor)) args.push('--replace-in-metadata', 'title', ' \\(1\\)$', '')

  // Progress as machine-readable lines
  args.push(
    '--progress-template',
    `download:${PROGRESS_PREFIX}%(progress.status)s\t%(progress.downloaded_bytes)s\t%(progress.total_bytes)s\t%(progress.total_bytes_estimate)s\t%(progress.speed)s\t%(progress.eta)s\t%(progress.fragment_index)s\t%(progress.fragment_count)s`
  )
  /*
    And the second half of the job. Fetching the bytes is not the end of it: a
    trimmed download re-encodes so the cuts land on keyframes, a video+audio
    download merges the streams, an audio download extracts and converts. On a
    long video that phase can take as long as the download, and it reports no
    percentage — so without this the bar simply stopped and then jumped to done.

    This at least says *which* step is running and when, which is enough to hand
    the last tenth of the bar over to it and name what it is doing.
  */
  args.push(
    '--progress-template',
    `postprocess:${POSTPROCESS_PREFIX}%(progress.status)s\t%(progress.postprocessor)s`
  )

  if (item.mode === 'audio') {
    args.push('-f', qualityFormat('audio', item.audioLanguage), '-x', '--audio-format', engineAudioFormat(settings.audioFormat), '--audio-quality', '0')
  } else {
    if (item.formatId && item.formatId !== 'auto') {
      const inLanguage = item.audioLanguage ? `${item.formatId}+ba[language=${item.audioLanguage}]/` : ''
      args.push('-f', `${inLanguage}${item.formatId}+bestaudio/${item.formatId}/best`)
    } else {
      args.push('-f', qualityFormat(item.quality, item.audioLanguage))
    }
    args.push('--merge-output-format', 'mp4')
    /*
      Prefer the codecs everything can play.

      YouTube and most large sites serve the same video twice: once as VP9 or
      AV1, once as H.264. The first is smaller for the same quality and is what
      the engine picks unprompted — and it is also what QuickTime, Windows
      Media Player and a great many televisions refuse to open. The file
      downloads perfectly and then will not play, which from the user's side is
      indistinguishable from a broken download.

      `res` comes first on purpose. yt-dlp's own mp4 preset sorts by codec
      before resolution, which would quietly cap a 4K download at 1080p,
      because above 1080p there usually is no H.264 to be had. Sorting by
      resolution first means the codec only decides between two formats of the
      same size: you keep every pixel the site offers and get the playable one
      wherever there is a choice.
    */
    if (settings.preferCompatible) args.push('-S', 'res,vcodec:h264,acodec:aac')
  }

  /*
    Unlike the thumbnail step below, this one is safe on every audio format, wav
    included: the engine only copies the streams into a new file, and a
    container with no room for a tag drops it. Checked against the real engine and
    both ffmpegs, with Cyrillic titles, long descriptions and chapters.
  */
  if (settings.embedMetadata) args.push('--embed-metadata')
  args.push(...playlistTagArgs(item.playlist, settings.embedMetadata))
  /*
    The engine's thumbnail step takes mp3, mkv, mka, ogg, opus, flac, m4a, mp4, m4v
    and mov, and raises an error on anything else - after the file is finished,
    so a good .wav read as a failed download. It has nowhere to put a picture,
    so the step is not asked for.
  */
  if (settings.embedThumbnail && !audioHasNoCover(item, settings)) args.push('--embed-thumbnail')
  if (settings.embedChapters && item.mode === 'video') args.push('--embed-chapters')
  /*
    Languages picked on the card outrank the Settings list, and work with those
    settings off, which is what they are for: nothing was fetched by default,
    however many tracks the card said there were. They go inside the file, unless
    Settings asks for files beside the video.
  */
  const picked = item.mode === 'video' && item.subtitles?.length ? item.subtitles : undefined
  const subLangs = picked?.join(',') ?? (settings.subtitleLanguages.trim() || 'all')
  /*
    Machine-made captions count as subtitles to a person: a video with nothing
    else came down with none, embedded, while the Settings row promised them.
    Never for "all", though. On YouTube that is every language it can translate
    to, which is a hundred and fifty requests, and it answers those with a 429.
  */
  const autoSubs = /(^|,)\s*all\s*(,|$)/i.test(subLangs) ? [] : ['--write-auto-subs']
  const embedSubs = item.mode === 'video' && (settings.embedSubtitles || Boolean(picked && !settings.writeSubtitles))
  /*
    A caption is a side dish, and the engine fetches it before the video: one
    429 on a track ended the whole run with nothing downloaded. Only this switch
    turns that into a warning. Checked against the real engine, a failed video
    or a failed merge still exits 1 with it, so the row still fails; what changes
    is that a post-processing failure loses its "Postprocessing:" opening, which
    `withPostprocessHeading` gives back.
  */
  if (embedSubs || settings.writeSubtitles) args.push('--ignore-errors')
  if (embedSubs) {
    /*
      `--embed-subs` switches on written subtitles by itself only when machine
      captions were not asked for. Asked for, a video with both came down with
      the machine's, and written tracks with no machine ones came down as nothing.
      Naming `--write-subs` also tells the engine the files are wanted beside the
      video, which `no-keep-subs` takes back unless Settings does want them.
    */
    const written = autoSubs.length
      ? ['--write-subs', ...autoSubs, ...(settings.writeSubtitles ? [] : ['--compat-options', 'no-keep-subs'])]
      : []
    args.push('--embed-subs', ...written, '--sub-langs', subLangs)
  }
  if (settings.writeSubtitles) {
    args.push('--write-subs', ...autoSubs, '--sub-langs', subLangs, '--convert-subs', 'srt')
  }
  if (settings.sponsorBlock && item.mode === 'video') {
    args.push('--sponsorblock-remove', 'sponsor,selfpromo,interaction')
  }

  // Fetch only the requested section. The engine asks the server for that byte
  // range, so clipping 30 seconds out of a two-hour stream costs 30 seconds of
  // bandwidth rather than the whole file.
  if (hasTrim(item.range)) {
    const start = item.range!.start ?? 0
    const end = item.range!.end
    args.push('--download-sections', `*${start}-${end ?? 'inf'}`)
    /*
      Forcing keyframes re-encodes the section so the cut lands exactly where
      the user asked. That is the right default — "remove the intro" that leaves
      two seconds of intro behind has not done the job — but it is also the
      slowest part of a trimmed download by a wide margin, and it used to be
      compulsory. A stream copy cuts on the nearest keyframe instead: near
      instant, at the price of a second or two of slack.
    */
    if (item.precise !== false) args.push('--force-keyframes-at-cuts')
  }

  /*
    Last, and behind `--`, so whatever sits in the URL slot can only ever be
    read as a URL. A value starting with `-` used to be taken as an option, and
    it can come from places the user never typed: a playlist entry copied out of
    the site's JSON, or the decoded payload of a `uvd-direct://` link.
  */
  /*
    Or the detect's own answer in place of the URL. The path is one this app
    wrote into its own folder, never anything from the item.
  */
  if (infoJson) args.push('--load-info-json', infoJson)
  else args.push('--', item.url)
  return args
}

const ALREADY_DOWNLOADED = /^\[download\]\s*(.+?) has already been downloaded\s*$/
const DESTINATION_PRIORITY = 2

/*
  Anchored, and only ever asked about the engine's standard output.

  What follows the engine's own words can be anyone's: `[generic] <name from the
  link>: Downloading webpage`, and an mp4's title tag echoed on standard error by
  the ffmpeg it runs. Unanchored, a link redirecting to a path spelling
  `[Merger] Merging formats into "C:\...\calc.exe"` named the row's file, above
  the true destination, and then Play opened it, Delete File trashed it and a
  watch uploaded and deleted it. Checked on the real engine: every line naming a
  finished file comes on standard output, ffmpeg-fetched downloads included.

  An anchor alone is not enough. The name is unquoted before it is printed, so a
  `%0A` in the link starts a line of its own that the engine really does print,
  which is why `finalPathCandidate` also wants the path inside this run's folder.
*/
const FINAL_PATH_RULES: { re: RegExp; priority: number }[] = [
  { re: /^\[Merger\] Merging formats into "(.+)"\s*$/, priority: 6 },
  { re: /^\[ExtractAudio\] Destination:\s*(.+?)\s*$/, priority: 6 },
  { re: /^\[SponsorBlock\].*?to "(.+)"\s*$/, priority: 5 },
  { re: ALREADY_DOWNLOADED, priority: 4 },
  { re: /^\[Metadata\] .*?to "(.+)"\s*$/, priority: 3 },
  { re: /^\[download\] Destination:\s*(.+?)\s*$/, priority: DESTINATION_PRIORITY }
]

/**
 * The file a line of engine output names as where the download ends up, and
 * how much to trust it: the merger's output outranks the first stream's
 * destination. Nothing outside `runDir` is ever the answer, and nothing here
 * touches the disk, so a path on someone's server is never so much as looked at.
 * Pure, so the queue and the command line read paths the same way.
 */
export function finalPathCandidate(
  line: string,
  runDir: string
): { path: string; priority: number; alreadyDownloaded: boolean } | null {
  for (const { re, priority } of FINAL_PATH_RULES) {
    const m = line.match(re)
    if (!m || !m[1]) continue
    const path = m[1].trim()
    if (!isInsideFolder(path, runDir)) return null
    return { path, priority, alreadyDownloaded: re === ALREADY_DOWNLOADED }
  }
  return null
}

/**
 * A title for a row that only had its link for a name, read off the file.
 *
 * A batch, Download Now and the terminal queue a link with nothing known about
 * it, and the address stayed the row's title for good: in the queue, in the
 * Library, in the notification. The engine's own title is what the file is named
 * after, so it can be had from there; the default template's ` [id]` and a
 * `.f137` stream number are the only parts of the name that are not the title.
 */
export function titleFromFile(path: string): string | undefined {
  const name = basename(path)
    .replace(/\.[^.]+$/, '')
    .replace(/\.f\d[\w-]*$/, '')
    .replace(/ \(\d+\)$/, '')
    .replace(/ \(audio\)$/, '')
    // A video alone on its page; with nothing detected, its name is all there is to go on.
    .replace(/ \(1\)( \[[^\]]*-1\])$/, '$1')
  return name.replace(/(^| )\[[^\]]+\]$/, '').trim() || undefined
}

function parseFinalPath(line: string, item: DownloadItem, runDir: string): void {
  const found = finalPathCandidate(line, runDir)
  if (!found) return
  // With restricted names the file holds what is left of the title, which for Cyrillic can be nothing.
  if (/^https?:\/\//i.test(item.title ?? '') && isMediaName(found.path) && !getSettings().restrictFilenames) {
    const title = titleFromFile(found.path)
    if (title) {
      item.title = title
      emitUpdated(item)
    }
  }
  const current = finalPaths.get(item.id)
  // A subtitle file never takes over from a video, whichever order they are announced in.
  const outranked = current && isMediaName(current.path) && !isMediaName(found.path)
  if (!current || (found.priority >= current.priority && !outranked)) {
    finalPaths.set(item.id, { path: found.path, priority: found.priority })
  }
  if (found.alreadyDownloaded) alreadyOnDisk.set(item.id, found.path)
  if (item.live && found.priority === DESTINATION_PRIORITY && isMediaName(found.path)) {
    // Subtitles announce a destination too, and are nothing to save a recording from.
    const known = item.partialPaths ?? []
    if (!known.includes(found.path)) {
      item.partialPaths = [...known, found.path]
      scheduleSave()
    }
  }
}

/**
 * Which of a folder's files is the download we named `stem`.
 *
 * Exactly `<stem>.<media extension>`, newest first. The engine writes more than
 * the video beside it - `Title.ru.srt`, `Title.webp`, a `Title.f137.mp4` it is
 * about to merge, a `Title.mp4.part` - and the alphabetical last of those was
 * what this used to pick, so a download with subtitles switched on "opened" as
 * a subtitle file. Newest, because an earlier attempt in another container can
 * still be lying in the same folder.
 */
export function pickFinishedFile(
  files: { name: string; mtimeMs: number }[],
  stem: string
): string | undefined {
  const prefix = stem + '.'
  const ours = (name: string): boolean =>
    name.startsWith(prefix) && !name.slice(prefix.length).includes('.') && isMediaName(name)
  return files.filter((file) => ours(file.name)).sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.name
}

/**
 * Find the finished file by the name we asked for, when the engine's own
 * report of it came back unreadable. See `expectedNames`.
 */
function findByExpectedName(id: string): string | undefined {
  const expected = expectedNames.get(id)
  if (!expected) return undefined
  try {
    // Only the candidates get a stat: a Downloads folder can hold thousands of files.
    const candidates = readdirSync(expected.dir).filter((name) => name.startsWith(expected.stem + '.'))
    const files = candidates.flatMap((name) => {
      try {
        return [{ name, mtimeMs: statSync(join(expected.dir, name)).mtimeMs }]
      } catch {
        return []
      }
    })
    const match = pickFinishedFile(files, expected.stem)
    return match ? join(expected.dir, match) : undefined
  } catch {
    return undefined
  }
}

function appendLog(item: DownloadItem, text: string): void {
  item.log = ((item.log || '') + text).slice(-LOG_TAIL_CHARS)
}

/** The wait is over: something came down. The row has been saying it was waiting until now. */
function endWait(item: DownloadItem): void {
  if (items.get(item.id)?.state !== 'waiting') return
  item.state = 'downloading'
  emitUpdated(item)
}

function handleProgressLine(line: string, item: DownloadItem): void {
  endWait(item)
  /*
    Is this job still running?

    Every other output handler asks first — the post-processing one, the ffmpeg
    one, and the media-job callback, which spells out why: killing a process is
    a signal, not an instant stop, and on Windows `killTree` shells out to
    `taskkill`, which has not even started by the time pause returns. The engine
    keeps printing, and whatever was already in the pipe arrives regardless.

    This handler was the exception, and it *assigns* the state rather than
    merely reading it — so one late line flipped a job the user had just paused
    back to `downloading`. The close handler then saw a state it didn't
    recognise as deliberate, took the exit code as a failure, and reported an
    error; if the tail happened to mention a reset connection, the retry rule
    matched and the app started the download the user had just cancelled.

    Reading through the map rather than the reference also covers the item
    having been removed outright while its process was still dying.
  */
  if (items.get(item.id)?.state !== 'downloading') return

  const payload = line.slice(PROGRESS_PREFIX.length)
  const [status, downloaded, total, totalEst, speed, eta, fragIndex, fragCount] = payload.split('\t')
  /*
    The engine reports a file it found on disk as one it just fetched. Believed,
    that started the phase, so the step that files it away put "Processing 90%"
    on a row about to start over as a copy, for long enough to press Cancel at.
    Anything really fetched after this still counts: it is only the first word.
  */
  if (status === 'finished' && !item.phase && alreadyOnDisk.has(item.id)) return
  const totalBytes = num(total) ?? num(totalEst)
  const downloadedBytes = num(downloaded)
  const fragmentIndex = num(fragIndex)
  const fragmentCount = num(fragCount)
  /*
    Undefined, not the item's current figure. That figure is a position on the
    whole bar, not a percentage of this phase — seeding with it told
    `overallProgress` a number was known when none was, and the streams this
    matters for (no Content-Length, no fragment count) then rendered a
    confident, frozen percentage instead of the moving band that says "working,
    size unknown".
  */
  let percent: number | undefined
  if (downloadedBytes != null && totalBytes) {
    percent = Math.min(100, (downloadedBytes / totalBytes) * 100)
  } else if (fragmentIndex != null && fragmentCount) {
    // Fragmented streams often report no byte totals — fragments are the next best.
    percent = Math.min(100, (fragmentIndex / fragmentCount) * 100)
  }

  if (status === 'finished') {
    /*
      One *file* is done — not the job. A default video download fetches the
      video and audio streams separately, so this arrives once per stream. It
      is not the hand-over to post-processing, and treating it as one flipped
      the phase (and burned the whole download share) while a second stream had
      not even started. The hand-over is a real post-processing event.

      All this says is that we no longer know how far along we are, so the bar
      holds its place and shows motion until the next line tells us more.
    */
    applyProgress(item, { phase: 'download' })
    item.speed = undefined
    item.eta = undefined
  } else {
    item.state = 'downloading'
    applyProgress(item, { phase: 'download', phasePercent: percent })
    item.speed = num(speed)
    item.eta = num(eta)
  }
  item.downloadedBytes = downloadedBytes
  item.totalBytes = totalBytes

  emitProgress({
    id: item.id,
    state: item.state,
    percent: item.percent,
    phase: item.phase,
    postprocess: item.postprocess,
    indeterminate: item.indeterminate,
    speed: item.speed,
    eta: item.eta,
    downloadedBytes,
    totalBytes,
    fragmentIndex,
    fragmentCount
  })
}

/**
 * How many seconds of video this job will end up with, when that is knowable.
 *
 * A trimmed download produces exactly the requested span; an untrimmed one
 * produces the whole source. Either way it is what turns ffmpeg's output
 * timestamp into a percentage.
 */
function expectedSeconds(item: DownloadItem): number | undefined {
  if (hasTrim(item.range)) return rangeDuration(item.range!, item.duration)
  return item.duration
}

/**
 * ffmpeg said how far it has got. Treat it exactly like an engine progress
 * line: it is the same phase, measured a different way.
 *
 * Reaching this at all means yt-dlp handed the fetch to ffmpeg — trimmed
 * sections and most live/HLS captures — in which case no `download:` template
 * line will ever arrive and this is the only thing that can move the bar.
 */
function handleFfmpegProgress(seconds: number, item: DownloadItem, line: string): void {
  endWait(item)
  if (item.state !== 'downloading') return
  /*
    Only the fetching half. The engine captures its post-processors' output
    rather than letting it through, so in practice nothing gets here during a
    merge — but if that ever changed, treating those lines as download progress
    would drag the bar back from the post-processing band and relabel a merge in
    progress as a download.
  */
  if (item.phase === 'postprocess') return
  const total = expectedSeconds(item)
  const percent = total && total > 0 ? Math.min(100, (seconds / total) * 100) : undefined
  applyProgress(item, { phase: 'download', phasePercent: percent })
  // Each only when this line could tell, so `size=N/A` does not blank what the last one said.
  const transfer = ffmpegTransfer(line, total)
  if (transfer.speed != null) item.speed = transfer.speed
  if (transfer.eta != null) item.eta = transfer.eta
  if (transfer.downloadedBytes != null) item.downloadedBytes = transfer.downloadedBytes
  if (transfer.totalBytes != null) item.totalBytes = transfer.totalBytes

  emitProgress({
    id: item.id,
    state: item.state,
    percent: item.percent,
    phase: item.phase,
    postprocess: item.postprocess,
    indeterminate: item.indeterminate,
    speed: item.speed,
    eta: item.eta,
    downloadedBytes: item.downloadedBytes,
    totalBytes: item.totalBytes
  })
}

/** The bar is full and no phase is running. */
function finishProgress(item: DownloadItem): void {
  resumedFigure.delete(item.id)
  item.percent = 100
  item.phase = undefined
  item.postprocess = undefined
  item.indeterminate = undefined
}

/**
 * The job stopped where it was. Keep the figure — a paused item at 40% is still
 * 40% fetched — but drop everything that describes work in progress, or the row
 * goes on animating and naming a step that is not running.
 */
function clearPhase(item: DownloadItem): void {
  item.phase = undefined
  item.postprocess = undefined
  item.indeterminate = undefined
  item.speed = undefined
  item.eta = undefined
}

/** Back to the start line: a retry, a resume, or a fresh attempt. */
function resetProgress(item: DownloadItem): void {
  forgetProgress(item.id)
  item.percent = 0
  item.phase = undefined
  item.postprocess = undefined
  item.indeterminate = undefined
}

/** Move an item's bar, keeping phase, figure and indeterminacy in step. */
function applyProgress(
  item: DownloadItem,
  input: { phase: 'download' | 'postprocess'; phasePercent?: number }
): void {
  // The new run's first real figure replaces the last run's: see `resumedFigure`.
  const replaces = input.phasePercent != null && resumedFigure.delete(item.id)
  const view = overallProgress({ ...input, previous: replaces ? 0 : item.percent })
  item.phase = input.phase
  item.percent = view.percent
  item.indeterminate = view.indeterminate
}

/**
 * A post-processing step started or finished.
 *
 * yt-dlp gives no percentage for these, only which one is running — so the last
 * tenth of the bar carries motion and the step's name rather than a number the
 * app would have to invent.
 */
function handlePostprocessLine(line: string, item: DownloadItem): void {
  const [status, name] = line.slice(POSTPROCESS_PREFIX.length).split('\t')
  if (item.state !== 'downloading' && item.state !== 'processing') return
  /*
    Not every post-processor runs after the download. SponsorBlock's lookup is
    registered `after_filter`, which yt-dlp runs *before* fetching anything — and
    honouring that would floor the bar at the hand-over point before a single
    byte had arrived. `phase` is only set once a download line has been seen, so
    it doubles as "the download has actually started".
  */
  if (!acceptsPostprocess(item.phase)) return

  item.state = 'processing'
  // `finished` is one step done, not the job — the process closing says that.
  item.postprocess = status === 'finished' ? undefined : (postprocessorLabel(name) ?? undefined)
  applyProgress(item, { phase: 'postprocess' })
  item.speed = undefined
  item.eta = undefined

  emitProgress({
    id: item.id,
    state: item.state,
    percent: item.percent,
    phase: item.phase,
    postprocess: item.postprocess,
    indeterminate: item.indeterminate
  })
}

/**
 * What is using a slot. Not a row waiting for a premiere: that can be days of an
 * idle process, and "three at once" should not become two for all of them. When
 * it starts it runs at once, over the limit if need be, because a stream that
 * has begun will not wait for a slot.
 */
function activeCount(): number {
  let n = 0
  for (const item of items.values()) {
    if (item.state === 'downloading' || item.state === 'processing' || item.state === 'detecting') n++
  }
  return n
}

function pump(): void {
  const settings = getSettings()
  const limit = Math.max(1, settings.concurrentDownloads || 1)
  if (activeCount() >= limit) return

  // Ordering lives in `schedule.ts` so it can be tested; what belongs here is
  // the part a test cannot construct — which ids own a process or a retry timer.
  const pending = pendingOrder([...items.values()]).filter(
    (item) => !procs.has(item.id) && !retryTimers.has(item.id)
  )

  for (const item of pending) {
    if (activeCount() >= limit) break
    if (item.kind && item.kind !== 'download') void runMediaJob(item)
    /*
      Against the live list, not the snapshot: `runDownload` marks its item
      'detecting' before its first await, so a namesake started earlier in this
      same loop already counts. A held item stays queued, and whatever ends the
      namesake's run pumps the queue again.
    */
    else if (!waitsForNamesake(item, [...items.values()])) void runDownload(item)
  }
}

let pumping = false
let pumpAgain = false

/**
 * Start whatever the queue can start, without ever running twice at once.
 *
 * `runMediaJob` can fail before its first await — a source file that has been
 * moved or unplugged since it was queued — and failing an item ends in another
 * `processQueue()`. That call used to run immediately, from inside the loop
 * below, start the remaining items, and hand control back to a loop still
 * walking a now-stale list. The outer iteration then started an item the nested
 * call had already started: two ffmpeg processes writing one output path, with
 * only the second registered in `procs`, so cancelling or quitting killed one
 * of them and left the other running.
 *
 * Nested calls set a flag instead, and the loop repeats with a fresh snapshot.
 */
function processQueue(): void {
  if (pumping) {
    pumpAgain = true
    return
  }
  pumping = true
  try {
    do {
      pumpAgain = false
      pump()
    } while (pumpAgain)
  } finally {
    pumping = false
  }
}

/**
 * Trim or convert a file that's already on disk. These run through the same
 * queue as downloads so pause/cancel/remove, progress and history all behave
 * identically — from the user's side it's one list of things in flight.
 */
async function runMediaJob(item: DownloadItem): Promise<void> {
  const source = item.sourcePath
  if (!source || !existsSync(source)) {
    failWith(item, 'sourceMissing', 'The source file is gone — it may have been moved or deleted.')
    return
  }

  /*
    `processing`, not `downloading`. Nothing is being fetched: the file is
    already on disk and ffmpeg is reworking it. The row used to say
    "downloading" over a local trim, which is simply not what is happening —
    and the state is what the queue's filters, the taskbar progress and the
    keep-awake decision all read.
  */
  item.state = 'processing'
  item.indeterminate = false
  item.error = undefined
  item.errorCode = undefined
  emitUpdated(item)
  log.info('download', 'Started', downloadFields(item))

  const probe = await probeMedia(source)
  /*
    Probing spawns ffmpeg and waits for it, and the item is reachable the whole
    time — the row is on screen showing "processing" with a working cancel
    button. Cancel finds no process to kill, because none has been spawned yet,
    so it just marks the item and returns; this function then carried on and
    started the encode anyway. Cancel followed by retry was worse: retry queues
    the item again, the queue calls this function a second time while the first
    call is still inside the probe, and both go on to spawn an ffmpeg writing
    the same output path. The second registration overwrites the first in
    `procs`, so one of them is left running untracked and unkillable.
  */
  const stateAfterProbe = items.get(item.id)?.state
  if (stateAfterProbe !== 'processing') {
    processQueue()
    return
  }

  // Catch the impossible ask up front rather than letting ffmpeg fail obscurely.
  if (item.kind === 'convert' && item.convertTarget?.mode === 'audio' && !probe.hasAudio) {
    failWith(
      item,
      'noAudioTrack',
      'This file has no audio track, so it can’t be converted to an audio format.'
    )
    return
  }

  // Trims render only the selected span; conversions render the whole file.
  const totalSeconds =
    item.kind === 'trim' ? rangeDuration(item.range ?? {}, probe.duration) : probe.duration

  let args: string[]
  try {
    args =
      item.kind === 'trim'
        ? buildTrimArgs(source, item.filepath!, item.range ?? {}, item.precise ?? true, probe.hasVideo)
        : buildConvertArgs(source, item.filepath!, item.convertTarget!, probe)
  } catch (err) {
    fail(item, err instanceof Error ? err.message : String(err))
    return
  }

  let run: ReturnType<typeof runFfmpeg>
  try {
    run = runFfmpeg(args, {
      totalSeconds,
      onProgress: (percent) => {
        /*
          ffmpeg keeps reporting for a moment after a cancel or a pause — the
          kill is a signal, not an instant stop. Writing progress unconditionally
          brought the row back to life as a running download after the user had
          already stopped it.
        */
        const live = items.get(item.id)?.state
        if (live !== 'downloading' && live !== 'processing') return
        if (percent < 0) return
        item.percent = percent
        // A job with no known duration can't report a figure; say so rather
        // than pinning the bar at a zero that never moves.
        item.indeterminate = !totalSeconds
        emitProgress({
          id: item.id,
          state: live,
          percent: item.percent,
          indeterminate: item.indeterminate
        })
      }
    })
  } catch (err) {
    /*
      A missing binary is not a post-processing failure, and the generic
      classifier called it one because its message contains the word "ffmpeg".
      It is the one error here the app diagnosed itself, so it keeps its own
      name — and its own translation.
    */
    if (err instanceof FfmpegMissingError) {
      failWith(item, err.code, err.message)
      return
    }
    fail(item, err instanceof Error ? err.message : String(err))
    return
  }

  procs.set(item.id, run.child)
  const { code, stderr } = await run.done
  procs.delete(item.id)

  /*
    Re-read the state: pause, cancel and remove all act while ffmpeg runs. A
    removed job has no state at all, and used to fall through to the exit-code
    check - a convert removed mid-run was marked completed, or failed, on an
    item that no longer existed, with its half-written output left behind.
  */
  const stoppedOnPurpose = deliberateStops.delete(item.id)
  const stateAfterRun = items.get(item.id)?.state
  if (stoppedOnPurpose || stateAfterRun !== 'processing') {
    // Half-written output is useless; don't leave it lying around.
    try {
      if (item.filepath && existsSync(item.filepath)) rmSync(item.filepath, { force: true })
    } catch {
      /* best effort */
    }
    if (items.has(item.id)) emitUpdated(item)
    processQueue()
    return
  }

  if (code === 0) {
    item.state = 'completed'
    finishProgress(item)
    item.finishedAt = Date.now()
    // No engine reported these, so the row and the Library had no size or length for a clip at all.
    try {
      if (item.filepath) item.downloadedBytes = item.totalBytes = statSync(item.filepath).size
    } catch {
      // Already moved or deleted; there is no size to give.
    }
    if (totalSeconds) item.duration = totalSeconds
    log.info('download', 'Finished', downloadFields(item))
    emitUpdated(item)
    processQueue()
    return
  }
  appendLog(item, stderr)
  log.debug('engine', stderr, { id: item.id.slice(0, 8) })
  // ffmpeg failures are never the flaky-network kind, so skip the retry path
  // and give the user a plain explanation straight away.
  const failure = classifyFfmpegError(stderr || `ffmpeg exited with code ${code}`)
  item.speed = undefined
  item.eta = undefined
  failWith(item, failure.code ?? 'postprocess', failure.message)
}

async function runDownload(item: DownloadItem): Promise<void> {
  // Re-resolve the original URL on every (re)start: streaming-site CDN links
  // are short-lived, and resolve errors (e.g. premium-only translations) land
  // on the card as a normal failure the user can see and retry.
  item.state = 'detecting'
  item.error = undefined
  item.errorCode = undefined
  item.cookieHint = undefined
  emitUpdated(item)
  const abort = new AbortController()
  resolveAborts.set(item.id, abort)
  /*
    Whether this run has been superseded. Pause, cancel, retry and remove all
    abort the controller, and the resolve can take seconds to notice. Pause
    then resume inside that window started a second run, which marked the
    item 'detecting' again - so the first run's abort, landing late, read as
    a real failure and failed the second run, and its `finally` deleted the
    second run's controller, leaving nothing for the next pause to stop. A
    resolve that ignored the signal and succeeded late went on to start a
    second engine beside the first. The controller is this run's identity:
    once it is aborted, nothing the run learns is acted on.
  */
  const stale = (): boolean => abort.signal.aborted
  try {
    /*
      `universalFallback` was read when the link was first detected and then
      forgotten. Re-resolution happens on every start and every retry, and it
      defaulted to allowing the headless browser — so turning the setting off
      stopped the browser being used to find a video, but not to fetch it again
      afterwards.
    */
    const resolved = await resolveUrl(item.sourceUrl || item.url, {
      allowBrowser: getSettings().universalFallback,
      signal: abort.signal
    })
    // A superseded run must not write over what the current one resolved.
    if (stale()) {
      processQueue()
      return
    }
    /*
      A page that resolves to a picker - a series player, a listing - has no
      one stream to fetch. Handed to the engine as it is, it failed with the
      engine's own "unsupported URL"; the choice belongs on Home, so say so.
    */
    if (resolved.streaming || resolved.isPlaylist) {
      failWith(
        item,
        'needsPicker',
        'This page has several streams to choose from. Open it on the download screen and pick one.'
      )
      return
    }
    item.url = resolved.url
    item.referer = resolved.referer
    item.headers = resolved.headers
    if (resolved.extractor) item.extractor = resolved.extractor
    if (resolved.title && (!item.title || item.title === item.sourceUrl)) item.title = resolved.title
    if (!item.thumbnail && resolved.thumbnail) item.thumbnail = resolved.thumbnail
    // The length is what turns ffmpeg's output timestamp into a percentage on
    // the trimmed and live paths, where the engine reports nothing else.
    if (!item.duration && resolved.duration) item.duration = resolved.duration
  } catch (err) {
    /*
      An abort arrives here as a rejection. Pause and cancel abort the resolve,
      and for a `uvd-sniff://` item that means the sniffer returns nothing and
      `resolveSniffUrl` throws "Could not find a video stream on this page any
      more" — which `fail()` then wrote over the paused or cancelled state the
      user had just asked for, with a "Download failed" notification to match.
      Worse for a pause: the item was no longer 'paused', so nothing would ever
      resume it again.
    */
    if (stale() || items.get(item.id)?.state !== 'detecting') {
      processQueue()
      return
    }
    fail(item, err instanceof Error ? err.message : String(err))
    return
  } finally {
    // Only our own: a resumed run may already have put its controller here.
    if (resolveAborts.get(item.id) === abort) resolveAborts.delete(item.id)
  }
  // Paused/canceled/removed while we were resolving — don't start the engine.
  if (stale() || !items.has(item.id) || item.state !== 'detecting') {
    processQueue()
    return
  }

  item.state = item.waitForVideo ? 'waiting' : 'downloading'
  emitUpdated(item)
  /*
    It just gave its slot back, and nothing else was going to say so: a row that
    waits ends no download, so whatever was queued behind it stayed queued. After
    a restart that was everything, for as long as the premiere took.
  */
  if (item.waitForVideo) processQueue()
  const retried = item.attempts || 0
  log.info('download', 'Started', { ...downloadFields(item), attempt: retried ? retried + 1 : undefined })

  /*
    Everything up to a running process, under one catch.

    `spawn` throws synchronously for an argument it will not pass on - a NUL in
    a scraped title or URL - and so do the engine paths when the folder they
    create cannot be made. This function is started fire-and-forget, so the
    throw became an unhandled rejection after the row had already been set to
    'downloading': it stayed that way with no process behind it, held one of
    the concurrent slots until restart, and stuck again on every relaunch. None
    of these errors is transient, so `fail()` settles it at once and frees the
    slot.
  */
  let child: ChildProcessWithoutNullStreams
  let infoFile: string | null = null
  let dir: string
  try {
    const settings = getSettings()
    dir = outputDirFor(item, settings)
    if (item.live) setAsideRecording(item)
    const stem = settleOutputStem(item, dir, settings)
    expectedNames.delete(item.id)
    alreadyOnDisk.delete(item.id)
    if (stem) expectedNames.set(item.id, { dir, stem })
    /*
      The detect's JSON, when this is the link it described and nothing has
      changed it since: no resolver rewrote it (that brings headers the JSON
      does not carry), and the cache is keyed by the access settings too.
      Taken, not peeked: a retry, a resume or the second download of a link
      extracts afresh.
    */
    const source = item.sourceUrl || item.url
    const skip = skipInfo.delete(item.id)
    infoFile =
      // Not for a wait: what the detect knew is that there is nothing to fetch yet.
      !skip && !item.waitForVideo && item.url === source && !item.headers && !item.referer
        ? infoCache.take(infoKey(source, settings))
        : null
    const args = buildArgs(item, settings, dir, ffmpegLocation(), infoFile ?? undefined)
    child = spawn(ytdlpBinaryPath(), args, ytdlpSpawnOptions())
  } catch (err) {
    if (infoFile) infoCache.release(infoFile)
    expectedNames.delete(item.id)
    fail(item, err instanceof Error ? err.message : String(err))
    return
  }
  procs.set(item.id, child)

  let stderrTail = ''
  const shortId = item.id.slice(0, 8)
  // This run's answer: a retry may well get the track the last one was refused.
  item.subtitlesMissed = undefined

  /*
    The engine's own words go to the log only when "detailed log" is on. They
    are the most useful thing in a bug report and also the least tidy: full
    media addresses, the destination path. The sink redacts what it can
    recognise; the debug level keeps the rest out of an ordinary run.
  */
  const onOutputLine = (line: string): void => {
    if (line.startsWith(POSTPROCESS_PREFIX) || /\] Interrupted by user/.test(line)) heardLiveStop(item.id)
    if (line.startsWith(PROGRESS_PREFIX)) {
      handleProgressLine(line, item)
    } else if (line.startsWith(POSTPROCESS_PREFIX)) {
      handlePostprocessLine(line, item)
    } else if (line.trim()) {
      parseFinalPath(line, item, dir)
      appendLog(item, line + '\n')
      log.debug('engine', line, { id: shortId })
    }
  }

  const onErrorLine = (line: string): void => {
    if (!line.trim()) return
    const seconds = ffmpegProgressSeconds(line)
    if (seconds != null) {
      handleFfmpegProgress(seconds, item, line)
      return
    }
    if (isFfmpegNoise(line)) return
    const missed = subtitleMissIn(line)
    if (missed && !item.subtitlesMissed?.includes(missed)) {
      item.subtitlesMissed = [...(item.subtitlesMissed ?? []), missed]
    }
    stderrTail = (stderrTail + line + '\n').slice(-4000)
    appendLog(item, line + '\n')
    log.debug('engine', line, { id: shortId })
  }

  // Both pipes go through `lineReader`, which keeps torn lines and torn
  // characters together across chunk boundaries.
  const stdout = lineReader((text) => text.split(/\r?\n/), onOutputLine)
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
  /*
    Split on carriage returns as well as newlines.

    ffmpeg — which the engine spawns for trimmed sections and most live
    captures, with its console inherited — overwrites a single status line
    rather than printing new ones, so its whole output arrives as one
    `\r`-separated run that a newline split never breaks apart.
  */
  const stderr = lineReader(splitOutputLines, onErrorLine)
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))

  /*
    Node emits `close` after `error` for a spawn that never started, so without
    this both handlers ran: `fail` incremented the attempt counter twice,
    burning both automatic retries on one failure, and the row was written
    twice with two different messages.
  */
  let settled = false

  child.on('error', (err) => {
    if (settled) return
    settled = true
    procs.delete(item.id)
    if (infoFile) infoCache.release(infoFile)
    fail(item, err.message)
  })

  child.on('close', (code) => {
    if (settled) return
    settled = true
    procs.delete(item.id)
    /*
      Whatever is still in either buffer, before anything reads what they said.

      The last thing an engine writes before it exits has no separator after it
      to push it out of the buffer — and it is very often the line that matters
      most: the reason a run failed, or the path a successful one wrote to,
      which the completion branch below is about to look up.
    */
    stdout.flush()
    stderr.flush()
    // Read or not, the file has had its one use.
    if (infoFile) infoCache.release(infoFile)
    const existing = alreadyOnDisk.get(item.id)
    alreadyOnDisk.delete(item.id)
    // If we deliberately stopped it, the state was already set — or has since
    // been changed again by a resume, which is equally not a failure.
    const stoppedOnPurpose = deliberateStops.delete(item.id)
    if (stoppedOnPurpose || item.state === 'paused' || item.state === 'canceled') {
      emitUpdated(item)
      processQueue()
      return
    }
    // Whatever the exit code says: stopping is how a recording ends, and a forced one exits 1.
    if (liveStops.has(item.id)) {
      heardLiveStop(item.id)
      liveStops.delete(item.id)
      void saveRecording(item, code === 0)
      return
    }
    /*
      A recording is never the file already there, even one from this same link:
      the engine puts the minute in a live title, so stopping and recording again
      within it found the first file and "finished" on that without recording.
    */
    if (code === 0 && existing && (item.live || shouldTakeOwnName(item, existing, [...items.values()]))) {
      retryUnderOwnName(item, existing)
      return
    }
    if (code === 0 && refuseFinalFile(item, existing)) return
    if (code === 0) {
      item.state = 'completed'
      finishProgress(item)
      item.speed = undefined
      item.eta = undefined
      item.attempts = 0
      item.finishedAt = Date.now()
      const fp = finalPaths.get(item.id)
      if (fp) item.filepath = fp.path
      if (!item.filepath || !existsSync(item.filepath)) {
        const recovered = findByExpectedName(item.id)
        if (recovered) item.filepath = recovered
      }
      /*
        The figures so far were the engine's estimate, for a job made of
        fragments, and it stayed on the finished row: a Twitch VOD said 9.05 GB
        beside a file of 8.80 GB. The file is the answer now.
      */
      try {
        if (item.filepath) item.downloadedBytes = item.totalBytes = statSync(item.filepath).size
      } catch {
        // Already moved or deleted; the last estimate is all there is.
      }
      finalPaths.delete(item.id)
      expectedNames.delete(item.id)
      log.info('download', 'Finished', downloadFields(item))
      emitUpdated(item)
      processQueue()
      return
    }
    /*
      A run from the detect's JSON that failed the way stale JSON fails - its
      signed stream addresses expired, or the file would not load - gets one
      ordinary run, extracting afresh. Not an automatic retry: it spends none
      of the item's attempts, since the failure was this optimisation's, not
      the download's.
    */
    if (infoFile && isStaleInfoError(stderrTail)) {
      appendLog(item, 'The saved video details were out of date; asking the site again\n')
      /*
        What the failed run wrote goes first. The fresh extraction may pick
        other formats, and `--continue` would otherwise append to a part file
        fetched from an address that no longer exists.
      */
      cleanupPartials(item)
      skipInfo.add(item.id)
      item.state = 'queued'
      item.speed = undefined
      item.eta = undefined
      resetProgress(item)
      finalPaths.delete(item.id)
      emitUpdated(item)
      processQueue()
      return
    }
    /*
      A stream that restarted partway through - a Twitch VOD whose broadcast
      reconnected - which the engine's own HLS downloader will not join. One
      more run with ffmpeg fetching it, spending none of the item's attempts:
      nothing was wrong with the download, only with the downloader.
    */
    if (!item.hlsViaFfmpeg && refusesMidStreamInit(stderrTail)) {
      appendLog(item, 'The stream restarts partway through; fetching it with ffmpeg instead\n')
      log.info('download', 'Fetching the HLS stream with ffmpeg', downloadFields(item))
      cleanupPartials(item)
      item.hlsViaFfmpeg = true
      item.state = 'queued'
      item.speed = undefined
      item.eta = undefined
      resetProgress(item)
      finalPaths.delete(item.id)
      emitUpdated(item)
      processQueue()
      return
    }
    const tail = stderrTail || `yt-dlp exited with code ${code}`
    fail(item, item.state === 'processing' ? withPostprocessHeading(tail) : tail)
  })
}

/**
 * The site chose what the file is, and it is nothing a person downloads a video
 * for: an .svg, an .xml, an .m3u, a .swf. The engine saves those under whatever
 * extension the server says, and from there the row's Play would hand it to
 * whatever Windows opens that with. So the row fails before anything can open it,
 * and the file goes, unless it was already there before this run or is a subtitle
 * file, which is the user's.
 */
function refuseFinalFile(item: DownloadItem, existing: string | undefined): boolean {
  const final = finalPaths.get(item.id)?.path
  if (!final || isMediaName(final)) return false
  if (final !== existing && !isSidecarName(final)) {
    try {
      rmSync(final, { force: true })
    } catch (err) {
      log.warn('download', 'Could not remove a file that is not a video', failure(err))
    }
  }
  finalPaths.delete(item.id)
  expectedNames.delete(item.id)
  item.filepath = undefined
  item.speed = undefined
  item.eta = undefined
  failWith(item, 'notMedia', 'This link gave a file that is not a video or audio, so it was not kept.')
  return true
}

/**
 * The engine "finished" by pointing at a file another download made. Run again
 * under the same name with ` (2)` - or the first number nothing in that folder
 * has - on the end, which the template puts just before the extension.
 *
 * Not a failure and not an automatic retry: no attempt is spent, and the
 * suffix is kept on the item, so a pause or a resume after this goes on
 * writing the copy rather than finding the other file again.
 */
function retryUnderOwnName(item: DownloadItem, existing: string): void {
  let names: string[] = []
  try {
    names = readdirSync(dirname(existing))
  } catch {
    /* gone already: any number is free */
  }
  item.copySuffix = freeCopySuffix(partialStem(existing), names)
  appendLog(item, `${basename(existing)} belongs to another download; fetching this as its own copy\n`)
  item.state = 'queued'
  item.speed = undefined
  item.eta = undefined
  resetProgress(item)
  finalPaths.delete(item.id)
  expectedNames.delete(item.id)
  emitUpdated(item)
  processQueue()
}

/**
 * A wait that lost the network goes on waiting.
 *
 * The row promises to wait however long it takes, and a premiere can be days
 * away: two automatic retries a few seconds apart turned a router restart into a
 * failed row and a missed premiere. Attempts are for downloads. Nothing has come
 * down here, so nothing is spent, and the row keeps saying what it is doing. A
 * failure that is not the network's (a private video, a removed one) still fails.
 *
 * Started straight from the timer and not through the queue, like the stream it
 * is waiting for: `activeCount` does not count it, and a full queue must not make
 * it miss the start. The timer is an ordinary retry timer, so pause, cancel,
 * remove and shutdown all clear it.
 */
function keepWaiting(item: DownloadItem): void {
  item.state = 'waiting'
  appendLog(item, 'Could not reach the site; looking again in a minute\n')
  emitUpdated(item)
  log.info('download', 'Waiting; network failure', downloadFields(item))
  const timer = setTimeout(() => {
    retryTimers.delete(item.id)
    if (items.get(item.id) === item && item.state === 'waiting' && !procs.has(item.id)) void runDownload(item)
  }, WAIT_RETRY_MS)
  retryTimers.set(item.id, timer)
}

/** Mark a failure, retrying transient ones automatically with a short backoff. */
function fail(item: DownloadItem, rawError: string): void {
  // `detecting`: each look starts by resolving the link, and that can lose the network too.
  if (
    item.waitForVideo &&
    (item.state === 'waiting' || item.state === 'detecting') &&
    items.has(item.id) &&
    isTransientError(rawError)
  ) {
    keepWaiting(item)
    return
  }
  const attempts = (item.attempts || 0) + 1
  item.attempts = attempts
  if (attempts <= AUTO_RETRIES && isTransientError(rawError) && items.has(item.id)) {
    item.state = 'queued'
    item.error = undefined
    item.errorCode = undefined
    item.cookieHint = undefined
    // The retry re-downloads from the start, so the bar has to as well —
    // otherwise the never-backwards rule pins it wherever the failure left it.
    resetProgress(item)
    emitUpdated(item)
    log.info('download', 'Failed; retrying', { ...downloadFields(item), attempt: attempts })
    const timer = setTimeout(() => {
      retryTimers.delete(item.id)
      processQueue()
    }, attempts * 4000)
    retryTimers.set(item.id, timer)
    return
  }
  const { code, message, cookieHint } = classifyYtdlpError(rawError, hasCookies(getSettings(), browserCookiesFile()))
  /*
    The code, not the engine's text. `rawError` is the tail of its output, and
    that holds media addresses and file paths; with "detailed log" on, those
    lines are already in the file above this one, at the level that asked for
    them.
  */
  log.warn('download', 'Failed', { ...downloadFields(item), code, attempt: attempts })
  item.state = 'error'
  clearPhase(item)
  item.error = message
  item.errorCode = code
  item.cookieHint = cookieHint
  item.reportId = recordDownloadFailure(item, rawError)
  emitUpdated(item)
  processQueue()
}

/** A failure the app diagnosed itself, so it already knows what to call it. */
function failWith(item: DownloadItem, code: AppErrorCode, message: string): void {
  log.warn('download', 'Failed', { ...downloadFields(item), code })
  item.state = 'error'
  clearPhase(item)
  item.error = message
  item.errorCode = code
  item.cookieHint = false
  item.reportId = recordDownloadFailure(item, message)
  emitUpdated(item)
  processQueue()
}

/**
 * The queue entry this request would collide with, if any. The rule itself
 * lives in `dedupe.ts` so it can be tested without booting Electron.
 */
function findInFlight(req: DownloadRequest): DownloadItem | undefined {
  return [...items.values()].find((item) => isSameDownload(item, req))
}

export async function startDownload(request: DownloadRequest): Promise<DownloadItem> {
  /*
    Canonicalise before anything else looks at the URL. The duplicate check
    below compares strings, so the same video shared twice — once from the
    address bar, once from a share button that stapled `?si=…` on the end —
    used to queue twice and have the two runs fight over the same output file.
  */
  const req: DownloadRequest = { ...request, url: normalizeUrl(request.url) }
  // `--` in the engine's arguments already keeps this from being read as an
  // option; refusing it here keeps it out of the queue and history as well.
  if (!isAbsoluteUrl(req.url)) throw new Error('This is not a link the app can download.')
  const existing = findInFlight(req)
  /*
    Through `publicItem` like everything else that crosses the bridge. This
    return value is an IPC reply — `ipcMain.handle(IPC.downloadStart, …)` — and
    on the duplicate path it hands back the live queue entry, which by then
    carries the headers the resolve captured. Every other route to the renderer
    was stripped; this one was not, so queueing a URL a second time while the
    first was still running delivered the site's Cookie straight to the window.
  */
  if (existing) return publicItem(existing)

  const settings = getSettings()
  const id = randomUUID()
  // Queue immediately; URL resolution (scraping custom sites for the real
  // stream link) happens in runDownload when the item's turn comes.
  const item: DownloadItem = {
    id,
    url: req.url,
    sourceUrl: req.url,
    title: req.title || req.url,
    thumbnail: req.thumbnail,
    mode: req.mode,
    quality: req.quality,
    formatId: req.formatId,
    targetHeight: req.targetHeight,
    duration: req.duration,
    extractor: req.extractor,
    playlist: normalisePlaylist(req.playlist),
    uploader: req.uploader,
    series: req.series,
    subtitles: cleanLanguages(req.subtitles),
    audioLanguage: cleanLanguage(req.audioLanguage),
    waitForVideo: req.waitForVideo === true ? true : undefined,
    live: req.live || undefined,
    state: 'queued',
    percent: 0,
    attempts: 0,
    kind: 'download',
    range: hasTrim(req.section) ? req.section : undefined,
    precise: req.preciseSection ?? true,
    outputDir: req.outputDir || settings.downloadDir,
    createdAt: Date.now()
  }
  /*
    Claim the slot before waiting on anything.

    The duplicate check above used to sit in front of `await ensureYtdlp()`,
    which on first launch downloads a ~30 MB binary. Nothing was in `items`
    until that finished, so every click during the wait sailed past the check —
    and dedupe.ts exists precisely because two entries for one URL become two
    engines appending to one file with `--continue`, which corrupts it.
  */
  items.set(id, item)
  emitUpdated(item)
  // Failure here is reported by the engine strip, and by the row itself once
  // it tries to run; the item stays queued rather than vanishing.
  await ensureYtdlp().catch(() => undefined)
  processQueue()
  return publicItem(item)
}

/**
 * Reconsider what should be running.
 *
 * Raising "simultaneous downloads" used to change nothing until something
 * finished, because the limit is only read when the queue is next pumped and
 * no one pumped it on a settings change.
 */
/**
 * Whether anything is currently using the engine binary.
 *
 * Updating yt-dlp replaces the executable that running transfers were started
 * from — on Windows it cannot even be overwritten while it is loaded.
 */
export function isEngineBusy(): boolean {
  // A row that is waiting has the binary loaded as surely as one that is downloading.
  return activeCount() > 0 || [...items.values()].some((item) => item.state === 'waiting')
}

export function kickQueue(): void {
  processQueue()
}

/** The engine said it is finishing, or has gone: nothing more to wait for it to say. */
function heardLiveStop(id: string): void {
  const deadline = liveStops.get(id)
  if (deadline) clearTimeout(deadline)
}

/** Stop and Save is off: somebody paused, cancelled or removed the row meanwhile. */
function abandonLiveStop(item: DownloadItem): void {
  heardLiveStop(item.id)
  liveStops.delete(item.id)
  item.savingLive = undefined
}

/**
 * End a live recording and keep what it has.
 *
 * Pause and cancel both force-kill, and cancel then deletes the partials, so a
 * recording that promised to run "until you stop it" had no way to be stopped
 * and kept. This asks the engine to finish; when the process has gone, by that
 * road or the deadline's, `saveRecording` makes a file of whatever is there. A
 * paused row has no process and only needs the second half: its partial may be
 * from a run that the app's own quit cut short.
 */
export function stopLiveRecording(id: string): void {
  const item = items.get(id)
  if (!item?.live || item.savingLive) return
  const proc = procs.get(id)
  // Paused, or failed: a broadcast that dropped hours in still has those hours on disk.
  if ((item.state === 'paused' || item.state === 'error') && !proc) {
    clearRetry(id)
    markSaving(item)
    emitUpdated(item)
    void saveRecording(item, false)
    return
  }
  if (item.state !== 'downloading' || !proc) return
  markSaving(item)
  // Which of these gets there first, `close` hears nothing different: only the partial does.
  const force = (): void => killTree(proc)
  liveStops.set(id, setTimeout(force, LIVE_STOP_GRACE))
  interruptTree(proc, force)
  emitUpdated(item)
}

function markSaving(item: DownloadItem): void {
  clearPhase(item)
  item.state = 'processing'
  item.savingLive = true
  item.interrupted = false
  item.indeterminate = true
  item.error = undefined
  item.errorCode = undefined
  item.cookieHint = undefined
  item.reportId = undefined
  item.keptPartial = undefined
}

/**
 * A new run of a recording writes from scratch: ffmpeg is given `-y`, and
 * `--continue` means nothing to it. A pause and resume, an automatic retry or
 * the pick-up after a restart would each have emptied the partial of everything
 * recorded so far, so that goes to a row of its own, saved like any other, and
 * this one moves to a new name.
 */
function setAsideRecording(item: DownloadItem): void {
  item.keptPartial = undefined
  const destinations = item.partialPaths ?? []
  const pieces = piecesOnDisk(destinations).filter((piece) => !piece.whole)
  item.partialPaths = undefined
  if (!pieces.length) return
  const saved: DownloadItem = {
    ...item,
    id: randomUUID(),
    partialPaths: destinations,
    createdAt: Date.now(),
    reportId: undefined
  }
  markSaving(saved)
  items.set(saved.id, saved)

  const { dir, base } = savedPath(destinations, item.mode)
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    /* gone already: any number is free */
  }
  const bare = item.copySuffix && base.endsWith(item.copySuffix) ? base.slice(0, -item.copySuffix.length) : base
  const suffix = freeCopySuffix(bare, names)
  if (item.outputStem) item.outputStem = bare + suffix
  else item.copySuffix = suffix
  finalPaths.delete(item.id)
  emitUpdated(saved)
  void saveRecording(saved, false)
}

/**
 * The row ends with the real file, or says why it does not.
 *
 * `clean` is the engine's exit 0, after which its file is finished and needs
 * nothing done to it. In every other case the pieces are joined by copying, with
 * no encoding: the length of the recording costs only disk reads. A piece that
 * will not become a playable file is left exactly as it was and named on the row.
 */
async function saveRecording(item: DownloadItem, clean: boolean): Promise<void> {
  const stillSaving = (): boolean => items.get(item.id) === item && item.savingLive === true
  const known = finalPaths.get(item.id)?.path
  const named = [...(known && isMediaName(known) ? [known] : []), ...(item.partialPaths ?? [])]
  try {
    const finished = clean ? piecesOnDisk(named).find((piece) => piece.whole) : undefined
    if (finished) {
      const probe = await probeMedia(finished.file)
      if (!stillSaving()) return settleAbandoned(item)
      if (probe.duration && (probe.hasVideo || probe.hasAudio)) {
        finishRecording(item, finished.file, probe.duration)
        return
      }
    }

    const destinations = item.partialPaths ?? []
    const pieces = piecesOnDisk(destinations)
    if (!pieces.length) {
      saveFailed(item, 'liveEmpty', 'Nothing had been recorded yet when it stopped.')
      return
    }
    for (const piece of pieces) await joinFragments(piece)
    if (!stillSaving()) return settleAbandoned(item)

    const { dir, base, ext } = savedPath(destinations, item.mode)
    const inputs = pieces.map((piece) => piece.file)
    // The stream's own codecs may not fit the first choice; Matroska takes nearly anything.
    for (const container of [ext, item.mode === 'audio' ? 'mka' : 'mkv']) {
      const working = join(dir, `${base}.saving.${container}`)
      rmSync(working, { force: true })
      const run = runFfmpeg(remuxArgs(inputs, working, item.mode))
      procs.set(item.id, run.child)
      const { code, stderr } = await run.done
      procs.delete(item.id)
      deliberateStops.delete(item.id)
      if (!stillSaving()) {
        rmSync(working, { force: true })
        return settleAbandoned(item)
      }
      if (stderr) appendLog(item, stderr.slice(-1000) + '\n')
      const probe = code === 0 ? await probeMedia(working) : undefined
      if (!stillSaving()) {
        rmSync(working, { force: true })
        return settleAbandoned(item)
      }
      if (probe?.duration && (probe.hasVideo || probe.hasAudio)) {
        const output = uniqueOutputPath(join(dir, `${base}.${container}`), '', container)
        renameSync(working, output)
        removePieces(pieces)
        finishRecording(item, output, probe.duration)
        return
      }
      rmSync(working, { force: true })
    }
    item.keptPartial = keptFile(pieces)
    saveFailed(item, 'liveNotSaved', 'The recording could not be turned into a file that plays.')
  } catch (err) {
    item.keptPartial = keptFile(piecesOnDisk(item.partialPaths ?? []))
    const code = item.keptPartial ? 'liveNotSaved' : 'liveEmpty'
    saveFailed(item, code, err instanceof Error ? err.message : String(err))
  }
}

/** Paused, cancelled or removed while saving: that action's state stands, and its slot is free. */
function settleAbandoned(item: DownloadItem): void {
  if (items.has(item.id)) emitUpdated(item)
  processQueue()
}

function finishRecording(item: DownloadItem, file: string, duration: number): void {
  item.state = 'completed'
  item.savingLive = undefined
  item.partialPaths = undefined
  item.keptPartial = undefined
  finishProgress(item)
  item.speed = undefined
  item.eta = undefined
  item.attempts = 0
  item.finishedAt = Date.now()
  item.filepath = file
  item.duration = duration
  try {
    item.downloadedBytes = item.totalBytes = statSync(file).size
  } catch {
    // Moved already; the row still knows where it was put.
  }
  finalPaths.delete(item.id)
  expectedNames.delete(item.id)
  log.info('download', 'Finished', downloadFields(item))
  emitUpdated(item)
  processQueue()
}

function saveFailed(item: DownloadItem, code: AppErrorCode, message: string): void {
  item.savingLive = undefined
  finalPaths.delete(item.id)
  failWith(item, code, message)
}

/** Queue a trim or convert job for a file that's already on disk. */
export function startMediaJob(req: MediaJobRequest): DownloadItem {
  const id = randomUUID()
  const isTrim = req.kind === 'trim'
  const container = isTrim
    ? (req.sourcePath.split('.').pop() || 'mp4').toLowerCase()
    : (req.target?.container ?? 'mp4')
  const suffix = isTrim ? ' (clip)' : ` (${container})`
  const spokenFor = new Set(
    [...items.values()].flatMap((other) => (other.filepath ? [other.filepath.toLowerCase()] : []))
  )
  const filepath = uniqueOutputPath(req.sourcePath, suffix, container, spokenFor)

  const label = isTrim
    ? `${toTimestamp(req.range?.start ?? 0)} → ${req.range?.end != null ? toTimestamp(req.range.end) : '∞'}`
    : `→ ${container.toUpperCase()}${req.target?.height ? ` · ${req.target.height}p` : ''}`

  const item: DownloadItem = {
    id,
    kind: req.kind,
    url: req.sourcePath,
    sourcePath: req.sourcePath,
    originUrl: isWebLink(req.originUrl) ? req.originUrl : undefined,
    extractor: req.extractor,
    uploader: req.uploader,
    series: req.series,
    title: req.title,
    thumbnail: req.thumbnail,
    mode: req.target?.mode ?? 'video',
    state: 'queued',
    percent: 0,
    attempts: 0,
    range: req.range,
    precise: req.precise ?? true,
    convertTarget: req.target,
    jobLabel: label,
    filepath,
    outputDir: dirname(filepath),
    createdAt: Date.now()
  }
  items.set(id, item)
  emitUpdated(item)
  processQueue()
  return publicItem(item)
}

function clearRetry(id: string): void {
  const timer = retryTimers.get(id)
  if (timer) {
    clearTimeout(timer)
    retryTimers.delete(id)
  }
}

export function pauseDownload(id: string): void {
  const item = items.get(id)
  if (!item) return
  if (item.state === 'completed') return
  clearRetry(id)
  abortResolve(id)
  abandonLiveStop(item)
  const proc = procs.get(id)
  item.state = 'paused'
  // A deliberate pause outranks anything the previous shutdown recorded.
  item.interrupted = false
  clearPhase(item)
  if (proc) {
    deliberateStops.add(id)
    killTree(proc)
  }
  emitUpdated(item)
  processQueue()
}

export function resumeDownload(id: string): void {
  const item = items.get(id)
  if (!item) return
  if (item.state === 'completed') return
  item.state = 'queued'
  item.error = undefined
  item.errorCode = undefined
  item.cookieHint = undefined
  item.reportId = undefined
  item.attempts = 0
  item.interrupted = false
  // A fresh run decides its own output path; see retryDownload.
  finalPaths.delete(id)
  const figure = item.percent
  resetProgress(item)
  item.percent = figure
  if (figure > 0) resumedFigure.add(id)
  emitUpdated(item)
  processQueue()
}

/**
 * The stem of this item's output file, used to recognise its own leftovers.
 *
 * Everything up to the *last* dot, not the first. Splitting on the first one
 * turned "3.5 Hours of Rain.mp4" into the stem "3", which then matched — and
 * deleted — the partial files of every other download in the folder whose name
 * began with a 3. A cancel must only ever clean up after itself.
 */
export function partialStem(name: string): string {
  const file = name.split(/[\\/]/).pop() || ''
  const dot = file.lastIndexOf('.')
  return (dot > 0 ? file.slice(0, dot) : file).trim()
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Which of `names` are leftovers of the file named `stem`.
 *
 * A prefix match is not good enough, and that has now bitten twice: the stem of
 * "Lecture 1" is a prefix of "Lecture 10", so cancelling the first deleted the
 * partial belonging to the second — a download still running. What yt-dlp
 * actually writes beside an output file is `<name>.part` / `<name>.ytdl`, or,
 * while fetching the streams it is about to merge, `<stem>.f137.mp4.part`.
 * Those two shapes, exactly; everything else in the folder belongs to someone
 * else.
 */
export function partialsFor(names: string[], stem: string): string[] {
  if (stem.length < 3) return []
  const perFormat = new RegExp(`^${escapeForRegExp(stem)}\\.f[\\w-]+\\.[\\w]+$`)
  return names.filter((name) => {
    /*
      HLS and DASH downloads also leave `<name>.part-Frag12`, and `.part` on
      the end of that while a fragment is being written. Those are this
      download's too.
    */
    const fragment = /\.part-Frag\d+(?:\.part)?$/
    if (!fragment.test(name) && !name.endsWith('.part') && !name.endsWith('.ytdl')) return false
    const body = fragment.test(name) ? name.replace(fragment, '') : name.replace(/\.(part|ytdl)$/, '')
    return body === stem || partialStem(body) === stem || perFormat.test(body)
  })
}

function cleanupPartials(item: DownloadItem): void {
  /*
    Only ever the files this download itself wrote.

    The output path is known once the engine has named it; when it isn't — a
    cancel in the first second — nothing is removed. That is deliberate: a
    leftover `.part` costs disk space that `--continue` reuses on the next
    attempt, whereas guessing from the title risks deleting the progress of a
    different download whose name merely starts the same way.

    The directory comes from that path too. It used to come from
    `item.outputDir`, which with per-site subfolders switched on is the parent
    of where the file actually is — so that setting turned cleanup off entirely
    and leaked partials forever.
  */
  const known = item.filepath || finalPaths.get(item.id)?.path
  if (known) cleanupPartialsAt(known)
  // A recording's other stream, or the partial of a run from before a restart.
  for (const path of item.partialPaths ?? []) if (path !== known) cleanupPartialsAt(path)
}

function cleanupPartialsAt(known: string): void {
  const stem = partialStem(known)
  const dir = dirname(known)
  try {
    for (const f of partialsFor(readdirSync(dir), stem)) {
      rmSync(join(dir, f), { force: true })
    }
  } catch {
    /* ignore */
  }
}

export function cancelDownload(id: string): void {
  const item = items.get(id)
  if (!item) return
  clearRetry(id)
  abortResolve(id)
  abandonLiveStop(item)
  const proc = procs.get(id)
  item.state = 'canceled'
  // When it stopped, not when it was queued: the keep-finished limit drops the
  // oldest finished rows first, and a download queued last week and cancelled
  // just now would otherwise vanish the moment it was cancelled.
  item.finishedAt = Date.now()
  resetProgress(item)
  item.speed = undefined
  item.eta = undefined
  if (proc) {
    /*
      Clean up once the process is actually gone, not merely once it has been
      asked to go. Termination is asynchronous everywhere — and on Windows
      `killTree` shells out to `taskkill`, which has not even started by the
      time this function returns. Deleting the .part files while yt-dlp or its
      ffmpeg child still holds them open either fails outright or races them
      into recreating the files we just removed.
    */
    proc.once('close', () => cleanupPartials(item))
    deliberateStops.add(id)
    killTree(proc)
  } else {
    cleanupPartials(item)
  }
  emitUpdated(item)
  processQueue()
}

export function retryDownload(id: string): void {
  const item = items.get(id)
  if (!item) return
  clearRetry(id)
  abortResolve(id)
  item.state = 'queued'
  item.error = undefined
  item.errorCode = undefined
  item.cookieHint = undefined
  // A retry is a fresh outcome; a report offer for the last one would be stale.
  item.reportId = undefined
  resetProgress(item)
  item.attempts = 0
  item.log = undefined
  /*
    Forget where the last attempt landed. `parseFinalPath` only overwrites when
    the new line's priority is at least the old one's, so a high-priority path
    from a previous attempt — a `[Merger]` line, say — survived a retry whose
    best line was a plain `Destination:`. "Play" and "show in folder" then
    pointed at the previous attempt's file, which usually no longer exists.
  */
  finalPaths.delete(id)
  emitUpdated(item)
  processQueue()
}

export function removeDownload(id: string): void {
  clearRetry(id)
  abortResolve(id)
  forgetProgress(id)
  /*
    Removing an unfinished download used to leave its partials behind for
    good: the row was gone, so nothing would ever resume or clear them. A trim
    or convert never owns its source, and a finished file is the user's.
  */
  const item = items.get(id)
  if (item) abandonLiveStop(item)
  const unfinished =
    item !== undefined &&
    IN_FLIGHT_STATES.includes(item.state) &&
    item.kind !== 'trim' &&
    item.kind !== 'convert'
  const known = unfinished ? item.filepath || finalPaths.get(id)?.path : undefined
  const proc = procs.get(id)
  if (proc) {
    deliberateStops.add(id)
    if (known) proc.once('close', () => cleanupPartialsAt(known))
    killTree(proc)
  } else if (known) {
    cleanupPartialsAt(known)
  }
  procs.delete(id)
  items.delete(id)
  finalPaths.delete(id)
  alreadyOnDisk.delete(id)
  skipInfo.delete(id)
  scheduleSave()
  downloadEvents.emit('removed', id)
}

export function clearFinished(): void {
  clearWhere((item) => clearedBy(item.state) === 'finished')
}

/*
  Failures are kept by "clear finished": a failed row is the one still owed an
  answer, and clearing it with the successes threw away the error text and the
  retry along with them. They have a separate action.
*/
export function clearFailed(): void {
  clearWhere((item) => clearedBy(item.state) === 'failed')
}

function clearWhere(match: (item: DownloadItem) => boolean): void {
  for (const [id, item] of items) {
    if (match(item)) forgetItem(id)
  }
  scheduleSave()
}

/** Take a row with no process behind it out of the queue, and say so. */
function forgetItem(id: string): void {
  clearRetry(id)
  forgetProgress(id)
  items.delete(id)
  finalPaths.delete(id)
  skipInfo.delete(id)
  // Per-item 'removed' events. The automation pipeline needs each one;
  // ipc.ts folds them into a single message for the window.
  downloadEvents.emit('removed', id)
}

/**
 * Drop the oldest finished rows beyond what the user chose to keep.
 *
 * Off unless they chose a number. The files stay where they are - this is the
 * list, not the downloads - and the rows go exactly as "clear finished" would
 * take them, one 'removed' each. Run on load, as a row finishes, and when the
 * setting changes, so a new, lower limit applies at once.
 */
export function applyHistoryLimit(): void {
  const beyond = finishedBeyond(items.values(), getSettings().keepFinished)
  if (!beyond.length) return
  for (const id of beyond) forgetItem(id)
  scheduleSave()
}

/** Bulk actions the queue toolbar exposes. */
export function pauseAll(): void {
  /*
    Queued items first. Pausing a running download frees its slot, and the
    queue promptly started the next queued item - so "pause all" left the
    queue running, one download at a time, behind the user's back.
  */
  const all = [...items.values()]
  for (const item of all) if (item.state === 'queued') pauseDownload(item.id)
  for (const item of all) {
    if (['downloading', 'processing', 'detecting', 'waiting'].includes(item.state)) pauseDownload(item.id)
  }
}

export function resumeAll(): void {
  for (const item of [...items.values()]) {
    if (item.state === 'paused') resumeDownload(item.id)
  }
}

/**
 * Pick up downloads that were cut short by the app closing.
 *
 * Deliberately not `resumeAll`: that would also restart anything the user
 * paused on purpose before quitting, which is the opposite of what they asked
 * for. Only items the previous shutdown marked as interrupted come back.
 */
export function resumeInterrupted(): number {
  let count = 0
  for (const item of [...items.values()]) {
    if (shouldResume(item)) {
      resumeDownload(item.id)
      count++
    }
  }
  return count
}

/**
 * Move an item to the front of the queue.
 *
 * One above the current maximum, so repeated bumps keep their relative order
 * rather than everything piling up on the same number. It only affects what
 * starts next — anything already running is left alone, because killing a
 * transfer at 80% to start another is never what "next" is meant to mean.
 */
export function prioritizeDownload(id: string): void {
  const item = items.get(id)
  if (!item || item.state !== 'queued') return
  const top = Math.max(0, ...[...items.values()].map((i) => i.priority ?? 0))
  item.priority = top + 1
  emitUpdated(item)
  processQueue()
}

export function retryFailed(): void {
  for (const item of [...items.values()]) {
    // Not cancelled rows: those were stopped on purpose, and one real failure must not revive them all.
    if (item.state === 'error') retryDownload(item.id)
  }
}

/** Kill every running child so the app can exit cleanly. */
export function shutdownDownloads(): void {
  for (const timer of retryTimers.values()) clearTimeout(timer)
  retryTimers.clear()
  for (const timer of liveStops.values()) clearTimeout(timer)
  liveStops.clear()
  for (const [id, proc] of procs) {
    const item = items.get(id)
    if (item) markInterrupted(item)
    try {
      killTree(proc)
    } catch {
      /* already gone */
    }
  }
  /*
    Items that never got as far as a process — still queued, or waiting on a
    retry timer we just cleared — were cut short too, and history is about to be
    written. Without this they persist as `queued` and are only rescued by
    `loadHistory` on the way back in; marking them here keeps one rule for the
    whole shutdown.
  */
  for (const item of items.values()) markInterrupted(item)
  procs.clear()
  flushHistory(true)
}
