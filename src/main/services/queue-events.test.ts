import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadItem, DownloadProgress, DownloadsChanged } from '@shared/types'
import { PROGRESS_FLUSH_MS, forwardQueueEvents } from './queue-events'

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
  const sent: Array<{ kind: 'changed'; batch: DownloadsChanged } | { kind: 'progress'; batch: DownloadProgress[] }> = []
  const notified: DownloadItem[] = []
  const forgotten: string[] = []
  let osSyncs = 0
  let pending: (() => void) | null = null
  forwardQueueEvents(
    events,
    {
      changed: (batch) => sent.push({ kind: 'changed', batch }),
      progress: (batch) => sent.push({ kind: 'progress', batch }),
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
    expect(tick.kind === 'progress' && tick.batch.map((p) => p.percent)).toEqual([12])
  })

  it("sends a row's first tick straight away when nothing is waiting", () => {
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

describe('forwardQueueEvents progress batching', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const tick = (id: string, percent: number, overrides: Partial<DownloadProgress> = {}): DownloadProgress => ({
    id,
    state: 'downloading',
    phase: 'download',
    percent,
    ...overrides
  })
  const progressMessages = (h: ReturnType<typeof harness>): DownloadProgress[][] =>
    h.sent.flatMap((m) => (m.kind === 'progress' ? [m.batch] : []))

  /*
    Twenty downloads at four ticks a second each were eighty messages a second,
    every one a copy of the queue and a redraw in the renderer.
  */
  it('gathers ticks from many downloads into one message per window, latest per row', () => {
    const h = harness()
    for (let i = 0; i < 20; i++) h.events.emit('progress', tick(`d${i}`, 1))
    // A row's first tick is a change of kind and goes at once; drop those.
    h.sent.length = 0
    for (let round = 2; round <= 5; round++) {
      for (let i = 0; i < 20; i++) h.events.emit('progress', tick(`d${i}`, round))
    }
    expect(h.sent).toHaveLength(0)
    vi.advanceTimersByTime(PROGRESS_FLUSH_MS - 1)
    expect(h.sent).toHaveLength(0)
    vi.advanceTimersByTime(1)
    const batches = progressMessages(h)
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(20)
    expect(batches[0].every((p) => p.percent === 5)).toBe(true)
  })

  it('does not push the window back while ticks keep coming', () => {
    const h = harness()
    h.events.emit('progress', tick('a', 1))
    h.sent.length = 0
    for (let t = 0; t < PROGRESS_FLUSH_MS * 3; t += 10) {
      h.events.emit('progress', tick('a', 2 + t / 10))
      vi.advanceTimersByTime(10)
    }
    expect(progressMessages(h)).toHaveLength(3)
  })

  it('syncs the OS once per progress message, not per tick', () => {
    const h = harness()
    h.events.emit('progress', tick('a', 1))
    h.events.emit('progress', tick('b', 1))
    const before = h.osSyncs()
    h.events.emit('progress', tick('a', 2))
    h.events.emit('progress', tick('b', 2))
    h.events.emit('progress', tick('a', 3))
    vi.advanceTimersByTime(PROGRESS_FLUSH_MS)
    expect(h.osSyncs()).toBe(before + 1)
  })

  it('sends nothing for a window with no ticks', () => {
    const h = harness()
    vi.advanceTimersByTime(PROGRESS_FLUSH_MS * 10)
    expect(h.sent).toHaveLength(0)
  })

  /*
    A tick held past the update that finished the download would land second
    and put a completed row back to "downloading" at 97%.
  */
  it('sends a held tick before an update for the same row', () => {
    const h = harness()
    h.events.emit('progress', tick('a', 10))
    h.events.emit('progress', tick('a', 97))
    h.events.emit('updated', item('a', { state: 'completed', percent: 100 }))
    h.runDeferred()
    expect(h.sent.map((m) => m.kind)).toEqual(['progress', 'progress', 'changed'])
    expect(progressMessages(h)[1].map((p) => p.percent)).toEqual([97])
    // Nothing is left to arrive late.
    vi.advanceTimersByTime(PROGRESS_FLUSH_MS)
    expect(h.sent).toHaveLength(3)
  })

  it('holds ticks of other rows across an update that does not concern them', () => {
    const h = harness()
    h.events.emit('progress', tick('a', 10))
    h.events.emit('progress', tick('a', 20))
    h.events.emit('updated', item('b', { state: 'queued' }))
    h.runDeferred()
    expect(h.sent.map((m) => m.kind)).toEqual(['progress', 'changed'])
    vi.advanceTimersByTime(PROGRESS_FLUSH_MS)
    expect(h.sent.map((m) => m.kind)).toEqual(['progress', 'changed', 'progress'])
  })

  it('sends a change of kind at once, with whatever else is held', () => {
    const h = harness()
    h.events.emit('progress', tick('a', 10))
    h.events.emit('progress', tick('b', 10))
    h.sent.length = 0
    h.events.emit('progress', tick('b', 40))
    h.events.emit('progress', tick('a', 90, { phase: 'postprocess', postprocess: 'merge' }))
    const batches = progressMessages(h)
    expect(batches).toHaveLength(1)
    expect(batches[0].map((p) => [p.id, p.percent])).toEqual([
      ['b', 40],
      ['a', 90]
    ])
  })

  it('treats a state carried by a tick as a change of kind', () => {
    const h = harness()
    h.events.emit('progress', tick('a', 10))
    h.sent.length = 0
    h.events.emit('progress', tick('a', 12, { state: 'paused' }))
    expect(progressMessages(h)).toHaveLength(1)
  })

  it('drops the held tick of a removed row', () => {
    const h = harness()
    h.events.emit('progress', tick('a', 10))
    h.sent.length = 0
    h.events.emit('progress', tick('a', 20))
    h.events.emit('removed', 'a')
    h.runDeferred()
    vi.advanceTimersByTime(PROGRESS_FLUSH_MS)
    expect(h.sent).toEqual([{ kind: 'changed', batch: { updated: [], removed: ['a'] } }])
  })

  it('still sends pending updates before a tick, then holds the tick', () => {
    const h = harness()
    h.events.emit('progress', tick('a', 10))
    h.sent.length = 0
    h.events.emit('updated', item('a', { title: 'renamed', state: 'downloading', percent: 10 }))
    h.events.emit('progress', tick('a', 30))
    expect(h.sent.map((m) => m.kind)).toEqual(['changed'])
    vi.advanceTimersByTime(PROGRESS_FLUSH_MS)
    expect(h.sent.map((m) => m.kind)).toEqual(['changed', 'progress'])
  })
})
