import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'
import type { DownloadItem } from '@shared/types'
import { awaitDownload, DownloadStopped, type QueueView } from './await-download'

const item = (state: DownloadItem['state'], extra: Partial<DownloadItem> = {}): DownloadItem => ({
  id: 'd1',
  url: 'https://example.com/e1',
  title: 'e1',
  mode: 'video',
  state,
  percent: 0,
  outputDir: 'C:/dl',
  createdAt: 1,
  ...extra
})

function queue(...items: DownloadItem[]): QueueView & { items: Map<string, DownloadItem> } {
  const map = new Map(items.map((i) => [i.id, i]))
  return { events: new EventEmitter(), get: (id) => map.get(id), items: map }
}

/** Whether a promise has settled yet, without waiting for it to. */
async function settled(p: Promise<unknown>): Promise<boolean> {
  let done = false
  p.then(
    () => (done = true),
    () => (done = true)
  )
  await Promise.resolve()
  await Promise.resolve()
  return done
}

describe('awaitDownload', () => {
  /*
    The duplicate check hands back the existing queue item, and that item can
    already be finished. Only later events were ever listened for, so the
    watcher waited for ever on a download that was done.
  */
  it('resolves at once for an item that has already completed', async () => {
    const q = queue(item('completed', { filepath: 'C:/dl/e1.mp4' }))
    await expect(awaitDownload('d1', q)).resolves.toMatchObject({ filepath: 'C:/dl/e1.mp4' })
    expect(q.events.listenerCount('updated')).toBe(0)
  })

  it('rejects at once for an item that already failed or was cancelled', async () => {
    await expect(awaitDownload('d1', queue(item('error', { error: 'HTTP 403' })))).rejects.toThrow(
      'HTTP 403'
    )
    await expect(awaitDownload('d1', queue(item('canceled')))).rejects.toThrow('cancelled')
  })

  it('rejects an id the queue has never heard of instead of waiting for it', async () => {
    const q = queue()
    await expect(awaitDownload('d1', q)).rejects.toThrow('not in the queue')
    expect(q.events.listenerCount('updated')).toBe(0)
    expect(q.events.listenerCount('removed')).toBe(0)
  })

  it('waits for an item that is still going, and resolves when it finishes', async () => {
    const q = queue(item('downloading'))
    const wait = awaitDownload('d1', q)
    q.events.emit('updated', item('downloading', { id: 'someone-else' }))
    q.events.emit('updated', item('completed', { id: 'someone-else' }))
    expect(await settled(wait)).toBe(false)
    q.events.emit('updated', item('completed'))
    await expect(wait).resolves.toMatchObject({ state: 'completed' })
  })

  it('rejects when the item is removed from the queue', async () => {
    const q = queue(item('queued'))
    const wait = awaitDownload('d1', q)
    q.events.emit('removed', 'd1')
    await expect(wait).rejects.toThrow('removed')
  })

  /*
    Somebody stopping a download on purpose is not a failure: retried at the
    next check, the episode came straight back after they had cancelled it.
    The pipeline tells the two apart by type.
  */
  it('says a cancel or a removal was somebody stopping it, and a failure was not', async () => {
    await expect(awaitDownload('d1', queue(item('canceled')))).rejects.toBeInstanceOf(DownloadStopped)
    const q = queue(item('queued'))
    const removed = awaitDownload('d1', q)
    q.events.emit('removed', 'd1')
    await expect(removed).rejects.toMatchObject({ how: 'removed' })
    const failed = awaitDownload('d1', queue(item('error', { error: 'HTTP 403' })))
    await expect(failed).rejects.not.toBeInstanceOf(DownloadStopped)
  })

  /*
    A paused download parked its run as "running" with nothing anywhere saying
    why. The pipeline is told, so the run can point at the queue - and is told
    again when it moves, so the note does not outlive the pause.
  */
  it('says when the item is paused, found that way or paused later, and when it moves again', async () => {
    const onPause = vi.fn()
    const onResume = vi.fn()
    const q = queue(item('paused'))
    const wait = awaitDownload('d1', q, { onPause, onResume })
    expect(onPause).toHaveBeenCalledTimes(1)

    q.events.emit('updated', item('paused'))
    expect(onPause).toHaveBeenCalledTimes(1)

    q.events.emit('updated', item('queued'))
    q.events.emit('updated', item('downloading'))
    expect(onResume).toHaveBeenCalledTimes(1)

    q.events.emit('updated', item('paused'))
    expect(onPause).toHaveBeenCalledTimes(2)
    expect(await settled(wait)).toBe(false)
  })
})
