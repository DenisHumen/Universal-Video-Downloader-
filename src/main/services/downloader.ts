import { app } from 'electron'
import { EventEmitter } from 'events'
import { spawn, ChildProcess } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { ytdlpBinaryPath, ensureYtdlp, ytdlpSpawnOptions } from './ytdlp'
import { ffmpegLocation } from './ffmpeg'
import { getSettings } from './settings'
import { accessArgs, hasCookies, humanizeYtdlpError } from './options'
import { resolveUrl } from './resolvers'
import type { DownloadItem, DownloadProgress, DownloadRequest, QualityPreset } from '@shared/types'

export const downloadEvents = new EventEmitter()

const PROGRESS_PREFIX = '@@UVD@@'
const items = new Map<string, DownloadItem>()
const procs = new Map<string, ChildProcess>()
const finalPaths = new Map<string, { path: string; priority: number }>()

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
      items.set(item.id, item)
    }
  } catch (err) {
    console.error('Failed to load history', err)
  }
}

let saveTimer: NodeJS.Timeout | null = null
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      const dir = app.getPath('userData')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(historyFile(), JSON.stringify([...items.values()], null, 2), 'utf-8')
    } catch (err) {
      console.error('Failed to save history', err)
    }
  }, 400)
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

function buildArgs(item: DownloadItem): string[] {
  const settings = getSettings()
  const args: string[] = [
    '--ignore-config',
    '--no-playlist',
    '--newline',
    '--no-color',
    '--continue',
    // Be resilient to flaky hosts and speed up fragmented (HLS/DASH) downloads.
    '--retries', '5',
    '--fragment-retries', '10',
    '--concurrent-fragments', '4'
  ]

  const ffmpeg = ffmpegLocation()
  if (ffmpeg) args.push('--ffmpeg-location', ffmpeg)
  args.push(...accessArgs(settings))
  if (item.referer) args.push('--referer', item.referer)
  if (settings.restrictFilenames) args.push('--restrict-filenames')

  // Output template. For custom-resolved streams (e.g. a scraped .m3u8) the
  // engine's own title is meaningless, so we bake in the title we scraped.
  if (item.referer && item.title) {
    const safe = item.title
      .replace(/[%/\\:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 150)
    args.push('-o', join(item.outputDir, `${safe || 'video'}.%(ext)s`))
  } else {
    const template = settings.filenameTemplate || '%(title)s [%(id)s].%(ext)s'
    args.push('-o', join(item.outputDir, template))
  }

  // Progress as machine-readable lines
  args.push(
    '--progress-template',
    `download:${PROGRESS_PREFIX}%(progress.status)s\t%(progress.downloaded_bytes)s\t%(progress.total_bytes)s\t%(progress.total_bytes_estimate)s\t%(progress.speed)s\t%(progress.eta)s\t%(progress.fragment_index)s\t%(progress.fragment_count)s`
  )

  if (item.mode === 'audio') {
    args.push('-f', 'bestaudio/best', '-x', '--audio-format', settings.audioFormat, '--audio-quality', '0')
  } else {
    if (item.formatId) {
      args.push('-f', `${item.formatId}+bestaudio/${item.formatId}/best`)
    } else {
      args.push('-f', qualityFormat(item.quality))
    }
    args.push('--merge-output-format', 'mp4')
  }

  if (settings.embedMetadata) args.push('--embed-metadata')
  if (settings.embedThumbnail) args.push('--embed-thumbnail')
  if (settings.embedSubtitles) args.push('--embed-subs', '--sub-langs', 'all')

  args.push(item.url)
  return args
}

function parseFinalPath(line: string, item: DownloadItem): void {
  const candidates: { re: RegExp; priority: number }[] = [
    { re: /\[Merger\] Merging formats into "(.+?)"/, priority: 5 },
    { re: /\[ExtractAudio\] Destination:\s*(.+)\s*$/, priority: 5 },
    { re: /\[download\]\s*(.+?) has already been downloaded/, priority: 4 },
    { re: /\[Metadata\] .*?to "(.+?)"/, priority: 3 },
    { re: /\[download\] Destination:\s*(.+)\s*$/, priority: 2 }
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

function handleProgressLine(line: string, item: DownloadItem): void {
  const payload = line.slice(PROGRESS_PREFIX.length)
  const [status, downloaded, total, totalEst, speed, eta, fragIndex, fragCount] = payload.split('\t')
  const totalBytes = num(total) ?? num(totalEst)
  const downloadedBytes = num(downloaded)
  let percent = item.percent
  if (downloadedBytes != null && totalBytes) {
    percent = Math.min(100, (downloadedBytes / totalBytes) * 100)
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
    fragmentIndex: num(fragIndex),
    fragmentCount: num(fragCount)
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
  for (const item of listDownloads().reverse()) {
    if (activeCount() >= limit) break
    if (item.state === 'queued' && !procs.has(item.id)) {
      void runDownload(item)
    }
  }
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
    if (resolved.extractor) item.extractor = resolved.extractor
    if (resolved.title && (!item.title || item.title === item.sourceUrl)) item.title = resolved.title
    if (!item.thumbnail && resolved.thumbnail) item.thumbnail = resolved.thumbnail
  } catch (err) {
    item.state = 'error'
    item.error = err instanceof Error ? err.message : String(err)
    emitUpdated(item)
    processQueue()
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
      }
    }
  }

  child.stdout.on('data', onData)
  child.stderr.on('data', (d) => {
    const text = d.toString()
    stderrTail = (stderrTail + text).slice(-2000)
    // Some progress info & destinations also appear on stderr.
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) parseFinalPath(line, item)
    }
  })

  child.on('error', (err) => {
    procs.delete(item.id)
    item.state = 'error'
    item.error = err.message
    emitUpdated(item)
    processQueue()
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
      item.finishedAt = Date.now()
      const fp = finalPaths.get(item.id)
      if (fp) item.filepath = fp.path
      finalPaths.delete(item.id)
    } else {
      item.state = 'error'
      item.error = humanizeYtdlpError(
        stderrTail || `yt-dlp exited with code ${code}`,
        hasCookies(getSettings())
      )
    }
    emitUpdated(item)
    processQueue()
  })
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
    outputDir: req.outputDir || settings.downloadDir,
    createdAt: Date.now()
  }
  items.set(id, item)
  emitUpdated(item)
  processQueue()
  return item
}

