import type { AppSettings, DownloadItem } from '@shared/types'

/** The tray's status strings, from the main-process dictionary (locale.ts). */
export type TrayStatusKey =
  | 'tray.statusDownloading'
  | 'tray.statusDownloadingNoPercent'
  | 'tray.statusQueued'
  | 'tray.statusPaused'
  | 'tray.statusIdle'

/**
 * The tray menu's status line: what the queue is doing, in a few words.
 *
 * Running items are counted and averaged as the taskbar bar averages them
 * (taskbar.ts), so the two never disagree; a figure is left out when none of
 * the running items has one rather than showing a made-up 0%. With nothing
 * running, what is waiting comes before what is paused.
 */
export function trayStatusLine(
  items: Pick<DownloadItem, 'state' | 'percent' | 'indeterminate'>[],
  t: (key: TrayStatusKey) => string
): string {
  const running = items.filter((d) => d.state === 'downloading' || d.state === 'processing')
  if (running.length) {
    const known = running.filter((d) => !d.indeterminate)
    if (!known.length) return fill(t('tray.statusDownloadingNoPercent'), running.length)
    const percent = Math.round(known.reduce((n, d) => n + clamp(d.percent), 0) / known.length)
    return fill(t('tray.statusDownloading'), running.length, percent)
  }
  const queued = items.filter((d) => d.state === 'queued' || d.state === 'detecting' || d.state === 'waiting').length
  if (queued) return fill(t('tray.statusQueued'), queued)
  const paused = items.filter((d) => d.state === 'paused').length
  if (paused) return fill(t('tray.statusPaused'), paused)
  return t('tray.statusIdle')
}

/**
 * Whether closing the main window hides it instead of closing it.
 *
 * Only while there is a tray icon to bring it back with: "keep running in the
 * tray" on, or background watching, which implies the tray. A quit already
 * under way - from the tray, the menu, the dock - always closes for real.
 */
export function closeHidesWindow(state: {
  quitting: boolean
  hasTray: boolean
  settings: Pick<AppSettings, 'trayEnabled' | 'automationEnabled'>
}): boolean {
  if (state.quitting || !state.hasTray) return false
  return state.settings.trayEnabled || state.settings.automationEnabled
}

function fill(template: string, count: number, percent?: number): string {
  return template.replace('{count}', String(count)).replace('{percent}', String(percent ?? ''))
}

function clamp(percent: number | undefined): number {
  return Math.min(100, Math.max(0, percent || 0))
}
