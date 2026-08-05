import type { DownloadRequest } from '@shared/types'
import { useStore } from '../store'
import { toast } from './toast'
import { t } from '../i18n'

export interface QueueResult {
  /** Items that became new queue entries. */
  added: number
  /** Requests the main process recognised as already in flight. */
  duplicates: number
  /** Requests that threw. */
  failed: number
}

/**
 * The one way the app puts something in the download queue.
 *
 * Six screens used to call `window.api.startDownload` directly, each wrapping
 * it in its own try/catch and its own success toast — six chances for the
 * wording, the error handling and the follow-up navigation to drift apart.
 *
 * It also owns the "already queued" story. The main process refuses to create a
 * second entry for a URL that is still in flight and hands back the existing
 * one instead; the only way to notice that from here is that the id it returns
 * is one we already knew about. Without this the UI would cheerfully report
 * "added to the queue" for something it did not add.
 */
async function queue(requests: DownloadRequest[]): Promise<QueueResult> {
  const result: QueueResult = { added: 0, duplicates: 0, failed: 0 }
  // Ids seen before the batch, plus ids created during it: the store updates
  // asynchronously, so within one batch it cannot be the source of truth.
  const known = new Set(useStore.getState().downloads.map((d) => d.id))

  for (const req of requests) {
    try {
      const item = await window.api.startDownload(req)
      if (known.has(item.id)) result.duplicates++
      else {
        known.add(item.id)
        result.added++
      }
    } catch (err) {
      result.failed++
      toast(err instanceof Error ? err.message : t('home.startFailed'), 'error')
    }
  }
  return result
}

/** Queue one download and report the outcome. Returns true if anything moved. */
export async function queueDownload(req: DownloadRequest): Promise<boolean> {
  const { added, duplicates, failed } = await queue([req])
  if (failed) return false
  if (duplicates) {
    toast(t('queue.duplicate'), 'info')
    // Still a success from the user's point of view: the thing they asked for
    // is in the queue. Only the reason differs.
    return true
  }
  if (added) toast(t('home.addedToQueue'), 'success')
  return added > 0
}

/**
 * Queue a batch — a playlist, a selection of episodes, a list of pasted links.
 * Reports how many were added and, separately, how many were already there.
 */
export async function queueDownloads(requests: DownloadRequest[]): Promise<boolean> {
  const { added, duplicates, failed } = await queue(requests)
  if (!added && !duplicates) return false
  if (duplicates) {
    toast(t('queue.addedWithDuplicates', { count: added, duplicates }), added ? 'success' : 'info')
  } else {
    toast(t('playlist.added', { count: added }), 'success')
  }
  return added > 0 || (duplicates > 0 && failed === 0)
}
