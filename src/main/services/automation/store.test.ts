import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_RUNS, type Run, type Watch } from '@shared/automation'
import { addRun, addWatch, mergeWatches, removeWatch, updateRun, updateWatch, watchEvents } from './store'

/*
  The schedule writes to the watch list with nobody pressing anything, and
  this event is the only way the screen hears about it. Before it existed, a
  check that failed overnight drew no mark on the tab and a finished run sat on
  screen as "running" until somebody clicked.

  Fake timers keep the debounced write to disk from ever running: there is no
  Electron here to say where the file would go.
*/

const watch = (id: string): Watch => ({
  id,
  url: `https://example.com/${id}`,
  title: id,
  provider: 'yummyani',
  translatorId: 't',
  quality: '720p',
  enabled: true,
  intervalMinutes: 360,
  nextCheckAt: 0,
  failures: 0,
  seen: [],
  steps: [{ id: 'd', kind: 'download', enabled: true }],
  createdAt: 1
})

const run = (id: string, watchId: string): Run => ({
  id,
  watchId,
  season: 1,
  episode: 1,
  title: watchId,
  state: 'running',
  steps: [],
  startedAt: 1
})

describe('watchEvents', () => {
  let heard = 0
  const listen = (): void => {
    heard++
  }

  beforeEach(() => {
    vi.useFakeTimers()
    heard = 0
    watchEvents.on('changed', listen)
  })

  afterEach(() => {
    watchEvents.off('changed', listen)
    vi.useRealTimers()
  })

  it('speaks once for each watch added, changed or removed', () => {
    addWatch(watch('a'))
    expect(heard).toBe(1)
    updateWatch('a', { lastError: 'the page moved' })
    expect(heard).toBe(2)
    removeWatch('a')
    expect(heard).toBe(3)
  })

  it('speaks once for each run added or moved along', () => {
    addWatch(watch('b'))
    heard = 0
    addRun(run('r1', 'b'))
    expect(heard).toBe(1)
    updateRun('r1', { state: 'done' })
    expect(heard).toBe(2)
  })

  /*
    A write that found nothing to change must stay quiet, or a stray update
    for a run that has since been trimmed would refetch every window for
    nothing.
  */
  it('stays quiet when there was nothing to change', () => {
    updateRun('no-such-run', { state: 'failed' })
    updateWatch('no-such-watch', { failures: 3 })
    removeWatch('no-such-watch')
    expect(heard).toBe(0)
  })
})

/*
  watches.json could not be read when the app started, so the list began
  empty in memory and nothing was saved over the file. Once it can be read,
  what the session added goes in beside what the file held.
*/
describe('mergeWatches', () => {
  it('keeps every stored watch and adds the ones this session made', () => {
    const stored = { watches: [watch('kept')], runs: { kept: [run('k1', 'kept')] } }
    const interim = { watches: [watch('new')], runs: { new: [run('n1', 'new')] } }
    const merged = mergeWatches(stored, interim)
    expect(merged.watches.map((w) => w.id)).toEqual(['kept', 'new'])
    expect(merged.runs.kept.map((r) => r.id)).toEqual(['k1'])
    expect(merged.runs.new.map((r) => r.id)).toEqual(['n1'])
  })

  it('does not double a watch or a run that is already in the file', () => {
    const stored = { watches: [watch('a')], runs: { a: [run('r1', 'a')] } }
    const interim = { watches: [watch('a')], runs: { a: [run('r1', 'a'), run('r2', 'a')] } }
    const merged = mergeWatches(stored, interim)
    expect(merged.watches).toHaveLength(1)
    expect(merged.runs.a.map((r) => r.id)).toEqual(['r1', 'r2'])
  })

  it('keeps the run history to its usual length', () => {
    const many = Array.from({ length: MAX_RUNS }, (_, n) => run(`old-${n}`, 'a'))
    const merged = mergeWatches({ watches: [], runs: { a: many } }, { watches: [], runs: { a: [run('new', 'a')] } })
    expect(merged.runs.a).toHaveLength(MAX_RUNS)
    expect(merged.runs.a[merged.runs.a.length - 1].id).toBe('new')
  })
})
