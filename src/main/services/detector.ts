import { spawn } from 'child_process'
import { ytdlpBinaryPath, ytdlpSpawnOptions } from './ytdlp'
import { getSettings } from './settings'
import { accessArgs, hasCookies, headerArgs, humanizeYtdlpError } from './options'
import { resolveUniversal, resolveUrl, type ResolvedUrl } from '../resolvers'
import { looksLikeCollection } from '@shared/urls'
import type {
  DetectResult,
  DetectStage,
  FormatKind,
  MediaInfo,
  PlaylistEntry,
  VideoFormat
} from '@shared/types'

interface RawFormat {
  format_id: string
  ext?: string
  vcodec?: string
  acodec?: string
  width?: number
  height?: number
  fps?: number
  tbr?: number
  vbr?: number
  abr?: number
  filesize?: number
  filesize_approx?: number
  format_note?: string
  resolution?: string
  dynamic_range?: string
  protocol?: string
}

interface RawInfo {
  _type?: string
  id?: string
  title?: string
  description?: string
  thumbnail?: string
  thumbnails?: { url: string }[]
  duration?: number
  duration_string?: string
  uploader?: string
  channel?: string
  webpage_url?: string
  original_url?: string
  url?: string
  extractor_key?: string
  extractor?: string
  is_live?: boolean
  view_count?: number
  formats?: RawFormat[]
  entries?: RawInfo[]
  playlist_count?: number
  subtitles?: Record<string, unknown>
}

export type StageReporter = (stage: DetectStage) => void

function formatKind(f: RawFormat): FormatKind {
  const hasVideo = f.vcodec && f.vcodec !== 'none'
  const hasAudio = f.acodec && f.acodec !== 'none'
  if (hasVideo && hasAudio) return 'video+audio'
  if (hasVideo) return 'video'
  if (hasAudio) return 'audio'
  return 'unknown'
}

function resolutionLabel(f: RawFormat): string {
  if (f.height) return `${f.height}p${f.fps && f.fps > 30 ? Math.round(f.fps) : ''}`
  if (f.resolution && f.resolution !== 'audio only') return f.resolution
  if (formatKind(f) === 'audio') return 'audio'
  return f.format_note || '—'
}

function mapFormats(formats: RawFormat[] = []): VideoFormat[] {
  return formats
    .filter((f) => {
      const kind = formatKind(f)
      if (kind === 'unknown') return false
      // Drop storyboards / images.
      if (f.ext === 'mhtml') return false
      return true
    })
    .map((f) => ({
      id: f.format_id,
      ext: f.ext || '—',
      kind: formatKind(f),
      resolution: resolutionLabel(f),
      height: f.height,
      width: f.width,
      fps: f.fps,
      vcodec: f.vcodec && f.vcodec !== 'none' ? f.vcodec : undefined,
      acodec: f.acodec && f.acodec !== 'none' ? f.acodec : undefined,
      abr: f.abr,
      vbr: f.vbr,
      tbr: f.tbr,
      filesize: f.filesize,
      filesizeApprox: f.filesize_approx,
      formatNote: f.format_note,
      dynamicRange: f.dynamic_range
    }))
    .sort((a, b) => {
      const kindRank = (k: FormatKind): number => (k === 'video+audio' ? 2 : k === 'video' ? 1 : 0)
      if ((b.height || 0) !== (a.height || 0)) return (b.height || 0) - (a.height || 0)
      if (kindRank(b.kind) !== kindRank(a.kind)) return kindRank(b.kind) - kindRank(a.kind)
      return (b.tbr || 0) - (a.tbr || 0)
    })
}

function pickThumbnail(info: RawInfo): string | undefined {
  if (info.thumbnail) return info.thumbnail
  if (info.thumbnails && info.thumbnails.length) {
    return info.thumbnails[info.thumbnails.length - 1].url
  }
  return undefined
}

