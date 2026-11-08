import type { DownloadItem, DownloadProgress, DownloadsChanged } from '@shared/types'

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

/**
 * Apply one batch of progress ticks to the queue: one copy, one store update.
 *
 * Ticks for rows the list does not hold (removed since) are ignored, and a
 * batch that touches nothing returns the same array. Later ticks for an id win,
 * though main already sends only the latest per id.
 */
export function applyDownloadProgress(list: DownloadItem[], batch: DownloadProgress[]): DownloadItem[] {
  if (!batch.length) return list
  const at = new Map<string, number>()
  list.forEach((item, i) => at.set(item.id, i))
  let next: DownloadItem[] | null = null
  for (const p of batch) {
    const i = at.get(p.id)
    if (i === undefined) continue
    next ??= list.slice()
    next[i] = {
      ...next[i],
      state: p.state,
      percent: p.percent,
      // Which half of the job is running, and whether it can say how far along
      // it is. Post-processing reports neither speed nor a percentage, so these
      // are what stop the row looking frozen.
      phase: p.phase,
      postprocess: p.postprocess,
      indeterminate: p.indeterminate,
      speed: p.speed,
      eta: p.eta,
      downloadedBytes: p.downloadedBytes,
      totalBytes: p.totalBytes
    }
  }
  return next ?? list
}

/**
 * A failed recording whose partial can still be made into a file, by Stop and
 * Save on its row. Not when saving is what failed, or found nothing.
 */
export function failedRecordingCanBeSaved(item: DownloadItem): boolean {
  return (
    Boolean(item.live) &&
    item.state === 'error' &&
    Boolean(item.partialPaths?.length) &&
    !item.keptPartial &&
    item.errorCode !== 'liveEmpty'
  )
}

const LIVE: ReadonlySet<DownloadItem['state']> = new Set(['detecting', 'downloading', 'processing', 'queued', 'waiting'])

/**
 * What Home shows under its field once there is a history: the jobs moving
 * now, running ones before the ones still waiting, at most `limit`.
 */
export function liveDownloads(list: DownloadItem[], limit = 3): DownloadItem[] {
  const rank = (d: DownloadItem): number => (d.state === 'queued' ? 1 : 0)
  return list
    .filter((d) => LIVE.has(d.state))
    .sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt)
    .slice(0, limit)
}

/** What failed and is still owed an answer, newest first. */
export function recentFailed(list: DownloadItem[], limit = 3): DownloadItem[] {
  return list
    .filter((d) => d.state === 'error')
    .sort((a, b) => (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt))
    .slice(0, limit)
}

/** The last `limit` finished downloads, newest first. */
export function recentFinished(list: DownloadItem[], limit = 5): DownloadItem[] {
  return list
    .filter((d) => d.state === 'completed')
    .sort((a, b) => (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt))
    .slice(0, limit)
}

/**
 * The overall progress of what is downloading, 0-100, or null when nothing is.
 * Each running item counts the same, whatever its size: the sizes are often
 * unknown, and a single figure that jumps when one is learned reads as a bug.
 */
export function overallPercent(list: DownloadItem[]): number | null {
  const running = list.filter((d) => d.state === 'downloading' || d.state === 'processing')
  if (!running.length) return null
  const sum = running.reduce((n, d) => n + Math.min(100, Math.max(0, d.percent || 0)), 0)
  return Math.round(sum / running.length)
}

/** Below this a cancel costs next to nothing, and asking would only be in the way. */
const CANCEL_ASKS_ABOVE_PERCENT = 10

/**
 * Whether cancelling this row throws away something worth keeping, and so has
 * to ask first. A paused row is one somebody meant to come back to; a recording
 * has no percentage, only what it has fetched so far. A trim or a convert works
 * on a file that stays where it is, and can simply be run again.
 */
export function cancelLosesWork(
  item: Pick<DownloadItem, 'state' | 'percent' | 'downloadedBytes' | 'indeterminate' | 'kind'>
): boolean {
  if (item.kind === 'trim' || item.kind === 'convert') return false
  const percent = item.percent || 0
  const bytes = item.downloadedBytes || 0
  if (percent > CANCEL_ASKS_ABOVE_PERCENT) return true
  if (item.state === 'paused') return percent > 0 || bytes > 0
  return Boolean(item.indeterminate) && bytes > 0
}

/** The sections the queue is drawn in when nothing is filtered out. */
export type QueueGroup = 'active' | 'failed' | 'done'

export function queueGroupOf(state: DownloadItem['state']): QueueGroup {
  if (state === 'completed') return 'done'
  if (state === 'error' || state === 'canceled') return 'failed'
  return 'active'
}

const GROUP_ORDER: QueueGroup[] = ['active', 'failed', 'done']

/**
 * The queue in sections - what is moving, what needs a look, what is done -
 * each in the order it was listed in. A finished download no longer sits
 * between two running ones, and a failure no longer hides twenty rows down
 * among the successes.
 */
export function groupQueue(list: DownloadItem[]): DownloadItem[] {
  const rank = (d: DownloadItem): number => GROUP_ORDER.indexOf(queueGroupOf(d.state))
  // Array.prototype.sort is stable, so each section keeps the list's own order.
  return [...list].sort((a, b) => rank(a) - rank(b))
}
