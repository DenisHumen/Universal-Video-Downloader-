import type { DownloadItem, DownloadRequest } from '@shared/types'

/**
 * States in which an item still owns its output path.
 *
 * `paused` counts: the partial file is still on disk and yt-dlp will resume
 * into it, so a second entry would write the same bytes from the other end.
 */
export const IN_FLIGHT_STATES: DownloadItem['state'][] = [
  'queued',
  'detecting',
  'downloading',
  'processing',
  'paused'
]

/**
 * Would this request produce the same file as an item already in the queue?
 *
 * Output paths come from the URL and the chosen format, so two entries that
 * agree on both resolve to the same filename. With the default of three
 * concurrent downloads that means two yt-dlp processes writing one file —
 * both with `--continue`, which appends — so the result is a corrupt download
 * rather than merely a wasted one. It is easy to reach by accident: the
 * clipboard watcher offering a link the user also pasted, a video listed twice
 * in a playlist, a repeated line in a batch.
 *
 * Trim and convert jobs are exempt. They pick a unique output path up front,
 * so two of them can coexist happily.
 *
 * Finished items are exempt too: re-downloading something you already have is
 * a legitimate request, and nothing holds the file open any more.
 */
export function isSameDownload(item: DownloadItem, req: DownloadRequest): boolean {
  if (item.kind === 'trim' || item.kind === 'convert') return false
  if (!IN_FLIGHT_STATES.includes(item.state)) return false
  if ((item.sourceUrl || item.url) !== req.url) return false
  if (item.mode !== req.mode) return false
  if (item.quality !== req.quality) return false
  if (item.formatId !== req.formatId) return false
  // A different section of the same video is a different file.
  if ((item.range?.start ?? 0) !== (req.section?.start ?? 0)) return false
  return item.range?.end === req.section?.end
}
