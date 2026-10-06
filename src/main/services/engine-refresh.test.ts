import { describe, expect, it, vi } from 'vitest'
import {
  afterFailure,
  afterSuccess,
  parseRefreshState,
  REFRESH_INTERVAL,
  refreshDue,
  retryDelay,
  runRefresh,
  type RefreshState
} from './engine-refresh'

const HOUR = 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 6, 12, 0, 0)

function state(extra: Partial<RefreshState> = {}): RefreshState {
  return { lastRefresh: 0, lastFailure: 0, failures: 0, ...extra }
}

describe('parseRefreshState', () => {
  it('reads what older builds wrote, which had no failures', () => {
    expect(parseRefreshState({ lastRefresh: 1790941475830 })).toEqual(
      state({ lastRefresh: 1790941475830 })
    )
  })

  it('treats a missing or damaged file as never refreshed', () => {
    expect(parseRefreshState(undefined)).toEqual(state())
    expect(parseRefreshState('garbage')).toEqual(state())
    expect(parseRefreshState({ lastRefresh: 'yesterday', failures: -3, lastFailure: NaN })).toEqual(
      state()
    )
  })
})

describe('refreshDue', () => {
  it('is due on a first run', () => {
    expect(refreshDue(state(), NOW)).toBe(true)
  })

  it('waits a day after a good refresh', () => {
    expect(refreshDue(state({ lastRefresh: NOW - 23 * HOUR }), NOW)).toBe(false)
    expect(refreshDue(state({ lastRefresh: NOW - REFRESH_INTERVAL }), NOW)).toBe(true)
  })

  it('backs off after failures instead of retrying on every hourly tick', () => {
    const once = state({ lastRefresh: NOW - 3 * 24 * HOUR, lastFailure: NOW - HOUR, failures: 1 })
    expect(refreshDue(once, NOW)).toBe(false)
    expect(refreshDue(once, NOW + HOUR)).toBe(true)

    const often = { ...once, failures: 5 }
    expect(refreshDue(often, NOW + HOUR)).toBe(false)
    expect(refreshDue(often, NOW + 3 * HOUR)).toBe(true)
  })

  it('does not let a clock moved back hold the refresh off', () => {
    expect(refreshDue(state({ lastRefresh: NOW + 30 * 24 * HOUR }), NOW)).toBe(true)
    expect(refreshDue(state({ lastFailure: NOW + HOUR, failures: 2 }), NOW)).toBe(true)
  })
})

describe('retryDelay', () => {
  it('is two hours after one failure and four after more', () => {
    expect(retryDelay(0)).toBe(0)
    expect(retryDelay(1)).toBe(2 * HOUR)
    expect(retryDelay(2)).toBe(4 * HOUR)
    expect(retryDelay(40)).toBe(4 * HOUR)
  })
})

describe('afterSuccess and afterFailure', () => {
  it('a success clears the failures', () => {
    expect(afterSuccess(NOW)).toEqual(state({ lastRefresh: NOW }))
  })

  it('a failure keeps the last good refresh and counts itself', () => {
    const before = state({ lastRefresh: NOW - 2 * 24 * HOUR, failures: 1, lastFailure: NOW - 3 * HOUR })
    expect(afterFailure(before, NOW, true)).toEqual({
      lastRefresh: before.lastRefresh,
      lastFailure: NOW,
      failures: 2
    })
  })

  it('an offline failure counts for nothing', () => {
    const before = state({ lastRefresh: NOW - 2 * 24 * HOUR })
    expect(afterFailure(before, NOW, false)).toEqual(before)
  })
})

describe('runRefresh', () => {
  function steps(code: number, opts: { busy?: boolean; download?: () => Promise<void> } = {}) {
    return {
      selfUpdate: vi.fn(async () => code),
      download: vi.fn(opts.download ?? (async () => undefined)),
      isBusy: vi.fn(() => opts.busy ?? false)
    }
  }

  it('is done when the self-update exits 0, without downloading anything', async () => {
    const s = steps(0)
    expect(await runRefresh(s)).toEqual({ kind: 'done', via: 'self-update' })
    expect(s.download).not.toHaveBeenCalled()
  })

  it('falls back to a fresh download when the self-update fails, and is done only once that succeeds', async () => {
    const s = steps(100)
    expect(await runRefresh(s)).toEqual({ kind: 'done', via: 'fresh download' })
    expect(s.download).toHaveBeenCalledOnce()
  })

  it('is a failure when the fallback fails too', async () => {
    const s = steps(100, {
      download: async () => {
        throw new Error('Failed to download yt-dlp (HTTP 403)')
      }
    })
    expect(await runRefresh(s)).toEqual({
      kind: 'failed',
      code: 100,
      error: 'Failed to download yt-dlp (HTTP 403)'
    })
  })

  it('never replaces the file once a download has started using it', async () => {
    const s = steps(1, { busy: true })
    expect(await runRefresh(s)).toEqual({ kind: 'busy', code: 1 })
    expect(s.download).not.toHaveBeenCalled()
  })
})
