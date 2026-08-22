import { app } from 'electron'
import { EventEmitter } from 'events'
import { spawn, ChildProcess } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, renameSync } from 'fs'
import { dirname, join } from 'path'
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
import { accessArgs, classifyYtdlpError, hasCookies, headerArgs, isTransientError } from './options'
import { isSameDownload } from './dedupe'
import { killTree } from './process'
import { markInterrupted, shouldResume } from './resume'
import { pendingOrder } from './schedule'
import { acceptsPostprocess, overallProgress, postprocessorLabel } from './progress'
import { ffmpegProgressSeconds, isFfmpegNoise, splitOutputLines } from './ffmpeg-output'
import { markOf, shouldEmitProgress, type ProgressMark } from './throttle'
import { resolveUrl } from '../resolvers'
import { normalizeUrl } from '@shared/urls'
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

const PROGRESS_PREFIX = '@@UVD@@'
/** Post-processing progress, on its own channel so the parser can tell them apart. */
const POSTPROCESS_PREFIX = '@@UVDPP@@'
/** Automatic retries for transient network failures before we bother the user. */
const AUTO_RETRIES = 2
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

export function loadHistory(): void {
  try {
    const file = historyFile()
    if (!existsSync(file)) return
    const arr = JSON.parse(readFileSync(file, 'utf-8')) as DownloadItem[]
    for (const item of arr) {
      // Anything still in flight in the file was cut short — either the app was
      // killed before it could tidy up, or the shutdown path already parked it
      // and this is a no-op. Same rule either way; see resume.ts.
      markInterrupted(item)
      item.attempts = 0
      items.set(item.id, item)
    }
  } catch (err) {
    console.error('Failed to load history', err)
  }
}

let saveTimer: NodeJS.Timeout | null = null
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(flushHistory, 400)
}

