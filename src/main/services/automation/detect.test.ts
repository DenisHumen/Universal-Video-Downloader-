import { describe, expect, it } from 'vitest'
import { downloadUrlFor, withEpisodesOf } from './detect'
import type { Watch } from '@shared/automation'
import type { StreamingInfo } from '@shared/types'

const watch = (over: Partial<Watch>): Watch => ({
  id: 'w1',
  url: 'https://rezka.ag/animation/adventures/92915-chernyy-klever-tv-2-2026.html',
  title: 'Black Clover',
  provider: 'rezka',
  translatorId: '19',
  quality: '720p',
  enabled: true,
  intervalMinutes: 360,
  nextCheckAt: 0,
  failures: 0,
  seen: [],
  steps: [],
  createdAt: 0,
  ...over
})

/*
  A rezka watch keeps the page address it was made from. The episode link was
  made by splicing that whole address in where the host and title id belong,
  translator left out — `uvd-rezka://https://rezka.ag/…html/2/1/720p` — while
  rezka was unreachable and nobody could notice. The first episode a rezka
  watch found would have been queued as something nothing could resolve.
*/
describe('downloadUrlFor', () => {
  it('builds a rezka episode link the resolver can read', () => {
    const link = downloadUrlFor(watch({}), { season: 2, episode: 1 })
    expect(link).toBe('uvd-rezka://rezka.ag/92915/19/2/1/720p')
  })

  it('leaves the yummyani shape as it was', () => {
    const w = watch({ provider: 'yummyani', url: 'https://yummyani.me/catalog/item/x', translatorId: 'abc' })
    expect(downloadUrlFor(w, { season: 1, episode: 4 })).toBe('uvd-yummy://abc/4/720p')
  })

  it('downloads a followed Kodik season through the Kodik resolver', () => {
    // A Kodik season can be followed now, and without its own case here every
    // episode it found would have thrown "No way to download an episode".
    const w = watch({ provider: 'kodik', url: 'https://kodikplayer.com/season/94795/d5a2/720p', translatorId: 'abc' })
    expect(downloadUrlFor(w, { season: 1, episode: 4 })).toBe('uvd-kodik://abc/4/720p')
  })
})

const rezkaInfo = (over: Partial<StreamingInfo> = {}): StreamingInfo => ({
  provider: 'rezka',
  host: 'rezka.ag',
  id: '646',
  title: 'Breaking Bad',
  isSeries: true,
  translators: [
    { id: '565', name: 'TVShows' },
    { id: '56', name: 'Дубляж' }
  ],
  defaultTranslator: '565',
  seasons: [{ season: 1, episodes: [1, 2, 3] }],
  qualities: ['720p'],
  ...over
})

/*
  A rezka page lists the episodes of the dub it opens on, and that list used to
  stand in for every dub. The request for a dub's own list is only ever made
  for rezka, and never for a dub the page no longer offers.
*/
describe('withEpisodesOf', () => {
  it('leaves a provider that lists every dub alone', async () => {
    const info = rezkaInfo({ provider: 'yummyani' })
    expect(await withEpisodesOf(info, '56')).toBe(info)
  })

  it('has nothing to ask about a film', async () => {
    const info = rezkaInfo({ isSeries: false })
    expect(await withEpisodesOf(info, '56')).toBe(info)
  })

  it('says a followed dub is gone, rather than following the page’s list', async () => {
    await expect(withEpisodesOf(rezkaInfo(), '999')).rejects.toThrow(/no longer listed/)
  })
})
