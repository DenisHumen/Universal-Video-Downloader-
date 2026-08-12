/**
 * One bar for a job that has two halves.
 *
 * Fetching a video is not the whole job. A trimmed download re-encodes the cut
 * afterwards so the cuts land on keyframes, a video+audio download merges the
 * two streams, an audio download extracts and converts. On a long video that
 * second half can take as long as the first — and yt-dlp reports no percentage
 * for any of it, so a bar that only tracked the download sat perfectly still
 * and then jumped straight to finished.
 *
 * So the bar is split: the download owns the first 90%, post-processing owns
 * the last 10%. Neither phase can move the bar into the other's territory, and
 * the bar never walks backwards — a percentage that goes down reads as a fault
 * even when the underlying numbers are honest.
 */

export type JobPhase = 'download' | 'postprocess'

/** Where the download hands over to post-processing. */
export const DOWNLOAD_SHARE = 90

export interface ProgressView {
  /** 0–100 across the whole job. */
  percent: number
  /**
   * True when the current phase has no usable number. The caller should show
   * motion rather than a figure: a phase that is genuinely working but cannot
   * say how far along it is must not be drawn as a stalled percentage.
   */
  indeterminate: boolean
}

export interface ProgressInput {
  phase: JobPhase
  /** 0–100 within the current phase, or undefined when it reported nothing. */
  phasePercent?: number
  /** The last figure shown, so the bar can never move backwards. */
  previous?: number
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value))

export function overallProgress({ phase, phasePercent, previous = 0 }: ProgressInput): ProgressView {
  const floor = phase === 'postprocess' ? DOWNLOAD_SHARE : 0
  const ceiling = phase === 'postprocess' ? 100 : DOWNLOAD_SHARE
  const known = typeof phasePercent === 'number' && Number.isFinite(phasePercent)

  if (!known) {
    // Hold position — at the phase's floor at minimum, since entering a phase
    // means everything before it is done.
    return { percent: clamp(Math.max(previous, floor), 0, ceiling), indeterminate: true }
  }

  const span = ceiling - floor
  const mapped = floor + clamp(phasePercent, 0, 100) * (span / 100)
  return { percent: clamp(Math.max(mapped, previous), 0, ceiling), indeterminate: false }
}

/**
 * Which post-processing step is running, in words the user can act on.
 *
 * yt-dlp names its postprocessors after their classes. The ones worth naming
 * are the slow ones — the ones that made the bar look stuck in the first place.
 * Anything else is just "processing"; inventing a label for every internal step
 * would be noise, and a wrong one is worse than none.
 */
export function postprocessorLabel(name: string | undefined): 'trim' | 'merge' | 'convert' | null {
  if (!name) return null
  const key = name.toLowerCase()
  if (key.includes('splitchapters') || key.includes('modifychapters')) return 'trim'
  if (key.includes('merger') || key.includes('concat')) return 'merge'
  if (key.includes('extractaudio') || key.includes('videoconvertor') || key.includes('remux')) {
    return 'convert'
  }
  return null
}

/**
 * Whether a post-processing event should be allowed to move the bar.
 *
 * Not every post-processor runs after the download. SponsorBlock's lookup is
 * registered `after_filter`, which the engine runs *before* fetching anything,
 * and a job that has not downloaded a byte must not be shown as post-processing
 * — that would floor the bar at the hand-over point on the very first line.
 * A phase is only set once a download line has been seen, so its presence is
 * the signal that the download has actually started.
 */
export function acceptsPostprocess(phase: JobPhase | undefined): boolean {
  return phase === 'download' || phase === 'postprocess'
}
