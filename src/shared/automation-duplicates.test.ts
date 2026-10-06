import { describe, expect, it } from 'vitest'
import {
  exactDuplicate,
  inheritedSeen,
  newEpisodes,
  sameDub,
  watchingAlready,
  type EpisodeRef,
  type Watch
} from './automation'

/*
  Nothing stopped the same series and dub being watched twice - adding from the
  home screen a series already on the watch screen was enough. The two copies
  asked the queue for the same file, the first rename moved it, and the second
  run failed; when their checks did not overlap, every episode was fetched,
  uploaded and announced twice.
*/

const URL = 'https://yummyani.me/catalog/item/tabakoshka'

const ep = (episode: number, season = 1): EpisodeRef => ({ season, episode })

const watch = (over: Partial<Watch> = {}): Watch => ({
  id: 'w1',
  url: URL,
  title: 'Табакошка',
  provider: 'yummyani',
  translatorId: 'dub-a',
  quality: '720p',
  enabled: true,
  intervalMinutes: 360,
  nextCheckAt: 0,
  failures: 0,
  seen: [],
  steps: [{ id: 'd', kind: 'download', enabled: true }],
  createdAt: 1,
  ...over
})

describe('sameDub', () => {
  it('matches the same series in the same dub', () => {
    expect(sameDub(watch(), watch({ id: 'w2' }))).toBe(true)
  })

  // The home screen hands over the link it resolved; the watch kept the one somebody pasted.
  it('sees past a tracking parameter and a trailing slash', () => {
    expect(sameDub(watch(), watch({ url: `${URL}/?utm_source=tg` }))).toBe(true)
  })

  it('tells dubs apart, since they carry different episodes', () => {
    expect(sameDub(watch(), watch({ translatorId: 'dub-b' }))).toBe(false)
  })

  it('tells series and providers apart', () => {
    expect(sameDub(watch(), watch({ url: 'https://yummyani.me/catalog/item/other' }))).toBe(false)
    expect(sameDub(watch(), watch({ provider: 'rezka' }))).toBe(false)
  })
})

describe('watchingAlready', () => {
  it('finds the watch following this series in this dub', () => {
    const list = [watch({ id: 'other', translatorId: 'dub-b' }), watch({ id: 'mine' })]
    expect(watchingAlready(list, { provider: 'yummyani', url: URL, translatorId: 'dub-a' })?.id).toBe(
      'mine'
    )
  })

  it('finds nothing when the dub is a different one', () => {
    expect(
      watchingAlready([watch()], { provider: 'yummyani', url: URL, translatorId: 'dub-b' })
    ).toBeUndefined()
  })

  // Nothing is out, so neither has a dub: the same title waited for twice is still twice.
  it('matches a title already being waited for', () => {
    const waiting = watch({ pending: true, translatorId: '' })
    expect(watchingAlready([waiting], { provider: 'yummyani', url: URL, translatorId: '' })).toBe(
      waiting
    )
  })
})

describe('exactDuplicate', () => {
  it('refuses a copy with the same series, dub and quality', () => {
    const existing = watch()
    expect(exactDuplicate([existing], { ...watch({ id: 'new' }) })).toBe(existing)
  })

  // Another quality is a deliberate second watch, not a mistake.
  it('lets the same series and dub in at another quality', () => {
    expect(exactDuplicate([watch()], watch({ quality: '1080p' }))).toBeUndefined()
  })

  it('lets another dub of the same series in', () => {
    expect(exactDuplicate([watch()], watch({ translatorId: 'dub-b' }))).toBeUndefined()
  })

  // There is no dub to compare until something is out.
  it('never counts a waiting watch as a copy', () => {
    const waiting = watch({ pending: true, translatorId: '' })
    expect(exactDuplicate([waiting], watch({ pending: true, translatorId: '' }))).toBeUndefined()
  })
})

describe('inheritedSeen', () => {
  /*
    A second watch on a series - for another quality or another share - began
    with nothing seen, so its first check fetched a check's worth of episodes the
    first watch had long since delivered.
  */
  it('starts a second watch from what the first one has handled', () => {
    const first = watch({ seen: [ep(1), ep(2), ep(3)] })
    const seen = inheritedSeen([first], { ...watch({ quality: '1080p' }), seen: [] })
    expect(seen).toEqual([ep(1), ep(2), ep(3)])
  })

  it('keeps what the new watch already marked, without counting anything twice', () => {
    const first = watch({ seen: [ep(1), ep(2)] })
    const seen = inheritedSeen([first], { ...watch({ quality: '1080p' }), seen: [ep(2), ep(4)] })
    expect(seen).toEqual([ep(2), ep(4), ep(1)])
  })

  it('takes nothing from a watch on another dub', () => {
    const other = watch({ translatorId: 'dub-b', seen: [ep(1), ep(2)] })
    expect(inheritedSeen([other], { ...watch(), seen: [] })).toEqual([])
  })

  /*
    What the "also download the episodes already out" box counts: the dub's
    list less what a watch on it has handled, which is what the first check of
    the new watch will then fetch.
  */
  it('leaves only the episodes nobody has fetched for the back catalogue', () => {
    const first = watch({ seen: [ep(1), ep(2)] })
    const out = [ep(1), ep(2), ep(3), ep(4)]
    const handled = inheritedSeen([first], { ...watch({ quality: '1080p' }), seen: [] })
    expect(newEpisodes(handled, out)).toEqual([ep(3), ep(4)])
  })
})
