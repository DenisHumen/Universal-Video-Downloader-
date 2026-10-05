import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTicker } from './ticker'

/*
  The watcher used to be started once at launch and never stopped, so none of
  this was ever exercised. Now the automation switch starts and stops it while
  the app runs, and the two ways that goes wrong are both silent: a wake-up
  listener left behind by each stop, which doubles every check after the next
  wake, and a pending tick that fires after the user has switched schedules off.
*/

function setup() {
  const wake = new EventEmitter()
  const tick = vi.fn()
  const onWake = vi.fn()
  const ticker = createTicker({ tick, everyMs: 60_000, firstAfterMs: 5_000, wake, onWake })
  return { wake, tick, onWake, ticker }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createTicker', () => {
  it('keeps exactly one wake-up listener however often it is started and stopped', () => {
    const { wake, tick, ticker } = setup()
    for (let i = 0; i < 5; i++) {
      ticker.start()
      ticker.start()
      expect(wake.listenerCount('resume')).toBe(1)
      ticker.stop()
      ticker.stop()
      expect(wake.listenerCount('resume')).toBe(0)
    }

    // And the one that is left after a final start runs one tick per wake, not six.
    ticker.start()
    wake.emit('resume')
    expect(tick).toHaveBeenCalledTimes(1)
  })

  it('ticks early after a start, then on the interval', () => {
    const { tick, ticker } = setup()
    ticker.start()
    vi.advanceTimersByTime(5_000)
    expect(tick).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60_000)
    expect(tick).toHaveBeenCalledTimes(2)
  })

  it('leaves nothing pending once stopped, not even the early tick', () => {
    // Switched off a second after launch: the five-second tick must not fire.
    const { wake, tick, onWake, ticker } = setup()
    ticker.start()
    vi.advanceTimersByTime(1_000)
    ticker.stop()

    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(10 * 60_000)
    wake.emit('resume')
    expect(tick).not.toHaveBeenCalled()
    expect(onWake).not.toHaveBeenCalled()
    expect(ticker.running()).toBe(false)
  })

  it('looks straight away on a wake while running', () => {
    // A machine that has been asleep is exactly the one whose watches are overdue.
    const { wake, tick, onWake, ticker } = setup()
    ticker.start()
    wake.emit('resume')
    expect(onWake).toHaveBeenCalledTimes(1)
    expect(tick).toHaveBeenCalledTimes(1)
  })

  it('says whether a call changed anything', () => {
    const { ticker } = setup()
    expect(ticker.start()).toBe(true)
    expect(ticker.start()).toBe(false)
    expect(ticker.running()).toBe(true)
    expect(ticker.stop()).toBe(true)
    expect(ticker.stop()).toBe(false)
  })
})
