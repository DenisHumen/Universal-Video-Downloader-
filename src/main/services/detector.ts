import { spawn } from 'child_process'
import { ytdlpBinaryPath } from './ytdlp'
import { getSettings } from './settings'
import type { DetectResult, FormatKind, MediaInfo, VideoFormat } from '@shared/types'

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
  extractor_key?: string
  extractor?: string
  is_live?: boolean
  view_count?: number
  formats?: RawFormat[]
  entries?: RawInfo[]
  playlist_count?: number
}

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
      const kindRank = (k: FormatKind) => (k === 'video+audio' ? 2 : k === 'video' ? 1 : 0)
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

export function detect(url: string, signal?: AbortSignal): Promise<DetectResult> {
  return new Promise((resolve) => {
    const settings = getSettings()
    const args = [
      '-J',
      '--no-warnings',
      '--no-playlist',
      '--no-progress',
      '--ignore-config'
    ]
    if (settings.proxy) args.push('--proxy', settings.proxy)
    args.push(url)

    const child = spawn(ytdlpBinaryPath(), args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill()
      resolve({ ok: false, error: 'Detection timed out. The site may be unsupported or unreachable.' })
    }, 90_000)

    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timeout)
        child.kill()
        resolve({ ok: false, error: 'Detection canceled.' })
      })
    }

    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', (err) => {
      clearTimeout(timeout)
      resolve({ ok: false, error: err.message })
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code !== 0 || !stdout.trim()) {
        const reason = stderr.split('\n').filter(Boolean).pop() || 'Could not detect any media at this URL.'
        resolve({ ok: false, error: reason.replace(/^ERROR:\s*/i, '') })
        return
      }
      try {
        const raw = JSON.parse(stdout) as RawInfo
        const isPlaylist = raw._type === 'playlist'
        const primary = isPlaylist && raw.entries && raw.entries.length ? raw.entries[0] : raw
        const info: MediaInfo = {
          id: primary.id || raw.id || 'unknown',
          title: raw.title || primary.title || 'Untitled',
          description: primary.description,
          thumbnail: pickThumbnail(primary) || pickThumbnail(raw),
          duration: primary.duration,
          durationString: primary.duration_string,
          uploader: primary.uploader || primary.channel,
          channel: primary.channel,
          webpageUrl: raw.webpage_url || primary.webpage_url || url,
          originalUrl: raw.original_url || url,
          extractor: raw.extractor_key || raw.extractor || primary.extractor || 'generic',
          isLive: Boolean(primary.is_live),
          viewCount: primary.view_count,
          formats: mapFormats(primary.formats),
          isPlaylist,
          playlistCount: isPlaylist ? raw.playlist_count || raw.entries?.length : undefined
        }
        resolve({ ok: true, info })
      } catch (err) {
        resolve({ ok: false, error: err instanceof Error ? err.message : 'Failed to parse media info.' })
      }
    })
  })
}