export async function detect(
  url: string,
  onStage: StageReporter = () => undefined,
  signal?: AbortSignal
): Promise<DetectResult> {
  const settings = getSettings()

  onStage('resolving')
  let resolved: ResolvedUrl
  try {
    resolved = await resolveUrl(url)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  // A streaming site (translator/episode/quality selection) — present its picker.
  if (resolved.streaming) {
    const s = resolved.streaming
    const info: MediaInfo = {
      id: s.id,
      title: s.title,
      thumbnail: s.thumbnail,
      webpageUrl: url,
      originalUrl: url,
      extractor: resolved.extractor || s.provider,
      isLive: false,
      formats: [],
      streaming: s
    }
    return { ok: true, info }
  }

  // A custom resolver found a playlist/listing — present its entries directly.
  if (resolved.isPlaylist) {
    const entries = resolved.entries || []
    if (!entries.length) return { ok: false, error: 'No videos found on this page.' }
    return {
      ok: true,
      info: {
        id: 'playlist',
        title: resolved.playlistTitle || 'Playlist',
        webpageUrl: url,
        originalUrl: url,
        extractor: resolved.extractor || 'generic',
        isLive: false,
        formats: [],
        isPlaylist: true,
        playlistCount: entries.length,
        entries
      }
    }
  }

  const wasRewritten = resolved.url !== url.trim()

  // Collections (playlists, channels, sets) expand into a pickable list.
  if (!wasRewritten && looksLikeCollection(url)) {
    onStage('engine')
    const collection = await probeCollection(url, signal)
    if (collection) return { ok: true, info: collection }
  }

  onStage(wasRewritten ? 'probing' : 'engine')
  const probe = await probeWithEngine(resolved, signal)
  if (probe.ok && probe.info) {
    const info = probe.info
    info.webpageUrl = url
    info.originalUrl = url
    if (resolved.title) info.title = resolved.title
    if (resolved.thumbnail) info.thumbnail = resolved.thumbnail
    if (resolved.extractor) info.extractor = resolved.extractor
    if (resolved.downloadUrl) info.downloadUrl = resolved.downloadUrl
    onStage('done')
    return { ok: true, info }
  }

  // The engine gave up. Fall back to universal detection: scrape the page, and
  // if that isn't enough, open it in a hidden browser and watch for the stream.
  if (!wasRewritten && !signal?.aborted) {
    const universal = await resolveUniversal(url, {
      allowBrowser: settings.universalFallback,
      onStage: (stage) => onStage(stage)
    }).catch(() => null)

    if (universal) {
      onStage('probing')
      const second = await probeWithEngine(universal, signal)
      if (second.ok && second.info) {
        const info = second.info
        info.webpageUrl = url
        info.originalUrl = url
        info.extractor = 'Universal'
        info.viaUniversal = true
        info.downloadUrl = universal.downloadUrl
        if (universal.title) info.title = universal.title
        if (universal.thumbnail) info.thumbnail = universal.thumbnail
        if (universal.duration && !info.duration) info.duration = universal.duration
        onStage('done')
        return { ok: true, info }
      }
      // Even without engine metadata the stream itself is downloadable.
      onStage('done')
      return { ok: true, info: syntheticInfo(url, universal) }
    }
  }

  onStage('done')
  return probe
}

/** A minimal MediaInfo for a stream we found but the engine couldn't describe. */
function syntheticInfo(pageUrl: string, resolved: ResolvedUrl): MediaInfo {
  const isHls = /\.m3u8(\?|#|$)/i.test(resolved.url)
  const ext = isHls ? 'mp4' : (resolved.url.split('?')[0].split('.').pop() || 'mp4').slice(0, 4)
  return {
    id: 'universal',
    title: resolved.title || 'Video',
    thumbnail: resolved.thumbnail,
    duration: resolved.duration,
    webpageUrl: pageUrl,
    originalUrl: pageUrl,
    extractor: 'Universal',
    isLive: false,
    viaUniversal: true,
    downloadUrl: resolved.downloadUrl,
    formats: [
      {
        id: 'auto',
        ext,
        kind: 'video+audio',
        resolution: isHls ? 'auto' : 'source'
      }
    ]
  }
}

type JsonProbe = { ok: true; raw: RawInfo } | { ok: false; error: string }

function spawnJson(args: string[], signal: AbortSignal | undefined, timeoutMs: number): Promise<JsonProbe> {
  return new Promise((resolve) => {
    const settings = getSettings()
    const child = spawn(ytdlpBinaryPath(), args, ytdlpSpawnOptions())
    let stdout = ''
    let stderr = ''
    let settled = false
    const done = (value: JsonProbe): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }

    const timer = setTimeout(() => {
      child.kill()
      done({ ok: false, error: 'Detection timed out. The site may be unsupported or unreachable.' })
    }, timeoutMs)

    if (signal) {
      signal.addEventListener('abort', () => {
        child.kill()
        done({ ok: false, error: 'Detection canceled.' })
      })
    }

    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', (err) => done({ ok: false, error: err.message }))
    child.on('close', (code) => {
      if (code !== 0 || !stdout.trim()) {
        const reason = stderr.trim() || 'Could not detect any media at this URL.'
        done({ ok: false, error: humanizeYtdlpError(reason, hasCookies(settings)) })
        return
      }
      try {
        done({ ok: true, raw: JSON.parse(stdout) as RawInfo })
      } catch (err) {
        done({ ok: false, error: err instanceof Error ? err.message : 'Failed to parse media info.' })
      }
    })
  })
}

/** Expand a playlist/channel URL into its entries without extracting each one. */
async function probeCollection(url: string, signal?: AbortSignal): Promise<MediaInfo | null> {
  const settings = getSettings()
  const args = [
    '-J',
    '--flat-playlist',
    '--no-warnings',
    '--no-progress',
    '--ignore-config',
    '--playlist-end',
    String(settings.playlistLimit),
    ...accessArgs(settings),
    url
  ]
  // Listing a big channel is cheap but not instant — give it room.
  const result = await spawnJson(args, signal, 120_000)
  if (!result.ok) return null
  const raw = result.raw
  if (raw._type !== 'playlist' || !raw.entries || raw.entries.length < 2) return null

  const entries: PlaylistEntry[] = raw.entries
    .filter((e) => e.url || e.webpage_url)
    .map((e) => ({
      url: (e.webpage_url || e.url)!,
      title: e.title || 'Untitled',
      thumbnail: pickThumbnail(e)
    }))
  if (entries.length < 2) return null

  return {
    id: raw.id || 'playlist',
    title: raw.title || 'Playlist',
    thumbnail: pickThumbnail(raw),
    webpageUrl: raw.webpage_url || url,
    originalUrl: url,
    extractor: raw.extractor_key || raw.extractor || 'generic',
    isLive: false,
    formats: [],
    isPlaylist: true,
    playlistCount: raw.playlist_count || entries.length,
    entries
  }
}

async function probeWithEngine(resolved: ResolvedUrl, signal?: AbortSignal): Promise<DetectResult> {
  const settings = getSettings()
  const args = [
    '-J',
    '--no-warnings',
    '--no-playlist',
    '--no-progress',
    '--ignore-config',
    ...accessArgs(settings),
    ...headerArgs(resolved.headers)
  ]
  if (resolved.referer) args.push('--referer', resolved.referer)
  args.push(resolved.url)

  const result = await spawnJson(args, signal, 75_000)
  if (!result.ok) return { ok: false, error: result.error }

  const raw = result.raw
  const isPlaylist = raw._type === 'playlist'
  const primary = isPlaylist && raw.entries && raw.entries.length ? raw.entries[0] : raw
  const formats = mapFormats(primary.formats)
  if (!formats.length) {
    return { ok: false, error: 'No downloadable formats were found at this link.' }
  }

  const info: MediaInfo = {
    id: primary.id || raw.id || 'unknown',
    title: raw.title || primary.title || 'Untitled',
    description: primary.description,
    thumbnail: pickThumbnail(primary) || pickThumbnail(raw),
    duration: primary.duration,
    durationString: primary.duration_string,
    uploader: primary.uploader || primary.channel,
    channel: primary.channel,
    webpageUrl: raw.webpage_url || primary.webpage_url || resolved.url,
    originalUrl: raw.original_url || resolved.url,
    extractor: raw.extractor_key || raw.extractor || primary.extractor || 'generic',
    isLive: Boolean(primary.is_live),
    viewCount: primary.view_count,
    formats,
    subtitleLanguages: Object.keys(primary.subtitles || {}).slice(0, 24),
    isPlaylist,
    playlistCount: isPlaylist ? raw.playlist_count || raw.entries?.length : undefined
  }
  return { ok: true, info }
}
