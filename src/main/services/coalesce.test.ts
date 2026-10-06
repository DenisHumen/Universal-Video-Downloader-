import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { coalesce } from './coalesce'

/*
  This sits between every write to the watch list and a message to every
  window. Too eager, and a run moving through its steps floods the renderer
  with refetches; too patient, and the screen never hears about anything.
*/
describe('coalesce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('folds a burst into one call at the end of the window', () => {
    const work = vi.fn()
    const poke = coalesce(work, 300)
    for (let i = 0; i < 10; i++) poke()
    expect(work).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('does nothing when nothing happened', () => {
    const work = vi.fn()
    coalesce(work, 300)
    vi.advanceTimersByTime(10_000)
    expect(work).not.toHaveBeenCalled()
  })

  it('starts a fresh window for a call after the last one fired', () => {
    const work = vi.fn()
    const poke = coalesce(work, 300)
    poke()
    vi.advanceTimersByTime(300)
    poke()
    vi.advanceTimersByTime(300)
    expect(work).toHaveBeenCalledTimes(2)
  })

  /*
    The reason this is not a debounce: a debounce restarts its timer on every
    call, so a steady stream - one write every 50 ms for as long as an episode
    keeps moving - would hold the screen frozen until it stopped.
  */
  it('is not starved by a steady stream of calls', () => {
    const work = vi.fn()
    const poke = coalesce(work, 300)
    for (let t = 0; t < 3000; t += 50) {
      poke()
      vi.advanceTimersByTime(50)
      // The first one lands on time, not once the stream dries up.
      if (t + 50 === 300) expect(work).toHaveBeenCalledTimes(1)
    }
    // And then one per window.
    expect(work).toHaveBeenCalledTimes(10)
  })

  it('never calls more than once inside a window', () => {
    const work = vi.fn()
    const poke = coalesce(work, 300)
    poke()
    vi.advanceTimersByTime(299)
    poke()
    expect(work).toHaveBeenCalledTimes(0)
    vi.advanceTimersByTime(1)
    expect(work).toHaveBeenCalledTimes(1)
    poke()
    vi.advanceTimersByTime(299)
    expect(work).toHaveBeenCalledTimes(1)
  })
})
