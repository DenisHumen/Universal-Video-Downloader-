import type { EventEmitter } from 'events'
import type { DownloadItem } from '@shared/types'

/**
 * Waiting for a queue item to finish, for the automation's download step.
 *
 * Apart from the pipeline so it can be tested with a plain emitter: the real
 * queue is the downloader, which cannot be loaded without Electron.
 */

/** The parts of the download queue this needs: its events, and a way to look an item up. */
export interface QueueView {
  events: EventEmitter
  get(id: string): DownloadItem | undefined
}

export interface WaitHooks {
  /** The item is paused - found that way, or paused while it was being waited for. */
  onPause?(item: DownloadItem): void
  /** It is moving again after a pause. */
  onResume?(item: DownloadItem): void
}

const terminal = (state: DownloadItem['state']): boolean =>
  state === 'completed' || state === 'error' || state === 'canceled'

/**
 * Resolve with the finished item, or reject with why it did not finish.
 *
 * Subscribes first and looks second. A very short download can be over before
 * the first event arrives, and an item handed back by the duplicate check may
 * have finished long ago; only events after the subscription are ever heard,
 * so without the look a watcher waited for ever on a download that was done.
 * An id the queue has never heard of is rejected for the same reason.
 *
 * There is deliberately no timeout. A paused download is the user's to resume,
 * and giving up on it would mark the episode handled while a download nobody
 * is waiting for finishes on its own.
 */
export function awaitDownload(id: string, queue: QueueView, hooks: WaitHooks = {}): Promise<DownloadItem> {
  return new Promise((resolve, reject) => {
    let paused = false

    const stop = (): void => {
      queue.events.off('updated', onUpdate)
      queue.events.off('removed', onRemoved)
    }

    const settle = (item: DownloadItem): void => {
      stop()
      if (item.state === 'completed') resolve(item)
      else if (item.state === 'canceled') reject(new Error('The download was cancelled.'))
      else reject(new Error(item.error || 'The download failed.'))
    }

    const onUpdate = (item: DownloadItem): void => {
      if (item.id !== id) return
      if (terminal(item.state)) return settle(item)
      if (item.state === 'paused' && !paused) {
        paused = true
        hooks.onPause?.(item)
      } else if (item.state !== 'paused' && paused) {
        paused = false
        hooks.onResume?.(item)
      }
    }

    const onRemoved = (removedId: string): void => {
      if (removedId !== id) return
      stop()
      reject(new Error('The download was removed from the queue.'))
    }

    queue.events.on('updated', onUpdate)
    queue.events.on('removed', onRemoved)

    const now = queue.get(id)
    if (!now) {
      stop()
      reject(new Error('The download is not in the queue.'))
      return
    }
    onUpdate(now)
  })
}
