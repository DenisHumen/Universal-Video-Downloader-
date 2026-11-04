import type { EventEmitter } from 'node:events'
import type { DownloadItem, DownloadProgress, DownloadsChanged } from '@shared/types'
import { coalesce } from './coalesce'

/**
 * How long progress ticks gather before they cross to the window as one message.
 *
 * Each download is already held to four ticks a second (throttle.ts), but that
 * limit is per download: twenty at once were eighty messages a second, every
 * one a task in the renderer that copied the queue and redrew it. Gathered over
 * this window they are at most eight, whatever the number of downloads - and
 * 120 ms is still well under the point where a bar starts to look like it jumps.
 */
export const PROGRESS_FLUSH_MS = 120

/** Where the queue's events end up. ipc.ts wires these to the window and the OS. */
export interface QueueEventSink {
  /** One coalesced batch of updated and removed entries. */
  changed: (batch: DownloadsChanged) => void
  /** The latest tick of every download that moved, gathered over PROGRESS_FLUSH_MS. */
  progress: (batch: DownloadProgress[]) => void
  /**
   * Desktop notifications. Called for every update, before any coalescing, and
   * never for a row read back from history.json, which finished in another session.
   */
  notify: (item: DownloadItem) => void
  /** An entry left the queue, so whatever was remembered about it can go. */
  forget: (id: string) => void
  /** The taskbar progress bar and keep-awake: once per message, not per entry or tick. */
  syncOs: () => void
}

/**
 * Forward the downloader's events to the window, one message per turn instead
 * of one per entry.
 *
 * Bulk actions are loops over the queue - "clear finished" emits a removal per
 * entry, "pause all", "resume all" and "retry failed" an update per entry - and
 * each of those used to cross to the renderer as its own message. Every message
 * is a separate task there, and every task replaced the list and redrew the
 * queue: clearing 460 finished rows kept the window busy for about 47 seconds,
 * in back-to-back tasks of 100 ms that left it ignoring the mouse. Everything
 * emitted in one turn now leaves on the next as a single DownloadsChanged, and
 * the renderer applies it in one update.
 *
 * Coalescing keeps only the latest state per id, so the side effects that need
 * to see every state run per event, not per batch: a download that completes
 * and is retried in the same turn still gets its notification.
 *
 * Progress is gathered too, on a short timer rather than a turn: the latest
 * tick per id, all of them in one message every PROGRESS_FLUSH_MS. Neither kind
 * of message may overtake the other for the same row. A deferred update carries
 * the percent of its own moment, and arriving after a newer tick it would wind
 * the bar back and could even restore a state the download has already left -
 * so a progress tick first sends whatever updates are pending. The other way
 * round, a held tick arriving after the update that finished its download would
 * put the row back to "downloading" - so an update for a row with a tick still
 * held sends the ticks first. A tick that changes the row's kind (its state,
 * phase or step, or the bar reaching the end) is not held at all, and a removal
 * simply drops the row's held tick.
 *
 * The downloader's own EventEmitter stays per entry; the automation pipeline
 * listens to it and needs every transition.
 */
export function forwardQueueEvents(
  events: EventEmitter,
  sink: QueueEventSink,
  defer: (flush: () => void) => void = (flush) => void setImmediate(flush),
  progressWindowMs = PROGRESS_FLUSH_MS
): () => void {
  const updated = new Map<string, DownloadItem>()
  const removed = new Set<string>()
  let scheduled = false

  const flush = (): void => {
    scheduled = false
    if (!updated.size && !removed.size) return
    const batch: DownloadsChanged = { updated: [...updated.values()], removed: [...removed] }
    updated.clear()
    removed.clear()
    sink.changed(batch)
    sink.syncOs()
  }
  const schedule = (): void => {
    if (scheduled) return
    scheduled = true
    defer(flush)
  }

  // Latest tick per id; a Map keeps the order each row first moved in.
  const ticks = new Map<string, DownloadProgress>()
  // The kind of the last tick seen per id, held or sent, so a change of kind is not held.
  const kinds = new Map<string, string>()
  const flushProgress = (): void => {
    if (!ticks.size) return
    const batch = [...ticks.values()]
    ticks.clear()
    sink.progress(batch)
    sink.syncOs()
  }
  // Not pushed back by later ticks, or a steady stream would never be sent.
  const scheduleProgress = coalesce(flushProgress, progressWindowMs)

  // Last event wins, exactly as if each had been delivered on its own.
  const enqueue = (item: DownloadItem): void => {
    if (ticks.has(item.id)) flushProgress()
    removed.delete(item.id)
    updated.set(item.id, item)
    schedule()
  }
  const onUpdated = (item: DownloadItem): void => {
    sink.notify(item)
    enqueue(item)
  }
  /*
    A row history.json gave back late, once a lock on it cleared. New to the
    window, so it rides in the batch like any new row; old news to the person,
    so it skips the notifications, which would otherwise announce every finished
    and failed row in the file at once.
  */
  const onRestored = (item: DownloadItem): void => enqueue(item)
  const onRemoved = (id: string): void => {
    sink.forget(id)
    ticks.delete(id)
    kinds.delete(id)
    updated.delete(id)
    removed.add(id)
    schedule()
  }
  const onProgress = (progress: DownloadProgress): void => {
    flush()
    ticks.set(progress.id, progress)
    const kind = kindOf(progress)
    const changed = kinds.get(progress.id) !== kind
    kinds.set(progress.id, kind)
    if (changed) flushProgress()
    else scheduleProgress()
  }

  events.on('updated', onUpdated)
  events.on('restored', onRestored)
  events.on('removed', onRemoved)
  events.on('progress', onProgress)
  return () => {
    events.off('updated', onUpdated)
    events.off('restored', onRestored)
    events.off('removed', onRemoved)
    events.off('progress', onProgress)
    ticks.clear()
    kinds.clear()
  }
}

/**
 * What a row looks like apart from its figures: the moments its whole
 * appearance turns on, which are never worth holding back. See throttle.ts.
 */
function kindOf(p: DownloadProgress): string {
  return [p.state, p.phase ?? '', p.postprocess ?? '', p.indeterminate ? 1 : 0, p.percent >= 100 ? 1 : 0].join('|')
}
