import { describe, expect, it } from 'vitest'
import { streamUrl } from './streaming'

/*
  The picker built its queue addresses with a yummyani-or-else-rezka ternary,
  so any third provider would have been queued as rezka episodes that nothing
  could resolve.
*/
describe('streamUrl', () => {
  const rezka = { provider: 'rezka' as const, host: 'rezka.ag', id: '92915' }

  it('builds the rezka shape, with the season and the title it belongs to', () => {
    expect(streamUrl(rezka, '19', '720', { season: 2, episode: 1 })).toBe(
      'uvd-rezka://rezka.ag/92915/19/2/1/720'
    )
    expect(streamUrl(rezka, '19', 'best')).toBe('uvd-rezka://rezka.ag/92915/19/movie/0/best')
  })

  it('builds the YummyAnime shape, where the dub already names the season', () => {
    const yummy = { provider: 'yummyani' as const, host: 'old.yummyani.me', id: '10661' }
    expect(streamUrl(yummy, 'abc', '480', { season: 1, episode: 4 })).toBe('uvd-yummy://abc/4/480')
    expect(streamUrl(yummy, 'abc', 'best')).toBe('uvd-yummy://abc/1/best')
  })

  it('sends a Kodik player to its own resolver, not to YummyAnime', () => {
    // Re-resolved as uvd-yummy, a pasted player would be filed under YummyAnime.
    const kodik = { provider: 'kodik' as const, host: 'kodikplayer.com', id: '94795' }
    expect(streamUrl(kodik, 'abc', '720', { season: 1, episode: 4 })).toBe('uvd-kodik://abc/4/720')
    expect(streamUrl(kodik, 'abc', 'best')).toBe('uvd-kodik://abc/1/best')
  })

  it('sends an AniLiberty release to its own resolver, the alias standing for the dub', () => {
    const anilib = { provider: 'aniliberty' as const, host: 'aniliberty.top', id: 'some-show' }
    expect(streamUrl(anilib, 'some-show', '1080', { season: 1, episode: 4 })).toBe(
      'uvd-anilib://some-show/4/1080'
    )
  })

  it('downloads an AniLiberty film as the one episode the picker lists, whatever its number', () => {
    // Defaulting to episode one, as the others do, would ask for an episode the release lacks.
    const film = {
      provider: 'aniliberty' as const,
      host: 'aniliberty.top',
      id: 'some-film',
      seasons: [{ season: 1, episodes: [5] }]
    }
    expect(streamUrl(film, 'some-film', 'best')).toBe('uvd-anilib://some-film/5/best')
  })
})
