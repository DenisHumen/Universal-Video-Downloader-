import type { DownloadItem, DownloadState } from '@shared/types'

/**
 * What the download history keeps on disk, and how much of it.
 *
 * Nothing used to bound it. Every finished row stayed for good with up to four
 * kilobytes of engine output, and the whole list was parsed before the window
 * opened, rewritten on the main thread after every change of state and sent to
 * the window in one piece. The automation adds a row per episode with nobody
 * watching, so the file only ever grew: measured at seven megabytes and twenty
 * milliseconds a save for two thousand rows.
 *
 * Apart from the downloader so it can be tested without Electron.
 */

/** The engine-output tail a completed row keeps across a restart. */
export const HISTORY_LOG_CHARS = 1000

/**
 * What "clear finished" clears, and so what the keep-finished limit counts.
 *
 * A failure is not finished in this sense: it is the row still owed an answer,
 * with the error text and the retry on it, and it goes only when somebody
 * clears it on purpose.
 */
export function isFinished(state: DownloadState): boolean {
  return state === 'completed' || state === 'canceled'
}

/**
 * An item as history.json stores it.
 *
 * A completed row's log is only there for its details drawer, where the last
 * lines are the ones anybody reads; the rest is progress chatter. Anything not
 * completed keeps the whole tail, because a failure's explanation is in it.
 */
export function forHistory(item: DownloadItem): DownloadItem {
  if (item.state !== 'completed' || !item.log || item.log.length <= HISTORY_LOG_CHARS) return item
  return { ...item, log: item.log.slice(-HISTORY_LOG_CHARS) }
}

/**
 * Whether an entry read back from history.json can be a queue row at all.
 *
 * One `null` in the array used to throw halfway through loading and lose every
 * row after it. The rest of an entry's fields are optional or repaired on load.
 */
export function isHistoryEntry(raw: unknown): raw is DownloadItem {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false
  const id = (raw as { id?: unknown }).id
  return typeof id === 'string' && id !== ''
}

/** When a row finished, for deciding which is oldest. Rows from older builds may lack the time. */
const finishedTime = (item: DownloadItem): number => item.finishedAt ?? item.createdAt ?? 0

/**
 * The ids of the finished rows beyond the newest `keep`, oldest first.
 *
 * Nothing unfinished is ever counted or returned: a queued, running, paused or
 * failed row stays whatever the limit. Zero, or anything that is not a positive
 * number, means no limit.
 */
export function finishedBeyond(items: Iterable<DownloadItem>, keep: number): string[] {
  if (!(keep > 0)) return []
  const finished = [...items].filter((item) => isFinished(item.state))
  if (finished.length <= keep) return []
  return finished
    .sort((a, b) => finishedTime(a) - finishedTime(b))
    .slice(0, finished.length - keep)
    .map((item) => item.id)
}
