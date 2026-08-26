import { describe, expect, it } from 'vitest'
import { animeIdCandidates } from './yummyani'

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
