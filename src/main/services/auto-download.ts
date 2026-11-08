import { copiedLinkAction } from '@shared/auto-sources'
import { normalizeUrl, youtubeIdOf } from '@shared/urls'
import type { DownloadRequest, MediaInfo } from '@shared/types'
import { detect } from './detector'
import { listDownloads, startDownload } from './downloader'
import { holdsLink } from './library'
import { log } from './log'
import { getSettings } from './settings'

export interface CopiedLinkHooks {
  /** Show the clipboard strip: the link needs a person after all. */
  offer: (url: string) => void
  /** A download started by itself, so the window can say so. */
  started: (title: string) => void
}

/** Links being detected right now: copying one again must not start a second run. */
const claimed = new Set<string>()

/** Everything already handled, by the address it was copied from. A failure or a cancel can be tried again. */
function handledLinks(): Set<string> {
  const known = new Set(claimed)
  for (const item of listDownloads()) {
    if (item.state === 'error' || item.state === 'canceled') continue
    known.add(normalizeUrl(item.sourceUrl ?? item.url))
  }
  return known
}

/** Pure: what to queue for a link, from what detection learned, using the defaults from Settings. */
export function autoRequest(
  url: string,
  info: Pick<MediaInfo, 'title' | 'thumbnail' | 'duration' | 'extractor'> | undefined,
  defaults: { defaultMode: DownloadRequest['mode']; defaultQuality: DownloadRequest['quality'] }
): DownloadRequest {
  const mode = defaults.defaultMode === 'audio' ? 'audio' : 'video'
  const pref = defaults.defaultQuality
  const ytId = youtubeIdOf(url)
  return {
    url,
    title: info?.title,
    thumbnail: info?.thumbnail ?? (ytId ? `https://i.ytimg.com/vi/${ytId}/mqdefault.jpg` : undefined),
    duration: info?.duration,
    extractor: info?.extractor,
    mode,
    quality: mode === 'audio' ? 'audio' : !pref || pref === 'audio' ? 'best' : pref
  }
}

/**
 * A link just landed on the clipboard: download it, offer it, or leave it.
 *
 * Detected first, for the title and poster the queue and the Library show, and
 * to catch what must not start by itself: a live stream never ends, and a
 * playlist or a series needs choosing. A failed detect is queued all the same -
 * the run fails as an ordinary row, with its error, its notification and its
 * retry, where a copied link quietly doing nothing would explain nothing.
 */
export async function handleCopiedLink(url: string, hooks: CopiedLinkHooks): Promise<void> {
  const settings = getSettings()
  const action = copiedLinkAction(url, {
    autoDownload: settings.autoDownload,
    autoDownloadOff: settings.autoDownloadOff,
    clipboardWatch: settings.clipboardWatch,
    // Copying the link of a video already kept, to share it, must not fetch it again.
    known: holdsLink(normalizeUrl(url)) ? new Set([...handledLinks(), normalizeUrl(url)]) : handledLinks()
  })
  if (action === 'offer') hooks.offer(url)
  if (action !== 'download') return

  const link = normalizeUrl(url)
  claimed.add(link)
  try {
    const result = await detect(link)
    const info = result.ok ? result.info : undefined
    if (info && (info.isPlaylist || info.streaming || info.isLive)) {
      hooks.offer(url)
      return
    }
    const item = await startDownload(autoRequest(link, info, settings))
    log.info('auto', 'Download started by itself', { url: link, detected: result.ok ? 'yes' : 'no' })
    hooks.started(item.title)
  } catch (err) {
    log.warn('auto', 'Could not start', { url: link, error: err instanceof Error ? err.message : String(err) })
    hooks.offer(url)
  } finally {
    claimed.delete(link)
  }
}