/** Persist atomically — a half-written history.json would lose the whole queue. */
export function flushHistory(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  try {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const target = historyFile()
    const tmp = `${target}.tmp`
    writeFileSync(tmp, JSON.stringify([...items.values()].map(publicItem), null, 2), 'utf-8')
    renameSync(tmp, target)
  } catch (err) {
    console.error('Failed to save history', err)
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
}

function qualityFormat(quality: QualityPreset | undefined): string {
  if (quality === 'audio') return 'bestaudio/best'
  const height = Number(quality)
  // 'best' (and anything non-numeric) → let the engine pick the best available.
  if (!Number.isFinite(height) || height <= 0) return 'bv*+ba/b'
  // `<=?` keeps formats with unknown height in play (common for HLS streams),
  // and the trailing `bv*+ba/b` means a request above what the site offers
  // falls back to the best available instead of erroring out.
  return `bv*[height<=?${height}]+ba/b[height<=?${height}]/bv*+ba/b`
}

/** Strip characters no filesystem we support will accept. */
function safeName(title: string): string {
  return title
    .replace(/[%/\\:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150)
}

/** The site a download came from, for the per-site subfolder. */
function siteFolder(item: DownloadItem): string {
  /*
    `extractor` is only ever set by a hand-written resolver, and there are three
    of those. Every site the engine handles natively — which is to say YouTube,
    Vimeo, TikTok, all of them — arrived with it undefined and went into a
    single folder called `other`, so the setting that promises "a folder per
    site" delivered one folder for the entire internet.

    The detector knows the extractor and now sends it along; the host name is
    the fallback for anything queued before that, and for links queued without
    a detect step at all.
  */
  if (item.extractor) return safeName(item.extractor)
  try {
    return safeName(new URL(item.sourceUrl || item.url).hostname.replace(/^www\./, ''))
  } catch {
    return ''
  }
}

function outputDirFor(item: DownloadItem, settings: AppSettings): string {
  if (!settings.createSubfolders) return item.outputDir
  const folder = siteFolder(item) || 'other'
  const dir = join(item.outputDir, folder)
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  } catch {
    return item.outputDir
  }
  return dir
}

function buildArgs(item: DownloadItem): string[] {
  const settings = getSettings()
  const args: string[] = [
    '--ignore-config',
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

  const ffmpeg = ffmpegLocation()
  if (ffmpeg) args.push('--ffmpeg-location', ffmpeg)
  args.push(...accessArgs(settings))
  args.push(...headerArgs(item.headers))
  if (item.referer) args.push('--referer', item.referer)
  if (settings.restrictFilenames) args.push('--restrict-filenames')
  if (settings.speedLimit.trim()) args.push('--limit-rate', settings.speedLimit.trim())

  const dir = outputDirFor(item, settings)

  // Output template. For custom-resolved streams (e.g. a scraped .m3u8) the
  // engine's own title is meaningless, so we bake in the title we scraped.
  if ((item.referer || item.headers) && item.title) {
    args.push('-o', join(dir, `${safeName(item.title) || 'video'}.%(ext)s`))
  } else {
    const template = settings.filenameTemplate || '%(title)s [%(id)s].%(ext)s'
    args.push('-o', join(dir, template))
  }

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
    args.push('-f', 'bestaudio/best', '-x', '--audio-format', settings.audioFormat, '--audio-quality', '0')
  } else {
    if (item.formatId && item.formatId !== 'auto') {
      args.push('-f', `${item.formatId}+bestaudio/${item.formatId}/best`)
    } else {
      args.push('-f', qualityFormat(item.quality))
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

  if (settings.embedMetadata) args.push('--embed-metadata')
  if (settings.embedThumbnail) args.push('--embed-thumbnail')
  if (settings.embedChapters && item.mode === 'video') args.push('--embed-chapters')
  const subLangs = settings.subtitleLanguages.trim() || 'all'
  if (settings.embedSubtitles && item.mode === 'video') {
    args.push('--embed-subs', '--sub-langs', subLangs)
  }
  if (settings.writeSubtitles) {
    args.push('--write-subs', '--write-auto-subs', '--sub-langs', subLangs, '--convert-subs', 'srt')
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

  args.push(item.url)
  return args
}

function parseFinalPath(line: string, item: DownloadItem): void {
  const candidates: { re: RegExp; priority: number }[] = [
    { re: /\[Merger\] Merging formats into "(.+?)"/, priority: 6 },
    { re: /\[ExtractAudio\] Destination:\s*(.+?)\s*$/, priority: 6 },
    { re: /\[SponsorBlock\].*?to "(.+?)"/, priority: 5 },
    { re: /\[download\]\s*(.+?) has already been downloaded/, priority: 4 },
    { re: /\[Metadata\] .*?to "(.+?)"/, priority: 3 },
    { re: /\[download\] Destination:\s*(.+?)\s*$/, priority: 2 }
  ]
  for (const { re, priority } of candidates) {
    const m = line.match(re)
    if (m && m[1]) {
      const current = finalPaths.get(item.id)
      if (!current || priority >= current.priority) {
        finalPaths.set(item.id, { path: m[1].trim(), priority })
      }
    }
  }
}

function appendLog(item: DownloadItem, text: string): void {
  item.log = ((item.log || '') + text).slice(-LOG_TAIL_CHARS)
}

function handleProgressLine(line: string, item: DownloadItem): void {
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
function handleFfmpegProgress(seconds: number, item: DownloadItem): void {
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
  const view = overallProgress({ ...input, previous: item.percent })
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
    else void runDownload(item)
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

  // Re-read the state: pause/cancel mutate the item while ffmpeg is running.
  const stateAfterRun = items.get(item.id)?.state
  if (stateAfterRun === 'paused' || stateAfterRun === 'canceled') {
    // Half-written output is useless; don't leave it lying around.
    try {
      if (item.filepath && existsSync(item.filepath)) rmSync(item.filepath, { force: true })
    } catch {
      /* best effort */
    }
    emitUpdated(item)
    processQueue()
    return
  }

  if (code === 0) {
    item.state = 'completed'
    finishProgress(item)
    item.finishedAt = Date.now()
    emitUpdated(item)
    processQueue()
    return
  }
  appendLog(item, stderr)
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
    if (items.get(item.id)?.state !== 'detecting') {
      processQueue()
      return
    }
    fail(item, err instanceof Error ? err.message : String(err))
    return
  } finally {
    resolveAborts.delete(item.id)
  }
  // Paused/canceled/removed while we were resolving — don't start the engine.
  if (!items.has(item.id) || item.state !== 'detecting') {
    processQueue()
    return
  }

  item.state = 'downloading'
  emitUpdated(item)

  const args = buildArgs(item)
  const child = spawn(ytdlpBinaryPath(), args, ytdlpSpawnOptions())
  procs.set(item.id, child)

  let stderrTail = ''
  let buffer = ''

  const onOutputLine = (line: string): void => {
    if (line.startsWith(PROGRESS_PREFIX)) {
      handleProgressLine(line, item)
    } else if (line.startsWith(POSTPROCESS_PREFIX)) {
      handlePostprocessLine(line, item)
    } else if (line.trim()) {
      parseFinalPath(line, item)
      appendLog(item, line + '\n')
    }
  }

  const onData = (data: Buffer): void => {
    buffer += data.toString()
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() || ''
    for (const line of lines) onOutputLine(line)
  }

  const onErrorLine = (line: string): void => {
    if (!line.trim()) return
    const seconds = ffmpegProgressSeconds(line)
    if (seconds != null) {
      handleFfmpegProgress(seconds, item)
      return
    }
    parseFinalPath(line, item)
    if (isFfmpegNoise(line)) return
    stderrTail = (stderrTail + line + '\n').slice(-4000)
    appendLog(item, line + '\n')
  }

  child.stdout.on('data', onData)
  /*
    Buffered, and split on carriage returns as well as newlines.

    ffmpeg — which the engine spawns for trimmed sections and most live
    captures, with its console inherited — overwrites a single status line
    rather than printing new ones, so its whole output arrives as one
    `\r`-separated run that a newline split never breaks apart. And a chunk
    boundary falls wherever the pipe happens to flush, so without the buffer
    the line naming the output file can be torn in half and never recognised.
  */
  let errBuffer = ''
  child.stderr.on('data', (d) => {
    errBuffer += d.toString()
    const lines = splitOutputLines(errBuffer)
    errBuffer = lines.pop() ?? ''
    for (const line of lines) onErrorLine(line)
  })

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
    if (buffer) {
      onOutputLine(buffer)
      buffer = ''
    }
    if (errBuffer) {
      onErrorLine(errBuffer)
      errBuffer = ''
    }
    // If we deliberately stopped it, the state was already set — or has since
    // been changed again by a resume, which is equally not a failure.
    const stoppedOnPurpose = deliberateStops.delete(item.id)
    if (stoppedOnPurpose || item.state === 'paused' || item.state === 'canceled') {
      emitUpdated(item)
      processQueue()
      return
    }
    if (code === 0) {
      item.state = 'completed'
      finishProgress(item)
      item.speed = undefined
      item.eta = undefined
      item.attempts = 0
      item.finishedAt = Date.now()
      const fp = finalPaths.get(item.id)
      if (fp) item.filepath = fp.path
      finalPaths.delete(item.id)
      emitUpdated(item)
      processQueue()
      return
    }
    fail(item, stderrTail || `yt-dlp exited with code ${code}`)
  })
}

/** Mark a failure, retrying transient ones automatically with a short backoff. */
function fail(item: DownloadItem, rawError: string): void {
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
    const timer = setTimeout(() => {
      retryTimers.delete(item.id)
      processQueue()
    }, attempts * 4000)
    retryTimers.set(item.id, timer)
    return
  }
  const { code, message, cookieHint } = classifyYtdlpError(rawError, hasCookies(getSettings()))
  item.state = 'error'
  clearPhase(item)
  item.error = message
  item.errorCode = code
  item.cookieHint = cookieHint
  emitUpdated(item)
  processQueue()
}

/** A failure the app diagnosed itself, so it already knows what to call it. */
function failWith(item: DownloadItem, code: AppErrorCode, message: string): void {
  item.state = 'error'
  clearPhase(item)
  item.error = message
  item.errorCode = code
  item.cookieHint = false
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
  return activeCount() > 0
}

export function kickQueue(): void {
  processQueue()
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
  item.attempts = 0
  item.interrupted = false
  // A fresh run decides its own output path; see retryDownload.
  finalPaths.delete(id)
  /*
    A resume re-runs the engine from the beginning, so the bar has to go with
    it. Without this the never-backwards rule pinned it at the figure the
    previous attempt reached — an item paused during a merge would sit at 90%
    for the whole of its fresh download.
  */
  resetProgress(item)
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
    if (!name.endsWith('.part') && !name.endsWith('.ytdl')) return false
    const body = name.replace(/\.(part|ytdl)$/, '')
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
  if (!known) return
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
  const proc = procs.get(id)
  item.state = 'canceled'
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
  const proc = procs.get(id)
  if (proc) {
    deliberateStops.add(id)
    killTree(proc)
  }
  procs.delete(id)
  items.delete(id)
  finalPaths.delete(id)
  scheduleSave()
  downloadEvents.emit('removed', id)
}

export function clearFinished(): void {
  for (const [id, item] of items) {
    if (item.state === 'completed' || item.state === 'canceled' || item.state === 'error') {
      clearRetry(id)
      forgetProgress(id)
      items.delete(id)
      finalPaths.delete(id)
      // Per-item 'removed' events — the only channel the renderer listens to.
      downloadEvents.emit('removed', id)
    }
  }
  scheduleSave()
}

/** Bulk actions the queue toolbar exposes. */
export function pauseAll(): void {
  for (const item of [...items.values()]) {
    if (['downloading', 'processing', 'detecting', 'queued'].includes(item.state)) {
      pauseDownload(item.id)
    }
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
    if (item.state === 'error' || item.state === 'canceled') retryDownload(item.id)
  }
}

/** Kill every running child so the app can exit cleanly. */
export function shutdownDownloads(): void {
  for (const timer of retryTimers.values()) clearTimeout(timer)
  retryTimers.clear()
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
  flushHistory()
}
