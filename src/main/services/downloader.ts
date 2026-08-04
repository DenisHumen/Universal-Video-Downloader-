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
  ffmpegLocation,
  humanizeFfmpegError,
  probeMedia,
  rangeDuration,
  runFfmpeg,
  toTimestamp,
  uniqueOutputPath
} from './ffmpeg'
import { getSettings } from './settings'
import { accessArgs, hasCookies, headerArgs, humanizeYtdlpError, isTransientError } from './options'
import { resolveUrl } from '../resolvers'
import { hasTrim } from '@shared/types'
import type {
  AppSettings,
  DownloadItem,
  DownloadProgress,
  DownloadRequest,
  MediaJobRequest,
  QualityPreset
} from '@shared/types'

export const downloadEvents = new EventEmitter()

const PROGRESS_PREFIX = '@@UVD@@'
/** Automatic retries for transient network failures before we bother the user. */
const AUTO_RETRIES = 2
const LOG_TAIL_CHARS = 4000

const items = new Map<string, DownloadItem>()
const procs = new Map<string, ChildProcess>()
const finalPaths = new Map<string, { path: string; priority: number }>()
const retryTimers = new Map<string, NodeJS.Timeout>()

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
      // Anything that was mid-flight when the app closed becomes paused.
      if (
        item.state === 'downloading' ||
        item.state === 'processing' ||
        item.state === 'queued' ||
        item.state === 'detecting'
      ) {
        item.state = 'paused'
      }
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
    writeFileSync(tmp, JSON.stringify([...items.values()], null, 2), 'utf-8')
    renameSync(tmp, target)
  } catch (err) {
    console.error('Failed to save history', err)
  }
}

export function listDownloads(): DownloadItem[] {
  return [...items.values()].sort((a, b) => b.createdAt - a.createdAt)
}

function emitUpdated(item: DownloadItem): void {
  downloadEvents.emit('updated', { ...item })
  scheduleSave()
}

