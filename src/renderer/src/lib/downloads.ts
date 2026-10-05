import type { DownloadItem, DownloadsChanged } from '@shared/types'

/**
 * Apply one batch from the main process to the queue, in a single pass.
 *
 * The list used to change one message at a time: a lookup by scanning, a copy
 * of the whole array and a redraw of the queue for every entry a bulk action
 * touched. A batch is now one lookup table, one copy and one store update,
 * however many entries it carries.
 *
 * Entries the list does not know yet are new downloads. They go on top, newest
 * first, which is the order `listDownloads` restores on launch - so a batch of
 * fifty queued at once reads the same now as it will after a restart.
 *
 * A batch that touches nothing in the list (only removals of rows already
 * gone) returns the same array, so nothing redraws for it.
 */
export function applyDownloadsChanged(
  list: DownloadItem[],
  change: DownloadsChanged
): DownloadItem[] {
  const removed = new Set(change.removed)
  const at = new Map<string, number>()
  list.forEach((item, i) => at.set(item.id, i))

  const next = list.slice()
  const fresh = new Map<string, DownloadItem>()
  let merged = false
  for (const item of change.updated) {
    if (removed.has(item.id)) continue
    const i = at.get(item.id)
    if (i === undefined) {
      fresh.set(item.id, { ...fresh.get(item.id), ...item })
    } else {
      next[i] = { ...next[i], ...item }
      merged = true
    }
  }

  const kept = removed.size ? next.filter((item) => !removed.has(item.id)) : next
  if (!merged && !fresh.size && kept.length === list.length) return list
  if (!fresh.size) return kept
  const added = [...fresh.values()].sort((a, b) => b.createdAt - a.createdAt)
  return [...added, ...kept]
}
