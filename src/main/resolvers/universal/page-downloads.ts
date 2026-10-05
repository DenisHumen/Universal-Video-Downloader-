/**
 * What becomes of a download a page starts in the browsing session, decided
 * without Electron.
 *
 * Electron's default for a download nobody handles is a native Save dialog and
 * a write wherever the user points it, outside the queue, the download folder
 * and the naming rules. In the browsing session that default was reachable from
 * pages nobody was looking at: the hidden sniffer loads arbitrary pages when
 * detection falls back to universal mode and clicks anything shaped like a
 * play button, so a Save dialog could open out of nowhere.
 */

/**
 * - `cancel`: the page is not on screen, or it keeps starting downloads.
 * - `queue`: a web video or audio file the user is looking at the page of; it
 *   goes to the queue like anything found in the media panel.
 * - `ask`: anything else from the visible browser keeps Electron's Save dialog.
 *   That is never rerouted: `blob:` and `data:` URLs mean nothing to the
 *   engine, and a zip or a PDF is not the app's business.
 */
export type DownloadVerdict = 'cancel' | 'queue' | 'ask'

export interface PageDownload {
  url: string
  mimeType: string
  /** The page is in the built-in browser's view and its window is on screen. */
  onScreen: boolean
  /** That page has started more downloads just now than anyone clicks for. */
  flooding: boolean
}

export function downloadVerdict(download: PageDownload): DownloadVerdict {
  if (!download.onScreen || download.flooding) return 'cancel'
  if (/^https?:\/\//i.test(download.url) && /^(video|audio)\//i.test(download.mimeType)) {
    return 'queue'
  }
  return 'ask'
}

/**
 * A counter that trips when one page starts more than `limit` downloads within
 * `windowMs`.
 *
 * Every attempt counts, the refused ones included, so a page that starts
 * downloads in a loop stays refused for as long as it keeps at it, and someone
 * clicking through a list of files only ever loses the one click too many.
 * Returns true when the attempt is one too many.
 */
export function floodGuard(
  limit: number,
  windowMs: number
): (key: string, now?: number) => boolean {
  const attempts = new Map<string, number[]>()
  return (key, now = Date.now()) => {
    // Only the newest `limit + 1` matter, so a page in a loop cannot grow this.
    const recent = (attempts.get(key) ?? []).filter((at) => now - at < windowMs).slice(-limit)
    recent.push(now)
    attempts.set(key, recent)
    if (attempts.size > 32) {
      for (const [other, times] of attempts) {
        if (times.every((at) => now - at >= windowMs)) attempts.delete(other)
      }
    }
    return recent.length > limit
  }
}