function emitProgress(progress: DownloadProgress): void {
  downloadEvents.emit('progress', progress)
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

function outputDirFor(item: DownloadItem, settings: AppSettings): string {
  if (!settings.createSubfolders) return item.outputDir
  const folder = safeName(item.extractor || 'other') || 'other'
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

  if (item.mode === 'audio') {
    args.push('-f', 'bestaudio/best', '-x', '--audio-format', settings.audioFormat, '--audio-quality', '0')
  } else {
    if (item.formatId && item.formatId !== 'auto') {
      args.push('-f', `${item.formatId}+bestaudio/${item.formatId}/best`)
    } else {
      args.push('-f', qualityFormat(item.quality))
    }
    args.push('--merge-output-format', 'mp4')
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
    args.push('--force-keyframes-at-cuts')
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
  const payload = line.slice(PROGRESS_PREFIX.length)
  const [status, downloaded, total, totalEst, speed, eta, fragIndex, fragCount] = payload.split('\t')
  const totalBytes = num(total) ?? num(totalEst)
  const downloadedBytes = num(downloaded)
  const fragmentIndex = num(fragIndex)
  const fragmentCount = num(fragCount)
  let percent = item.percent
  if (downloadedBytes != null && totalBytes) {
    percent = Math.min(100, (downloadedBytes / totalBytes) * 100)
  } else if (fragmentIndex != null && fragmentCount) {
    // Fragmented streams often report no byte totals — fragments are the next best.
    percent = Math.min(100, (fragmentIndex / fragmentCount) * 100)
  }

  if (status === 'finished') {
    item.state = 'processing'
    item.percent = Math.max(item.percent, 99)
  } else {
    item.state = 'downloading'
    item.percent = percent
  }
  item.speed = num(speed)
  item.eta = num(eta)
  item.downloadedBytes = downloadedBytes
  item.totalBytes = totalBytes

  emitProgress({
    id: item.id,
    state: item.state,
    percent: item.percent,
    speed: item.speed,
    eta: item.eta,
    downloadedBytes,
    totalBytes,
    fragmentIndex,
    fragmentCount
  })
}

function activeCount(): number {
  let n = 0
  for (const item of items.values()) {
    if (item.state === 'downloading' || item.state === 'processing' || item.state === 'detecting') n++
  }
  return n
}

function processQueue(): void {
  const settings = getSettings()
  const limit = Math.max(1, settings.concurrentDownloads || 1)
  if (activeCount() >= limit) return
  // Oldest first: the queue is FIFO from the user's point of view.
  for (const item of listDownloads().reverse()) {
    if (activeCount() >= limit) break
    if (item.state === 'queued' && !procs.has(item.id) && !retryTimers.has(item.id)) {
      if (item.kind && item.kind !== 'download') void runMediaJob(item)
      else void runDownload(item)
    }
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
    item.state = 'error'
    item.error = 'The source file is gone — it may have been moved or deleted.'
    emitUpdated(item)
    processQueue()
    return
  }

  item.state = 'downloading'
  item.error = undefined
  emitUpdated(item)

  const probe = await probeMedia(source)
  // Catch the impossible ask up front rather than letting ffmpeg fail obscurely.
  if (item.kind === 'convert' && item.convertTarget?.mode === 'audio' && !probe.hasAudio) {
    item.state = 'error'
    item.error = 'This file has no audio track, so it can’t be converted to an audio format.'
    emitUpdated(item)
    processQueue()
    return
  }

  // Trims render only the selected span; conversions render the whole file.
  const totalSeconds =
    item.kind === 'trim' ? rangeDuration(item.range ?? {}, probe.duration) : probe.duration

  let args: string[]
  try {
    args =
      item.kind === 'trim'
        ? buildTrimArgs(source, item.filepath!, item.range ?? {}, item.precise ?? true)
        : buildConvertArgs(source, item.filepath!, item.convertTarget!)
  } catch (err) {
    fail(item, err instanceof Error ? err.message : String(err))
    return
  }

  let run: ReturnType<typeof runFfmpeg>
  try {
    run = runFfmpeg(args, {
      totalSeconds,
      onProgress: (percent, speed) => {
        if (percent >= 0) item.percent = percent
        if (speed != null) item.speed = undefined
        emitProgress({ id: item.id, state: 'downloading', percent: item.percent })
      }
    })
  } catch (err) {
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
    item.percent = 100
    item.finishedAt = Date.now()
    emitUpdated(item)
    processQueue()
    return
  }
  appendLog(item, stderr)
  // ffmpeg failures are never the flaky-network kind, so skip the retry path
  // and give the user a plain explanation straight away.
  item.state = 'error'
  item.speed = undefined
  item.eta = undefined
  item.error = humanizeFfmpegError(stderr || `ffmpeg exited with code ${code}`)
  emitUpdated(item)
  processQueue()
}

async function runDownload(item: DownloadItem): Promise<void> {
  // Re-resolve the original URL on every (re)start: streaming-site CDN links
  // are short-lived, and resolve errors (e.g. premium-only translations) land
  // on the card as a normal failure the user can see and retry.
  item.state = 'detecting'
  item.error = undefined
  emitUpdated(item)
  try {
    const resolved = await resolveUrl(item.sourceUrl || item.url)
    item.url = resolved.url
    item.referer = resolved.referer
    item.headers = resolved.headers
    if (resolved.extractor) item.extractor = resolved.extractor
    if (resolved.title && (!item.title || item.title === item.sourceUrl)) item.title = resolved.title
    if (!item.thumbnail && resolved.thumbnail) item.thumbnail = resolved.thumbnail
  } catch (err) {
    fail(item, err instanceof Error ? err.message : String(err))
    return
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

  const onData = (data: Buffer): void => {
    buffer += data.toString()
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (line.startsWith(PROGRESS_PREFIX)) {
        handleProgressLine(line, item)
      } else if (line.trim()) {
        parseFinalPath(line, item)
        appendLog(item, line + '\n')
      }
    }
  }

  child.stdout.on('data', onData)
  child.stderr.on('data', (d) => {
    const text = d.toString()
    stderrTail = (stderrTail + text).slice(-4000)
    appendLog(item, text)
    // Some progress info & destinations also appear on stderr.
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) parseFinalPath(line, item)
    }
  })

  child.on('error', (err) => {
    procs.delete(item.id)
    fail(item, err.message)
  })

  child.on('close', (code) => {
    procs.delete(item.id)
    // If we deliberately stopped it, the state was already set.
    if (item.state === 'paused' || item.state === 'canceled') {
      emitUpdated(item)
      processQueue()
      return
    }
    if (code === 0) {
      item.state = 'completed'
      item.percent = 100
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
    emitUpdated(item)
    const timer = setTimeout(() => {
      retryTimers.delete(item.id)
      processQueue()
    }, attempts * 4000)
    retryTimers.set(item.id, timer)
    return
  }
  item.state = 'error'
  item.speed = undefined
  item.eta = undefined
  item.error = humanizeYtdlpError(rawError, hasCookies(getSettings()))
  emitUpdated(item)
  processQueue()
}

export async function startDownload(req: DownloadRequest): Promise<DownloadItem> {
  await ensureYtdlp()
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
    state: 'queued',
    percent: 0,
    attempts: 0,
    kind: 'download',
    range: hasTrim(req.section) ? req.section : undefined,
    outputDir: req.outputDir || settings.downloadDir,
    createdAt: Date.now()
  }
  items.set(id, item)
  emitUpdated(item)
  processQueue()
  return item
}

/** Queue a trim or convert job for a file that's already on disk. */
export function startMediaJob(req: MediaJobRequest): DownloadItem {
  const id = randomUUID()
  const isTrim = req.kind === 'trim'
  const container = isTrim
    ? (req.sourcePath.split('.').pop() || 'mp4').toLowerCase()
    : (req.target?.container ?? 'mp4')
  const suffix = isTrim ? ' (clip)' : ` (${container})`
  const filepath = uniqueOutputPath(req.sourcePath, suffix, container)

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
  return item
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
  const proc = procs.get(id)
  item.state = 'paused'
  item.speed = undefined
  item.eta = undefined
  if (proc) proc.kill()
  emitUpdated(item)
  processQueue()
}

export function resumeDownload(id: string): void {
  const item = items.get(id)
  if (!item) return
  if (item.state === 'completed') return
  item.state = 'queued'
  item.error = undefined
  item.attempts = 0
  emitUpdated(item)
  processQueue()
}

function cleanupPartials(item: DownloadItem): void {
  // Best-effort: remove leftover .part/.ytdl fragments for this item's output file.
  const base = item.filepath
    ? (item.filepath.split(/[\\/]/).pop() || '').split('.')[0]
    : safeName(item.title).split('.')[0]
  if (!base) return
  try {
    for (const f of readdirSync(item.outputDir)) {
      if ((f.endsWith('.part') || f.endsWith('.ytdl')) && f.startsWith(base)) {
        rmSync(join(item.outputDir, f), { force: true })
      }
    }
  } catch {
    /* ignore */
  }
}

export function cancelDownload(id: string): void {
  const item = items.get(id)
  if (!item) return
  clearRetry(id)
  const proc = procs.get(id)
  item.state = 'canceled'
  item.percent = 0
  item.speed = undefined
  item.eta = undefined
  if (proc) proc.kill()
  cleanupPartials(item)
  emitUpdated(item)
  processQueue()
}

export function retryDownload(id: string): void {
  const item = items.get(id)
  if (!item) return
  clearRetry(id)
  item.state = 'queued'
  item.error = undefined
  item.percent = 0
  item.attempts = 0
  item.log = undefined
  emitUpdated(item)
  processQueue()
}

export function removeDownload(id: string): void {
  clearRetry(id)
  const proc = procs.get(id)
  if (proc) proc.kill()
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
    if (item && (item.state === 'downloading' || item.state === 'processing')) item.state = 'paused'
    try {
      proc.kill()
    } catch {
      /* already gone */
    }
  }
  procs.clear()
  flushHistory()
}
