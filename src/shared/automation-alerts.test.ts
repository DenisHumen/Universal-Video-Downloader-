import { describe, expect, it } from 'vitest'
import { migrateWatches, settleRunError, watchFailing, watchTrouble, type Watch } from './automation'

const watch = (over: Partial<Watch> = {}): Watch => ({
  id: 'w1',
  url: 'https://old.yummyani.me/catalog/item/tabakoshka',
  title: 'Табакошка',
  provider: 'yummyani',
  translatorId: 'tid',
  quality: '720p',
  enabled: true,
  intervalMinutes: 360,
  nextCheckAt: 1000,
  failures: 0,
  seen: [],
  steps: [{ id: 'd', kind: 'download', enabled: true }],
  createdAt: 500,
  ...over
})

/*
  The list, its dot and the mark on the tab used to read `lastError` alone,
  which only a check writes. An episode failing on its way to the share left
  no trace outside that watch's history: six failed runs sat beside a watch
  that read "lastError: null, failures: 0".
*/
describe('watchTrouble', () => {
  it('reports a failed episode, not only a failed check', () => {
    expect(watchTrouble(watch({ lastRunError: 'access denied' }))).toBe('access denied')
  })

  it('puts a failed check first, since nothing gets through until it is fixed', () => {
    expect(watchTrouble(watch({ lastError: 'page moved', lastRunError: 'access denied' }))).toBe(
      'page moved'
    )
  })

  it('has nothing to say about a healthy watch', () => {
    expect(watchTrouble(watch())).toBeUndefined()
    expect(watchTrouble(watch({ lastError: '', lastRunError: '' }))).toBeUndefined()
  })
})

describe('watchFailing', () => {
  it('counts a watch whose last episode failed', () => {
    expect(watchFailing(watch({ lastRunError: 'access denied' }))).toBe(true)
  })

  it('does not count a paused watch, whatever it last did', () => {
    expect(watchFailing(watch({ enabled: false, lastError: 'page moved' }))).toBe(false)
  })
})

/*
  A failed episode is marked handled and never retried, so for a weekly
  series nothing on the schedule would lower the flag for a week after the
  password was fixed. These are the ways a person lowers it.
*/
describe('settleRunError', () => {
  const cleared = { lastRunError: undefined, lastRunFailedAt: undefined }

  it('clears it when the steps are edited, which is how a chain gets fixed', () => {
    expect(settleRunError({ steps: [] })).toMatchObject(cleared)
  })

  it('clears it on pause and on resume', () => {
    expect(settleRunError({ enabled: false })).toMatchObject(cleared)
    expect(settleRunError({ enabled: true })).toMatchObject(cleared)
  })

  it('clears it from the dismiss button', () => {
    const out = settleRunError({ lastRunError: undefined, lastRunFailedAt: undefined })
    expect(out).toEqual(cleared)
  })

  it('never lets the screen write a failure of its own', () => {
    expect(settleRunError({ lastRunError: 'made up', lastRunFailedAt: 5 })).toEqual(cleared)
  })

  it('leaves it alone for a change that fixes nothing', () => {
    const patch = { intervalMinutes: 60 }
    expect(settleRunError(patch)).toBe(patch)
    expect('lastRunError' in settleRunError(patch)).toBe(false)
  })

  it('keeps the rest of the change', () => {
    expect(settleRunError({ enabled: false, intervalMinutes: 60 })).toMatchObject({
      enabled: false,
      intervalMinutes: 60
    })
  })
})

describe('migrateWatches, for a failed episode', () => {
  // The flag has to survive a restart, or quitting the app would be a way to hide it.
  it('keeps the failure and when it happened', () => {
    const [w] = migrateWatches({
      watches: [watch({ lastRunError: 'access denied', lastRunFailedAt: 1234 })],
      runs: {}
    }).watches
    expect(w.lastRunError).toBe('access denied')
    expect(w.lastRunFailedAt).toBe(1234)
  })
})
