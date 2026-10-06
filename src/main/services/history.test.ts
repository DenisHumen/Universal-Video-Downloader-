import { describe, expect, it } from 'vitest'
import type { DownloadItem } from '@shared/types'
import { finishedBeyond, forHistory, HISTORY_LOG_CHARS, isFinished, isHistoryEntry } from './history'

const row = (id: string, overrides: Partial<DownloadItem> = {}): DownloadItem => ({
  id,
  url: `https://example.com/${id}`,
  title: id,
  mode: 'video',
  state: 'completed',
  percent: 100,
  outputDir: '/downloads',
  createdAt: 0,
  ...overrides
})

describe('isFinished', () => {
  // Exactly what "clear finished" clears: a failure is still owed an answer.
  it('counts completed and cancelled rows, and nothing else', () => {
    expect(isFinished('completed')).toBe(true)
    expect(isFinished('canceled')).toBe(true)
    for (const state of ['error', 'queued', 'detecting', 'downloading', 'processing', 'paused'] as const) {
      expect(isFinished(state)).toBe(false)
    }
  })
})

describe('forHistory', () => {
  const long = 'x'.repeat(HISTORY_LOG_CHARS) + 'the last line'

  it('keeps only the tail of a completed row’s log', () => {
    const kept = forHistory(row('a', { log: long }))
    expect(kept.log).toHaveLength(HISTORY_LOG_CHARS)
    expect(kept.log?.endsWith('the last line')).toBe(true)
  })

  it('leaves a failure’s log whole, since the explanation is in it', () => {
    expect(forHistory(row('a', { state: 'error', log: long })).log).toBe(long)
  })

  it('does not copy a row it has nothing to change on', () => {
    const short = row('a', { log: 'done' })
    expect(forHistory(short)).toBe(short)
  })

  it('does not change the row the queue still holds', () => {
    const live = row('a', { log: long })
    forHistory(live)
    expect(live.log).toBe(long)
  })
})

describe('isHistoryEntry', () => {
  it('accepts anything with an id, and nothing without one', () => {
    expect(isHistoryEntry(row('a'))).toBe(true)
    expect(isHistoryEntry({ id: 'bare' })).toBe(true)
    expect(isHistoryEntry(null)).toBe(false)
    expect(isHistoryEntry('a')).toBe(false)
    expect(isHistoryEntry({ id: '' })).toBe(false)
    expect(isHistoryEntry({ id: 7 })).toBe(false)
    expect(isHistoryEntry([{ id: 'a' }])).toBe(false)
  })
})

describe('finishedBeyond', () => {
  it('keeps everything when there is no limit', () => {
    const rows = [row('a'), row('b'), row('c')]
    expect(finishedBeyond(rows, 0)).toEqual([])
    expect(finishedBeyond(rows, Number.NaN)).toEqual([])
    expect(finishedBeyond(rows, -5)).toEqual([])
  })

  it('names the oldest finished rows beyond the limit, oldest first', () => {
    const rows = [
      row('newest', { finishedAt: 400 }),
      row('old', { finishedAt: 100 }),
      row('older', { finishedAt: 50 }),
      row('middle', { state: 'canceled', finishedAt: 300 })
    ]
    expect(finishedBeyond(rows, 2)).toEqual(['older', 'old'])
  })

  it('never counts or drops a row that is not finished', () => {
    const rows = [
      row('done-1', { finishedAt: 10 }),
      row('done-2', { finishedAt: 20 }),
      row('failed', { state: 'error', createdAt: 1 }),
      row('queued', { state: 'queued', createdAt: 1 }),
      row('paused', { state: 'paused', createdAt: 1 }),
      row('running', { state: 'downloading', createdAt: 1 })
    ]
    expect(finishedBeyond(rows, 1)).toEqual(['done-1'])
    expect(finishedBeyond(rows, 2)).toEqual([])
  })

  // Rows saved by older builds have no finish time.
  it('falls back to when a row was created', () => {
    const rows = [row('legacy', { createdAt: 5 }), row('recent', { finishedAt: 50, createdAt: 1 })]
    expect(finishedBeyond(rows, 1)).toEqual(['legacy'])
  })
})
