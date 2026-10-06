import { describe, expect, it } from 'vitest'
import {
  attemptsAt,
  isFinalAttempt,
  MAX_ATTEMPTS,
  settleEpisode,
  type EpisodeRef,
  type Watch
} from './automation'

/*
  Every failure used to mark its episode handled on the spot. An installed
  app lost an episode for good that way - one failed download, never tried
  again - and so would any upload refused while a NAS was asleep.
*/

const watch = (over: Partial<Watch> = {}): Watch => ({
  id: 'w1',
  url: 'https://example.com/series',
  title: 'Series',
  provider: 'yummyani',
  translatorId: 't',
  quality: '720p',
  enabled: true,
  intervalMinutes: 360,
  nextCheckAt: 0,
  failures: 0,
  seen: [{ season: 1, episode: 1 }],
  steps: [{ id: 'd', kind: 'download', enabled: true }],
  createdAt: 1,
  ...over
})

const e4: EpisodeRef = { season: 1, episode: 4 }

/** Apply what a go leaves on the watch, as the watcher does. */
const after = (w: Watch, outcome: Parameters<typeof settleEpisode>[2]): Watch => ({
  ...w,
  ...settleEpisode(w, e4, outcome)
})

describe('settleEpisode', () => {
  it('leaves a failed episode unhandled, counted, until the cap', () => {
    let w = watch()
    for (let go = 1; go < MAX_ATTEMPTS; go++) {
      w = after(w, 'failed')
      expect(w.seen).toHaveLength(1)
      expect(attemptsAt(w, e4)).toBe(go)
    }
    w = after(w, 'failed')
    expect(w.seen).toContainEqual(e4)
    expect(w.attempts).toBeUndefined()
  })

  it('marks it handled and forgets the count once a retry gets through', () => {
    const w = after(watch({ attempts: { s1e4: 2, s1e5: 1 } }), 'done')
    expect(w.seen).toContainEqual(e4)
    expect(w.attempts).toEqual({ s1e5: 1 })
  })

  // Somebody cancelled it in the queue; the next check must not fetch it again behind their back.
  it('treats a skipped episode as handled', () => {
    expect(after(watch(), 'skipped').seen).toContainEqual(e4)
  })

  // A paused watch fetches the episode again once it is resumed.
  it('changes nothing for an episode stopped by pausing or removing the watch', () => {
    expect(settleEpisode(watch({ attempts: { s1e4: 1 } }), e4, 'stopped')).toBeUndefined()
  })

  it('never lists an episode twice, however often it is retried by hand', () => {
    const handled = watch({ seen: [e4] })
    expect(after(handled, 'done').seen).toEqual([e4])
    expect(after(handled, 'failed').seen).toEqual([e4])
    expect(after(handled, 'failed').attempts).toBeUndefined()
  })
})

describe('isFinalAttempt', () => {
  it('is the go that reaches the cap', () => {
    expect(isFinalAttempt(watch(), e4)).toBe(false)
    expect(isFinalAttempt(watch({ attempts: { s1e4: MAX_ATTEMPTS - 1 } }), e4)).toBe(true)
  })

  // Only "try again" reaches a handled episode, and nothing on a schedule follows it.
  it('is every go at an episode already handled', () => {
    expect(isFinalAttempt(watch({ seen: [e4] }), e4)).toBe(true)
  })
})
