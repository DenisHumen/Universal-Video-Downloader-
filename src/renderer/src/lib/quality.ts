import type { AppSettings, DownloadMode, QualityPreset, VideoFormat } from '@shared/types'

/** Resolution ladder the UI knows how to offer, best first. */
export const QUALITY_HEIGHTS = [2160, 1440, 1080, 720, 480, 360] as const

export function maxHeightOf(formats: VideoFormat[]): number {
  return formats.reduce((m, f) => Math.max(m, f.height || 0), 0)
}

/**
 * The quality the UI should preselect for a video: the user's configured
 * default, or automatic "best" when that default exceeds what this video
 * actually offers — so a 1080p default can never fail on a 720p-max video.
 */
export function initialQuality(settings: AppSettings | null, maxHeight = 0): QualityPreset {
  const pref = settings?.defaultQuality
  if (!pref || pref === 'best' || pref === 'audio') return 'best'
  const want = Number(pref)
  if (!Number.isFinite(want)) return 'best'
  if (maxHeight && want > maxHeight) return 'best'
  return pref
}

export function initialMode(settings: AppSettings | null): DownloadMode {
  return settings?.defaultMode === 'audio' ? 'audio' : 'video'
}