export function pauseDownload(id: string): void {
  const item = items.get(id)
  if (!item) return
  const proc = procs.get(id)
  item.state = 'paused'
  if (proc) {
    proc.kill()
  }
  emitUpdated(item)
}

export function resumeDownload(id: string): void {
  const item = items.get(id)
  if (!item) return
  if (item.state === 'completed') return
  item.state = 'queued'
  emitUpdated(item)
  processQueue()
}

function cleanupPartials(item: DownloadItem): void {
  // Best-effort: remove leftover .part/.ytdl fragments for this item's output file.
  if (!item.filepath) return
  const base = (item.filepath.split(/[\\/]/).pop() || '').split('.')[0]
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
  const proc = procs.get(id)
  item.state = 'canceled'
  item.percent = 0
  if (proc) proc.kill()
  cleanupPartials(item)
  emitUpdated(item)
  processQueue()
}

export function retryDownload(id: string): void {
  const item = items.get(id)
  if (!item) return
  item.state = 'queued'
  item.error = undefined
  item.percent = 0
  emitUpdated(item)
  processQueue()
}

export function removeDownload(id: string): void {
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
      items.delete(id)
      finalPaths.delete(id)
      // Per-item 'removed' events — the only channel the renderer listens to.
      // (The old single 'cleared' event was never forwarded, so the button
      // appeared to do nothing until an app restart.)
      downloadEvents.emit('removed', id)
    }
  }
  scheduleSave()
}
