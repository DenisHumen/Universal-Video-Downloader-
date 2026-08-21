import { describe, expect, it } from 'vitest'
import type { DownloadProgress } from '@shared/types'
import { markOf, shouldEmitProgress, PROGRESS_INTERVAL_MS } from './throttle'

function progress(overrides: Partial<DownloadProgress> = {}): DownloadProgress {
  return { id: 'a', state: 'downloading', percent: 10, phase: 'download', ...overrides }
}

describe('shouldEmitProgress', () => {
  it('always sends the first update for an item', () => {
    expect(shouldEmitProgress(undefined, progress(), 1000)).toBe(true)
  })

  it('holds back a figure creeping up inside one phase', () => {
    const mark = markOf(progress({ percent: 10 }), 1000)
    expect(shouldEmitProgress(mark, progress({ percent: 11 }), 1000 + 40)).toBe(false)
  })

  it('lets it through once the interval has passed', () => {
    const mark = markOf(progress({ percent: 10 }), 1000)
    expect(shouldEmitProgress(mark, progress({ percent: 11 }), 1000 + PROGRESS_INTERVAL_MS)).toBe(true)
  })

  /*
    The rest of these are the reason this is a function and not a timer: rate
    limiting must never swallow a change of kind, because those are the moments
    the row's whole appearance turns on.
  */
  it('never delays a change of state', () => {
    const mark = markOf(progress({ state: 'downloading' }), 1000)
    expect(shouldEmitProgress(mark, progress({ state: 'processing' }), 1001)).toBe(true)
  })

  it('never delays the hand-over to post-processing', () => {
    const mark = markOf(progress({ phase: 'download' }), 1000)
    expect(shouldEmitProgress(mark, progress({ phase: 'postprocess' }), 1001)).toBe(true)
  })

  it('never delays the step being named, or renamed', () => {
    const mark = markOf(progress({ phase: 'postprocess' }), 1000)
    expect(
      shouldEmitProgress(mark, progress({ phase: 'postprocess', postprocess: 'merge' }), 1001)
    ).toBe(true)
  })

  it('never delays a phase losing or regaining its figure', () => {
    const mark = markOf(progress({ indeterminate: false }), 1000)
    expect(shouldEmitProgress(mark, progress({ indeterminate: true }), 1001)).toBe(true)
  })

  it('never delays the end of the bar', () => {
    const mark = markOf(progress({ percent: 90 }), 1000)
    expect(shouldEmitProgress(mark, progress({ percent: 100 }), 1001)).toBe(true)
  })

  it('does not re-send a bar that is already full', () => {
    const mark = markOf(progress({ percent: 100 }), 1000)
    expect(shouldEmitProgress(mark, progress({ percent: 100 }), 1001)).toBe(false)
  })
})
