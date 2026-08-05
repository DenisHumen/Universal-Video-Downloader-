import type { DownloadItem } from '@shared/types'

/**
 * The order waiting items should start in.
 *
 * First-in first-out, because that is what a queue means to the person who
 * filled it — with one escape hatch. Priority exists for the single case FIFO
 * handles badly: fifty videos queued for later and one that is needed now.
 *
 * Ties break on `createdAt`, so bumping two items keeps them in the order they
 * were bumped rather than shuffling them arbitrarily.
 *
 * Pure on purpose: the scheduler itself has to know about running processes and
 * retry timers, none of which can be constructed in a test.
 */
export function pendingOrder(items: DownloadItem[]): DownloadItem[] {
  return items
    .filter((item) => item.state === 'queued')
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.createdAt - b.createdAt)
}
