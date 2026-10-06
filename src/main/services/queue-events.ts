import type { EventEmitter } from 'node:events'
import type { DownloadItem, DownloadProgress, DownloadsChanged } from '@shared/types'

/** Where the queue's events end up. ipc.ts wires these to the window and the OS. */
export interface QueueEventSink {
  /** One coalesced batch of updated and removed entries. */
  changed: (batch: DownloadsChanged) => void
  progress: (progress: DownloadProgress) => void
  /**
   * Desktop notifications. Called for every update, before any coalescing, and
   * never for a row read back from history.json, which finished in another session.
   */
  notify: (item: DownloadItem) => void
  /** An entry left the queue, so whatever was remembered about it can go. */
  forget: (id: string) => void
  /** The taskbar progress bar and keep-awake: once per message, not per entry. */
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
 * Progress is not batched - it is already rate-limited per item (throttle.ts) -
 * but it must never overtake an update that was emitted before it. A deferred
 * update carries the percent of its own moment, and arriving after a newer tick
 * it would wind the bar back and could even restore a state the download has
 * already left. So a progress message first sends whatever is pending.
 *
 * The downloader's own EventEmitter stays per entry; the automation pipeline
 * listens to it and needs every transition.
 */
export function forwardQueueEvents(
  events: EventEmitter,
  sink: QueueEventSink,
  defer: (flush: () => void) => void = (flush) => void setImmediate(flush)
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

  // Last event wins, exactly as if each had been delivered on its own.
  const enqueue = (item: DownloadItem): void => {
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
    updated.delete(id)
    removed.add(id)
    schedule()
  }
  const onProgress = (progress: DownloadProgress): void => {
    flush()
    sink.progress(progress)
    sink.syncOs()
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
  }
}
