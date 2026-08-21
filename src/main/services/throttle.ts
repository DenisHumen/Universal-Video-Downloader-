import type { DownloadProgress } from '@shared/types'

/**
 * How often a running download is allowed to speak.
 *
 * The engine prints a progress line every time it has something new to say,
 * which on a fast connection is many times a second, per download. Each one
 * crossed the IPC boundary, replaced the store's array and re-rendered the
 * queue — so three concurrent downloads could keep the renderer busy doing
 * nothing but redrawing numbers that had moved by a fraction of a percent.
 *
 * Four updates a second is faster than anyone can read and slower than the
 * engine can talk.
 */
export const PROGRESS_INTERVAL_MS = 250

/** What was last sent for one item, so the next update can be judged against it. */
export interface ProgressMark {
  at: number
  state: DownloadProgress['state']
  phase?: DownloadProgress['phase']
  postprocess?: DownloadProgress['postprocess']
  indeterminate?: boolean
  percent: number
}

export function markOf(progress: DownloadProgress, at: number): ProgressMark {
  return {
    at,
    state: progress.state,
    phase: progress.phase,
    postprocess: progress.postprocess,
    indeterminate: progress.indeterminate,
    percent: progress.percent
  }
}

/**
 * Whether this update is worth sending now.
 *
 * Rate limiting must never swallow a *change of kind*: the hand-over from
 * downloading to merging, a phase that stops being able to report a figure, a
 * bar reaching the end. Those are the moments the row's whole appearance turns
 * on, and delaying one by a quarter of a second is the difference between an
 * interface that responds and one that stutters. Only a figure creeping upward
 * within the same phase is worth holding back.
 */
export function shouldEmitProgress(
  previous: ProgressMark | undefined,
  next: DownloadProgress,
  now: number,
  intervalMs = PROGRESS_INTERVAL_MS
): boolean {
  if (!previous) return true
  if (previous.state !== next.state) return true
  if (previous.phase !== next.phase) return true
  if (previous.postprocess !== next.postprocess) return true
  if (previous.indeterminate !== next.indeterminate) return true
  // The end of the bar is never "just another number".
  if (next.percent >= 100 && previous.percent < 100) return true
  return now - previous.at >= intervalMs
}
