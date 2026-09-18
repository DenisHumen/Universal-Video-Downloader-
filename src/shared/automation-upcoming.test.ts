import { describe, expect, it } from 'vitest'
import { daysUntil, migrateWatches, upcomingDelayMinutes } from './automation'

const DAY = 86_400_000
const NOW = 1_800_000_000_000

/*
  Following something that is not out yet. The interesting decisions are all
  about time: how often to look at a date that moves, and what to say once that
  date has gone by with nothing to show for it.
*/
describe('upcomingDelayMinutes', () => {
  it('looks once a day while the release is more than a day off', () => {
    expect(upcomingDelayMinutes(NOW + 36 * DAY, 360, NOW)).toBe(1440)
    // Even for a watch set to check every fifteen minutes: weeks out, that is noise.
    expect(upcomingDelayMinutes(NOW + 36 * DAY, 15, NOW)).toBe(1440)
  })

  it("drops to the watch's own pace inside the last day", () => {
    expect(upcomingDelayMinutes(NOW + DAY / 2, 360, NOW)).toBe(360)
    expect(upcomingDelayMinutes(NOW + DAY / 2, 60, NOW)).toBe(60)
  })

  it('keeps that pace once the date has passed, because dates slip', () => {
    expect(upcomingDelayMinutes(NOW - 3 * DAY, 360, NOW)).toBe(360)
  })

  it('looks daily when the site gives no date at all', () => {
    expect(upcomingDelayMinutes(undefined, 360, NOW)).toBe(1440)
  })

  it('never asks more often than the floor every watch has', () => {
    expect(upcomingDelayMinutes(NOW + 1000, 1, NOW)).toBe(15)
  })
})

describe('daysUntil', () => {
  it('rounds up, so the last partial day still counts as one', () => {
    expect(daysUntil(NOW + 36 * DAY, NOW)).toBe(36)
    expect(daysUntil(NOW + 36 * DAY + 1, NOW)).toBe(37)
    expect(daysUntil(NOW + 1, NOW)).toBe(1)
  })

  it('stops at zero rather than counting backwards', () => {
    expect(daysUntil(NOW - 5 * DAY, NOW)).toBe(0)
  })
})

describe('migrateWatches, for a watch that is still waiting', () => {
  it('keeps the waiting state and the date across a restart', () => {
    const stored = {
      id: 'w',
      url: 'https://example.test/x',
      provider: 'yummyani',
      title: 'Not out yet',
      translatorId: '',
      quality: '720p',
      enabled: true,
      intervalMinutes: 360,
      nextCheckAt: 0,
      failures: 0,
      seen: [],
      steps: [{ id: 'd', kind: 'download', enabled: true }],
      createdAt: 1,
      pending: true,
      releaseAt: NOW + 36 * DAY
    }
    const [back] = migrateWatches({ watches: [stored] }).watches
    expect(back.pending).toBe(true)
    expect(back.releaseAt).toBe(NOW + 36 * DAY)
    expect(back.translatorId).toBe('')
  })
})
