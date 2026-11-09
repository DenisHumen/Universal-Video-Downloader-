import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLinkInbox } from './link-inbox'

describe('links sent from outside', () => {
  const hand = vi.fn()
  const raise = vi.fn()
  beforeEach(() => {
    vi.useFakeTimers()
    hand.mockClear()
    raise.mockClear()
  })
  afterEach(() => void vi.useRealTimers())

  it('hands the first one over at once', () => {
    createLinkInbox({ hand, raise }, 1000).take('https://example.com/1')
    expect(hand.mock.calls).toEqual([['https://example.com/1']])
    expect(raise).toHaveBeenCalledTimes(1)
  })

  it('folds a flood into the first and the last, with the window raised for each and no more', () => {
    const inbox = createLinkInbox({ hand, raise }, 1000)
    for (let i = 0; i < 500; i++) inbox.take(`https://example.com/${i}`)
    expect(hand).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(hand.mock.calls).toEqual([['https://example.com/0'], ['https://example.com/499']])
    expect(raise).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(10_000)
    expect(hand).toHaveBeenCalledTimes(2)
  })

  it('stays at one a window for as long as a flood lasts', () => {
    const inbox = createLinkInbox({ hand, raise }, 1000)
    for (let i = 0; i < 1000; i++) {
      inbox.take(`https://example.com/${i}`)
      vi.advanceTimersByTime(10)
    }
    expect(hand.mock.calls.length).toBeLessThanOrEqual(11)
    expect(raise.mock.calls.length).toBe(hand.mock.calls.length)
  })

  it('does not hand the same link over twice for a double click', () => {
    const inbox = createLinkInbox({ hand, raise }, 1000)
    inbox.take('https://example.com/1')
    inbox.take('https://example.com/1')
    vi.advanceTimersByTime(5000)
    expect(hand).toHaveBeenCalledTimes(1)
  })

  it('takes a link sent after the quiet again', () => {
    const inbox = createLinkInbox({ hand, raise }, 1000)
    inbox.take('https://example.com/1')
    vi.advanceTimersByTime(2000)
    inbox.take('https://example.com/1')
    expect(hand).toHaveBeenCalledTimes(2)
  })
})
