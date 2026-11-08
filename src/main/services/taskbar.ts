import type { DownloadItem } from '@shared/types'

/** What the taskbar or dock icon should show: Electron's `setProgressBar` arguments. */
export interface TaskbarProgress {
  /** 0-1, or -1 to clear the bar. */
  value: number
  mode: 'normal' | 'indeterminate' | 'paused' | 'none'
}

/**
 * The window icon's progress bar, from the queue.
 *
 * A downloader spends most of its life behind other windows, and the queue
 * tab's badge is only seen by someone already looking at it. The taskbar (and
 * the dock on a Mac) is where a glance goes. Running items count equally, as
 * the tab's badge does; a queue whose running items cannot say how far along
 * they are shows the bar as working rather than at a made-up figure, and one
 * that is only paused shows it paused where the platform can.
 */
export function taskbarProgress(items: Pick<DownloadItem, 'state' | 'percent' | 'indeterminate'>[]): TaskbarProgress {
  const running = items.filter((d) => d.state === 'downloading' || d.state === 'processing')
  if (!running.length) {
    /*
      Resolving a link: work is happening, there is just no figure for it yet.
      Not a row waiting for a premiere, whose process does nothing but sleep: the
      bar would animate for days and say the app was busy. The row itself says it
      is waiting, and the taskbar goes back to work when something comes down.
    */
    if (items.some((d) => d.state === 'detecting')) return { value: 2, mode: 'indeterminate' }
    const paused = items.filter((d) => d.state === 'paused')
    if (!paused.length) return { value: -1, mode: 'none' }
    const value = paused.reduce((n, d) => n + clamp(d.percent), 0) / paused.length / 100
    return { value, mode: 'paused' }
  }
  if (running.every((d) => d.indeterminate)) return { value: 2, mode: 'indeterminate' }
  const value = running.reduce((n, d) => n + clamp(d.percent), 0) / running.length / 100
  return { value, mode: 'normal' }
}

function clamp(percent: number | undefined): number {
  return Math.min(100, Math.max(0, percent || 0))
}
