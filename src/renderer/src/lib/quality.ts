import type { AppSettings, DownloadMode, QualityPreset, VideoFormat } from '@shared/types'

/** Resolution ladder offered when a site doesn't tell us its real heights. */
export const QUALITY_HEIGHTS = [2160, 1440, 1080, 720, 480, 360] as const

export function maxHeightOf(formats: VideoFormat[]): number {
  return formats.reduce((m, f) => Math.max(m, f.height || 0), 0)
}

/**
 * The distinct video heights a link actually offers, tallest first.
 *
 * The quality row is built from these rather than a fixed ladder: a video with
 * 720p/480p/240p must not advertise a 360p button that silently resolves to
 * something else, and every button it does show should mean what it says.
 */
export function availableHeights(formats: VideoFormat[]): number[] {
  const heights = new Set<number>()
  for (const f of formats) {
    if (f.kind === 'audio') continue
    if (f.height && f.height > 0) heights.add(f.height)
  }
  return [...heights].sort((a, b) => b - a)
}

/** `2160` reads better as "4K"; everything else is just its height. */
export function heightLabel(height: number): string {
  if (height >= 4320) return '8K'
  if (height >= 2160) return '4K'
  return `${height}p`
}

function normalizeAvailable(available?: number | number[]): number[] {
  if (available == null) return []
  if (Array.isArray(available)) return available.filter((h) => h > 0).sort((a, b) => b - a)
  return available > 0 ? [available] : []
}

/**
 * The quality the UI should preselect: the user's configured default, snapped
 * to something this particular video really has. A 1080p default on a 720p-max
 * video becomes "best"; a 360p default on a video that only has 720/480/240
 * becomes 240p rather than a button that isn't there.
 */
export function initialQuality(
  settings: AppSettings | null,
  available?: number | number[]
): QualityPreset {
  const pref = settings?.defaultQuality
  if (!pref || pref === 'best' || pref === 'audio') return 'best'
  const want = Number(pref)
  if (!Number.isFinite(want)) return 'best'

  const heights = normalizeAvailable(available)
  if (!heights.length) return pref

  // Asking for at least the best on offer is the same as asking for the best.
  if (want >= heights[0]) return 'best'
  const match = heights.find((h) => h <= want)
  return match ? (String(match) as QualityPreset) : 'best'
}

export function initialMode(settings: AppSettings | null): DownloadMode {
  return settings?.defaultMode === 'audio' ? 'audio' : 'video'
}

// ---------------------------------------------------------------------------
// What "best" actually means for this video
// ---------------------------------------------------------------------------

/**
 * What the current choice will really produce.
 *
 * "Best" is a promise, not a resolution, and the app used to leave it at that:
 * a button reading `best` and a queue row reading `best`, with no way to find
 * out whether that meant 4K or 360p short of opening the exact-stream list and
 * working out which line the engine would pick. This works it out instead —
 * with the same rules the engine uses, so what the card says is what arrives.
 */
export interface SelectionOutcome {
  height?: number
  fps?: number
  /** Container the download lands in. */
  ext?: string
  /** Estimated size, counting the audio stream when it is fetched separately. */
  bytes?: number
  /** Codec family, e.g. `avc1` or `vp9`. */
  vcodec?: string
  /** `HDR`, `DV`… when the format advertises one. */
  dynamicRange?: string
}

function sizeOf(f: VideoFormat | undefined): number | undefined {
  return f?.filesize ?? f?.filesizeApprox
}

function videoFormats(formats: VideoFormat[]): VideoFormat[] {
  return formats.filter((f) => f.kind === 'video' || f.kind === 'video+audio')
}

/** The audio stream the engine would merge in, i.e. the fattest one. */
function bestAudio(formats: VideoFormat[]): VideoFormat | undefined {
  return formats
    .filter((f) => f.kind === 'audio')
    .sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0))[0]
}

/**
 * Rank video streams the way `bv*` does: tallest first, then by bitrate, and
 * — everything else equal — prefer the one that already carries its audio,
 * because that is one fewer stream to fetch and merge.
 */
function byQuality(a: VideoFormat, b: VideoFormat): number {
  if ((b.height || 0) !== (a.height || 0)) return (b.height || 0) - (a.height || 0)
  if ((b.fps || 0) !== (a.fps || 0)) return (b.fps || 0) - (a.fps || 0)
  const bitrate = (f: VideoFormat): number => f.tbr || f.vbr || 0
  if (bitrate(b) !== bitrate(a)) return bitrate(b) - bitrate(a)
  return (b.kind === 'video+audio' ? 1 : 0) - (a.kind === 'video+audio' ? 1 : 0)
}

/**
 * The stream this selection resolves to, mirroring the format expression the
 * download builds: an explicit id wins, then a height cap, then "best".
 *
 * A cap of 720 on a video that only offers 1080 and 360 resolves to 360 —
 * `height<=?720` is what the engine asks for — and a cap above everything on
 * offer falls back to the best there is, which is why it never errors out.
 */
export function resolveSelection(
  formats: VideoFormat[],
  selection: { mode: DownloadMode; quality?: QualityPreset; formatId?: string },
  audioFormat?: string
): SelectionOutcome | null {
  if (!formats.length) return null

  if (selection.mode === 'audio') {
    const audio = bestAudio(formats)
    return { ext: audioFormat, bytes: sizeOf(audio) }
  }

  const videos = videoFormats(formats)
  if (!videos.length) return null
  const audio = bestAudio(formats)

  let chosen: VideoFormat | undefined
  if (selection.formatId) {
    chosen = formats.find((f) => f.id === selection.formatId)
  } else {
    const cap = Number(selection.quality)
    const ranked = [...videos].sort(byQuality)
    chosen = Number.isFinite(cap) && cap > 0 ? ranked.find((f) => (f.height ?? 0) <= cap) : undefined
    // No explicit cap, or nothing at or under it — the engine takes the best.
    chosen = chosen ?? ranked[0]
  }
  if (!chosen) return null

  const videoBytes = sizeOf(chosen)
  const audioBytes = chosen.kind === 'video' ? sizeOf(audio) : undefined
  return {
    height: chosen.height,
    fps: chosen.fps,
    // A merged download is remuxed to mp4; a single stream keeps its container.
    ext: chosen.kind === 'video' && audio ? 'mp4' : chosen.ext,
    bytes: videoBytes != null ? videoBytes + (audioBytes ?? 0) : undefined,
    vcodec: chosen.vcodec?.split('.')[0],
    dynamicRange:
      chosen.dynamicRange && chosen.dynamicRange.toUpperCase() !== 'SDR'
        ? chosen.dynamicRange
        : undefined
  }
}

/** `1080p60`, `4K`, or nothing when the site never said. */
export function outcomeResolution(outcome: SelectionOutcome | null): string | null {
  if (!outcome?.height) return null
  const fps = outcome.fps && outcome.fps > 30 ? Math.round(outcome.fps) : ''
  return `${heightLabel(outcome.height)}${fps}`
}
