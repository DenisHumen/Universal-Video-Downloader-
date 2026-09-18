import { describe, expect, it } from 'vitest'
import { animeIdCandidates, fullestDub, kodikTarget } from './yummyani'

/*
  A yummyani page carries two numbers that both look like the title's id, and
  they are not always the same one. The `short_link` meta tag is the site's own
  short numbering; the id on the rating widget is what api.yani.tv answers to.
  Reading the short link first worked for most of the catalogue and failed on
  older seasons with nothing to show for it but "HTTP 404" — the app simply did
  not detect the page.

  These fixtures are written here rather than captured from the site, so the
  test says what it is about instead of burying it in a page of markup.
*/

const page = (parts: { rating?: string; short?: string; noise?: string[] }): string =>
  [
    '<html><head>',
    parts.short ? `<meta id="short_link" name="short_link" content="yani.tv/a${parts.short}">` : '',
    '</head><body>',
    ...(parts.noise ?? []).map((id) => `<div class="promo" data-id="${id}"></div>`),
    parts.rating
      ? `<div class="rating-info" data-id="${parts.rating}" itemprop="aggregateRating"></div>`
      : '',
    '</body></html>'
  ].join('')

describe('animeIdCandidates', () => {
  it('puts the rating id ahead of the short link when they disagree', () => {
    // The reported case: the short link named a number the API has never heard
    // of, and it was the one being tried.
    const candidates = animeIdCandidates(page({ rating: '10649', short: '3149' }))
    expect(candidates[0]).toBe('10649')
    expect(candidates).toContain('3149')
  })

  it('offers one number when both agree', () => {
    expect(animeIdCandidates(page({ rating: '26429', short: '26429' }))).toEqual(['26429'])
  })

  it('reads the rating id whichever way round its attributes are written', () => {
    const reversed = '<div data-id="10649" class="rating-info"></div>'
    expect(animeIdCandidates(reversed)[0]).toBe('10649')
  })

  it('does not let an unrelated data-id get in front of the rating one', () => {
    // Carousels and promo blocks carry data-id too, and they appear first.
    const candidates = animeIdCandidates(page({ rating: '10649', short: '3149', noise: ['3398'] }))
    expect(candidates[0]).toBe('10649')
  })

  it('still finds something on a page with only one of the two', () => {
    expect(animeIdCandidates(page({ short: '3149' }))).toEqual(['3149'])
    expect(animeIdCandidates(page({ rating: '10649' }))).toEqual(['10649'])
  })

  it('gives nothing rather than a wrong guess when the page has neither', () => {
    expect(animeIdCandidates('<html><body>no ids here</body></html>')).toEqual([])
  })

  it('never repeats a number, so no id is asked about twice', () => {
    const candidates = animeIdCandidates(page({ rating: '26429', short: '26429', noise: ['26429'] }))
    expect(candidates).toEqual(['26429'])
  })
})

/*
  A film is not a one-episode series. Its player has no episode list at all,
  and Kodik answers a film asked about as an episode with HTTP 500 — so the
  only thing the app could report was "episode not found" about a page that
  has no episodes to find.
*/
describe('kodikTarget', () => {
  const options = [1, 2, 3]
    .map((n) => `<option value="${n}" data-id="90${n}" data-hash="aaa${n}">ep ${n}</option>`)
    .join('')

  it('reads a film straight out of its address', () => {
    const target = kodikTarget('https://kodikplayer.com/video/114576/aeb5c92b/720p', '', 1)
    expect(target).toEqual({ id: '114576', hash: 'aeb5c92b', type: 'video' })
  })

  it('asks about a film as a film, whatever episode number it was given', () => {
    // A film arrives as episode 1 of 1, and that number means nothing to Kodik.
    expect(kodikTarget('https://kodikplayer.com/video/114576/aeb5c92b/720p', options, 7)?.type).toBe(
      'video'
    )
  })

  it('still finds an episode by the value on its option', () => {
    expect(kodikTarget('https://kodikplayer.com/season/120921/7abe07/720p', options, 2)).toEqual({
      id: '902',
      hash: 'aaa2',
      type: 'seria'
    })
  })

  it('falls back to position when no option carries that value', () => {
    expect(kodikTarget('https://kodikplayer.com/season/120921/7abe07/720p', options, 3)?.id).toBe(
      '903'
    )
  })

  it('gives nothing when the player holds neither, so the caller can say so', () => {
    expect(kodikTarget('https://kodikplayer.com/season/120921/7abe07/720p', '', 1)).toBeUndefined()
  })
})

/*
  A fifteen-episode series opened as a film, because the first dub the API
  happened to list held one episode and everything was read off that one.
*/
describe('fullestDub', () => {
  const eps = (n: number): { season: number; episodes: number[] }[] => [
    { season: 1, episodes: Array.from({ length: n }, (_, i) => i + 1) }
  ]
  const dubs = [{ id: 'stub' }, { id: 'full' }, { id: 'also-full' }, { id: 'partial' }]
  const byDub = { stub: eps(1), full: eps(15), 'also-full': eps(15), partial: eps(5) }

  it('opens on the dub with the most episodes, not the first one listed', () => {
    expect(fullestDub(dubs, byDub)).toBe('full')
  })

  it('keeps the order the site gave when two dubs tie', () => {
    expect(fullestDub([dubs[2], dubs[1]], byDub)).toBe('also-full')
  })

  it('still answers for a film, where every dub has one', () => {
    expect(fullestDub([{ id: 'a' }, { id: 'b' }], { a: eps(1), b: eps(1) })).toBe('a')
  })

  it('counts across seasons, and survives a dub with no list at all', () => {
    const split = { a: [...eps(3), { season: 2, episodes: [1, 2, 3, 4] }], b: eps(5) }
    expect(fullestDub([{ id: 'b' }, { id: 'a' }, { id: 'ghost' }], split)).toBe('a')
  })
})
