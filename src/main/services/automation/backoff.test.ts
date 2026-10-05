import { describe, expect, it } from 'vitest'
import type { Watch } from '@shared/automation'
import { backoffMinutes, isOfflineFailure, settleFailedCheck } from './backoff'

const NOW = 1_800_000_000_000
const MIN = 60_000

const watch = (extra: Partial<Watch> = {}): Watch => ({
  id: 'w',
  url: 'https://example.com/w',
  title: 'w',
  provider: 'yummyani',
  translatorId: 't',
  quality: '720p',
  enabled: true,
  intervalMinutes: 360,
  nextCheckAt: NOW - MIN,
  failures: 0,
  seen: [],
  steps: [{ id: 'd', kind: 'download', enabled: true }],
  createdAt: 1,
  ...extra
})

// What a page that cannot be reached looks like by the time it reaches the watcher.
const unreachable = (code: string): string =>
  `Could not reach example.com: the network is unreachable. Check your connection or proxy. (${code})`

/*
  Twelve times the interval, uncapped: a daily watch that hit a few short
  outages went twelve days without being looked at.
*/
describe('backoffMinutes', () => {
  it.each([
    // interval, failures, minutes until the next look
    [15, 0, 15],
    [15, 1, 30],
    [15, 4, 180],
    [360, 0, 360],
    [360, 1, 720],
    [360, 2, 1440],
    [360, 4, 1440],
    [1440, 0, 1440],
    [1440, 4, 1440],
    // A pace slower than a day is the watch's own business and is kept.
    [2880, 3, 2880]
  ])('every %i min after %i failures waits %i min', (interval, failures, minutes) => {
    expect(backoffMinutes(interval, failures)).toBe(minutes)
  })

  it('never asks a site more often than every fifteen minutes', () => {
    expect(backoffMinutes(1, 0)).toBe(15)
  })

  it('treats a count past the end of the table as the last step', () => {
    expect(backoffMinutes(60, 40)).toBe(backoffMinutes(60, 4))
  })
})

describe('isOfflineFailure', () => {
  it('believes the machine when it says it is offline, whatever the error', () => {
    expect(isOfflineFailure('HTTP 500', false)).toBe(true)
  })

  it('recognises the codes that mean no network at all', () => {
    expect(isOfflineFailure(unreachable('ERR_INTERNET_DISCONNECTED'), true)).toBe(true)
    expect(isOfflineFailure(unreachable('ERR_NETWORK_CHANGED'), true)).toBe(true)
    expect(isOfflineFailure(unreachable('ERR_ADDRESS_UNREACHABLE'), true)).toBe(true)
  })

  /*
    These are the far side failing - a refused connection was the one in the
    user's log - and backing off from a site that is down is right.
  */
  it('leaves failures on the far side to the backoff', () => {
    for (const code of [
      'ERR_CONNECTION_REFUSED',
      'ERR_CONNECTION_TIMED_OUT',
      'ERR_PROXY_CONNECTION_FAILED',
      'ERR_CERT_DATE_INVALID',
      'ERR_NAME_NOT_RESOLVED'
    ]) {
      expect(isOfflineFailure(unreachable(code), true), code).toBe(false)
    }
    expect(isOfflineFailure('No episodes found on the page.', true)).toBe(false)
  })
})

describe('settleFailedCheck', () => {
  const at = { now: NOW, jitter: 0 }

  /*
    A laptop that checked a few seconds after waking, before its Wi-Fi was
    back, doubled the wait of every overdue watch and wrote a network error
    over each of them.
  */
  it('does not count an offline failure, and tries again in fifteen minutes', () => {
    const w = watch({ failures: 2, lastError: 'an older problem' })
    const disconnected = settleFailedCheck(w, {
      ...at,
      why: unreachable('ERR_INTERNET_DISCONNECTED'),
      online: true,
      manual: false
    })
    expect(disconnected).toEqual({ kind: 'offline', patch: { nextCheckAt: NOW + 15 * MIN } })
    expect(settleFailedCheck(w, { ...at, why: 'anything', online: false, manual: false })).toEqual({
      kind: 'offline',
      patch: { nextCheckAt: NOW + 15 * MIN }
    })
  })

  it('counts a failure on the far side and backs off', () => {
    const { kind, patch } = settleFailedCheck(watch({ failures: 1 }), {
      ...at,
      why: unreachable('ERR_CONNECTION_REFUSED'),
      online: true,
      manual: false
    })
    expect(kind).toBe('counted')
    expect(patch.failures).toBe(2)
    expect(patch.lastError).toContain('ERR_CONNECTION_REFUSED')
    expect(patch.nextCheckAt).toBe(NOW + 1440 * MIN)
  })

  it('shows a failed "check now" without counting it or moving the schedule', () => {
    const settled = settleFailedCheck(watch({ failures: 1 }), {
      ...at,
      why: 'HTTP 503',
      online: true,
      manual: true
    })
    expect(settled).toEqual({ kind: 'manual', patch: { lastCheckedAt: NOW, lastError: 'HTTP 503' } })
  })
})
