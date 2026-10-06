import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { DownloadItem, DownloadProgress, DownloadsChanged } from '@shared/types'
import { forwardQueueEvents } from './queue-events'

function item(id: string, overrides: Partial<DownloadItem> = {}): DownloadItem {
  return {
    id,
    url: `https://example.com/${id}`,
    title: id,
    mode: 'video',
    state: 'queued',
    percent: 0,
    outputDir: '/tmp',
    createdAt: 1,
    ...overrides
  }
}

/** A wired-up forwarder whose deferred flush runs only when the test says so. */
function harness() {
  const events = new EventEmitter()
  const sent: Array<{ kind: 'changed'; batch: DownloadsChanged } | { kind: 'progress'; progress: DownloadProgress }> = []
  const notified: DownloadItem[] = []
  const forgotten: string[] = []
  let osSyncs = 0
  let pending: (() => void) | null = null
  forwardQueueEvents(
    events,
    {
      changed: (batch) => sent.push({ kind: 'changed', batch }),
      progress: (progress) => sent.push({ kind: 'progress', progress }),
      notify: (i) => notified.push(i),
      forget: (id) => forgotten.push(id),
      syncOs: () => osSyncs++
    },
    (flush) => {
      pending = flush
    }
  )
  return {
    events,
    sent,
    notified,
    forgotten,
    osSyncs: () => osSyncs,
    runDeferred: () => {
      const flush = pending
      pending = null
      flush?.()
    }
  }
}

describe('forwardQueueEvents', () => {
  /*
    The freeze this exists for: "clear finished" on 460 rows sent 460 messages,
    and the renderer redrew the whole queue for each one - 47 seconds of a
    window that ignored the mouse.
  */
  it('sends a bulk removal as one message', () => {
    const h = harness()
    for (let i = 0; i < 460; i++) h.events.emit('removed', `r${i}`)
    expect(h.sent).toHaveLength(0)
    h.runDeferred()
    expect(h.sent).toHaveLength(1)
    const [first] = h.sent
    expect(first.kind === 'changed' && first.batch.removed).toHaveLength(460)
    expect(h.osSyncs()).toBe(1)
  })

  it('keeps only the latest state of an entry updated several times in a turn', () => {
    const h = harness()
    h.events.emit('updated', item('a', { state: 'queued' }))
    h.events.emit('updated', item('a', { state: 'downloading' }))
    h.events.emit('updated', item('b'))
    h.runDeferred()
    expect(h.sent).toEqual([
      {
        kind: 'changed',
        batch: { updated: [item('a', { state: 'downloading' }), item('b')], removed: [] }
      }
    ])
  })

  it('lets a removal cancel the update queued before it, and an update the removal', () => {
    const h = harness()
    h.events.emit('updated', item('a'))
    h.events.emit('removed', 'a')
    h.events.emit('removed', 'b')
    h.events.emit('updated', item('b', { state: 'error' }))
    h.runDeferred()
    expect(h.sent).toEqual([
      { kind: 'changed', batch: { updated: [item('b', { state: 'error' })], removed: ['a'] } }
    ])
  })

  /*
    An update deferred past a newer progress tick would land second and wind
    the bar back to the percent of its own moment - or put a row that has just
    started downloading back to "queued".
  */
  it('never lets a progress message overtake an update emitted before it', () => {
    const h = harness()
    h.events.emit('updated', item('a', { state: 'queued', percent: 0 }))
    h.events.emit('progress', { id: 'a', state: 'downloading', percent: 12 })
    h.runDeferred()
    expect(h.sent.map((m) => m.kind)).toEqual(['changed', 'progress'])
    const [, tick] = h.sent
    expect(tick.kind === 'progress' && tick.progress.percent).toBe(12)
  })

  it('sends progress straight away when nothing is waiting', () => {
    const h = harness()
    h.events.emit('progress', { id: 'a', state: 'downloading', percent: 40 })
    expect(h.sent.map((m) => m.kind)).toEqual(['progress'])
    h.runDeferred()
    expect(h.sent).toHaveLength(1)
  })

  /*
    Coalescing keeps the last state per id. A download that completes and is
    retried in the same turn leaves the batch as "queued" - and the person
    was never told it had finished.
  */
  it('notifies for every update, including states a batch coalesces away', () => {
    const h = harness()
    h.events.emit('updated', item('a', { state: 'completed' }))
    h.events.emit('updated', item('a', { state: 'queued' }))
    expect(h.notified.map((i) => i.state)).toEqual(['completed', 'queued'])
    h.runDeferred()
    const [only] = h.sent
    expect(only.kind === 'changed' && only.batch.updated.map((i) => i.state)).toEqual(['queued'])
  })

  /*
    Rows history.json gives back once a lock on it clears finished in another
    session. Announcing them popped a toast for every finished and failed row
    in the file at once.
  */
  it('sends rows read back late from history without a notification', () => {
    const h = harness()
    h.events.emit('restored', item('old', { state: 'completed' }))
    h.events.emit('restored', item('broken', { state: 'error' }))
    h.events.emit('restored', item('dropped', { state: 'completed' }))
    h.events.emit('removed', 'dropped')
    expect(h.notified).toEqual([])
    h.runDeferred()
    expect(h.sent).toEqual([
      {
        kind: 'changed',
        batch: {
          updated: [item('old', { state: 'completed' }), item('broken', { state: 'error' })],
          removed: ['dropped']
        }
      }
    ])
  })

  it('forgets a removed entry as it goes, not when the batch leaves', () => {
    const h = harness()
    h.events.emit('removed', 'a')
    expect(h.forgotten).toEqual(['a'])
  })

  it('starts a fresh batch after each flush', () => {
    const h = harness()
    h.events.emit('removed', 'a')
    h.runDeferred()
    h.events.emit('removed', 'b')
    h.runDeferred()
    expect(h.sent).toEqual([
      { kind: 'changed', batch: { updated: [], removed: ['a'] } },
      { kind: 'changed', batch: { updated: [], removed: ['b'] } }
    ])
  })
})
