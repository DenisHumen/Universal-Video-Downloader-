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
