import { describe, expect, it } from 'vitest'
import { b64urlDecode, b64urlEncode } from '../http'
import { hasResolver } from '../index'
import {
  aksorTranslatorId,
  animeIdCandidates,
  findAksorEpisode,
  fullestDub,
  groupAksorDubs,
  groupKodikDubs,
  parseAksorTranslator,
  shortLivedCache,
  YUMMY_DOMAIN,
  yummyQualities
} from './yummyani'

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

/*
  The site filed a one-episode record under another studio name against the
  same player as a complete fifteen-episode dub. Both claimed the same id, the
  later one won, and the complete dub was shown as having one episode.
*/
describe('groupKodikDubs', () => {
  const KODIK = 'Плеер Kodik'
  const video = (dubbing: string, number: number, base: string, player = KODIK) => ({
    number: String(number),
    iframe_url: `${base}?translations=false`,
    data: { player, dubbing }
  })
  const full = Array.from({ length: 15 }, (_, i) => video('DEEP', i + 1, '//kodikplayer.com/season/1/aa/720p'))
  const stray = video('SHIZA', 1, '//kodikplayer.com/season/1/aa/720p')

  it('pools two labels that play from the same player, instead of letting the last one win', () => {
    const dubs = groupKodikDubs([...full, stray])
    expect(dubs).toHaveLength(1)
    expect(dubs[0].episodes).toHaveLength(15)
  })

  it('names the result after the label with the most records behind it', () => {
    expect(groupKodikDubs([...full, stray])[0].name).toBe('DEEP')
    expect(groupKodikDubs([stray, ...full])[0].name).toBe('DEEP')
  })

  it('keeps dubs on different players apart', () => {
    const other = video('AniDUB', 1, '//kodikplayer.com/season/2/bb/720p')
    expect(groupKodikDubs([...full, other]).map((d) => d.name)).toEqual(['DEEP', 'AniDUB'])
  })

  it('ignores players it cannot download from', () => {
    const alloha = video('Dubbed', 1, '//alloha.yani.tv/x', 'Плеер Alloha')
    expect(groupKodikDubs([alloha])).toEqual([])
  })

  it('lists each episode once, in order, whatever order and however often it arrived', () => {
    const base = '//kodikplayer.com/season/3/cc/720p'
    const dubs = groupKodikDubs([video('A', 3, base), video('A', 1, base), video('A', 3, base)])
    expect(dubs[0].episodes).toEqual([1, 3])
  })
})

/*
  /anime/<id>/videos in the shape it comes, trimmed to what is read: the same
  studio on Kodik and on Aksor, and the players the app cannot download from.
  Two titles in the catalogue are on Aksor and Alloha only, and they were
  reported as having nothing to download.
*/
const yaniVideo = (player: string, dubbing: string, n: number, iframe_url: string, duration = 1560) => ({
  number: String(n),
  iframe_url,
  duration,
  data: { player, dubbing }
})
const LIBRIA = 'Озвучка AniLibria'
/** A 32-character player hash, told apart by dub and episode. */
const hash = (n: number, dub = 'a'): string => `${dub}${String(n).padStart(31, '0')}`
const aksor = (dubbing: string, n: number, dub = 'a', duration?: number) =>
  yaniVideo('Плеер Aksor', dubbing, n, `https://player.aksor.tv/video/${hash(n, dub)}`, duration)
const catalogue = [
  ...[1, 2, 3].map((n) =>
    yaniVideo('Плеер Kodik', LIBRIA, n, '//kodikplayer.com/season/1/aa/720p?translations=false')
  ),
  ...[2, 1, 3].map((n) => aksor(LIBRIA, n)),
  ...[1, 2].map((n) => aksor('Субтитры', n, 'b')),
  yaniVideo('Плеер Alloha', LIBRIA, 1, 'https://alloha.yani.tv/video/1'),
  yaniVideo('Плеер CVH', LIBRIA, 1, 'https://plapi.cdnvideohub.com/1'),
  yaniVideo('Плеер Sibnet', LIBRIA, 1, 'https://video.sibnet.ru/shell.php?videoid=1')
]

describe('groupAksorDubs', () => {
  it('finds the Aksor dubs, in the order the site lists them, with their episodes in order', () => {
    const dubs = groupAksorDubs(catalogue)
    expect(dubs.map((d) => d.dubbing)).toEqual([LIBRIA, 'Субтитры'])
    expect(dubs[0].episodes).toEqual([1, 2, 3])
    expect(dubs[1].episodes).toEqual([1, 2])
  })

  it('names a dub apart from the same studio on Kodik', () => {
    // Otherwise the picker lists "Озвучка AniLibria" twice, 720p and 1080p, with
    // nothing to choose between them by.
    const kodik = groupKodikDubs(catalogue).map((d) => d.name)
    const names = groupAksorDubs(catalogue).map((d) => d.name)
    expect(names).toEqual(['Озвучка AniLibria · Aksor', 'Субтитры · Aksor'])
    expect(names.filter((name) => kodik.includes(name))).toEqual([])
  })

  it('still ignores Alloha, CVH and Sibnet, and Kodik keeps its own', () => {
    const others = catalogue.filter((v) => !/Kodik|Aksor/.test(v.data.player))
    expect(groupAksorDubs(others)).toEqual([])
    expect(groupKodikDubs(others)).toEqual([])
    expect(groupKodikDubs(catalogue)).toHaveLength(1)
  })

  it('keeps the address of one episode to ask which heights the dub comes in', () => {
    expect(groupAksorDubs(catalogue)[0].sample).toBe(hash(2))
  })

  it('skips a record whose player address it cannot read', () => {
    const broken = yaniVideo('Плеер Aksor', 'X', 1, 'https://player.aksor.tv/embed')
    expect(groupAksorDubs([broken])).toEqual([])
  })
})

/*
  Watches keep the translator id, and a dub on Aksor has no player address to
  be one. The id has to come back to the same title and dub, never be taken
  for a Kodik player, and never change shape once a watch has stored it.
*/
describe('Aksor translator ids', () => {
  it('come back to the title and dub they were made from', () => {
    const tid = aksorTranslatorId('10661', LIBRIA)
    expect(parseAksorTranslator(b64urlDecode(tid))).toEqual({ animeId: '10661', dubbing: LIBRIA })
  })

  it('are spelt the way they were first shipped', () => {
    expect(aksorTranslatorId('10661', LIBRIA)).toBe('YWtzb3I6MTA2NjE60J7Qt9Cy0YPRh9C60LAgQW5pTGlicmlh')
  })

  it('keep a label with a colon in it whole', () => {
    const tid = aksorTranslatorId('7', 'Re:Zero Team: TV')
    expect(parseAksorTranslator(b64urlDecode(tid))?.dubbing).toBe('Re:Zero Team: TV')
  })

  it('are never read out of a Kodik id', () => {
    const kodik = b64urlEncode('//kodikplayer.com/season/1/aa/720p')
    expect(parseAksorTranslator(b64urlDecode(kodik))).toBeUndefined()
  })
})

describe('findAksorEpisode', () => {
  it('matches the episode number the site sends as a string', () => {
    expect(findAksorEpisode(catalogue, LIBRIA, 3)?.hash).toBe(hash(3))
  })

  it("takes the dub's own record, not the same episode of another dub or player", () => {
    expect(findAksorEpisode(catalogue, 'Субтитры', 1)?.hash).toBe(hash(1, 'b'))
    expect(findAksorEpisode(catalogue, 'Субтитры', 3)).toBeUndefined()
  })

  it('takes the first of two records for the same episode', () => {
    expect(findAksorEpisode([aksor('A', 1, 'c'), aksor('A', 1, 'd')], 'A', 1)?.hash).toBe(hash(1, 'c'))
  })

  it('carries the length along, and leaves out one that is not a length', () => {
    expect(findAksorEpisode(catalogue, 'Субтитры', 2)?.duration).toBe(1560)
    expect(findAksorEpisode([aksor('A', 1, 'a', 0)], 'A', 1)?.duration).toBeUndefined()
  })
})

describe('the picker on a title with Aksor dubs', () => {
  it('still opens on Kodik when an Aksor dub has as many episodes', () => {
    const translators = [{ id: 'kodik' }, { id: 'aksor' }]
    const eps = [{ season: 1, episodes: [1, 2, 3] }]
    expect(fullestDub(translators, { kodik: eps, aksor: eps })).toBe('kodik')
  })

  it("offers Kodik's ladder, and 1080p only where an Aksor dub has it", () => {
    expect(yummyQualities(true, [])).toEqual(['360p', '480p', '720p'])
    expect(yummyQualities(true, [1080])).toEqual(['360p', '480p', '720p', '1080p'])
    expect(yummyQualities(true, [720])).toEqual(['360p', '480p', '720p'])
  })

  it('offers just what Aksor has on a title without Kodik', () => {
    expect(yummyQualities(false, [1080, 1080])).toEqual(['1080p'])
    expect(yummyQualities(false, [2160, 720, 1440])).toEqual(['720p', '1440p', '2160p'])
  })

  it('still offers a ladder when the player could not be asked', () => {
    expect(yummyQualities(false, [])).toEqual(['360p', '480p', '720p'])
  })
})

/*
  Queuing a season resolves every episode in turn, and each one looked its
  episode up in a video list of about a megabyte, fetched again every time.
*/
describe('shortLivedCache', () => {
  const clock = (): { now: () => number; advance: (ms: number) => void } => {
    let t = 0
    return { now: () => t, advance: (ms) => (t += ms) }
  }

  it('answers from the first load while it is fresh, and shares one in flight', async () => {
    const time = clock()
    const cache = shortLivedCache<number>(1000, 4, time.now)
    let loads = 0
    const load = async (): Promise<number> => ++loads
    const [a, b] = await Promise.all([cache.get('x', load), cache.get('x', load)])
    expect([a, b, loads]).toEqual([1, 1, 1])
    time.advance(999)
    expect(await cache.get('x', load)).toBe(1)
    time.advance(1)
    expect(await cache.get('x', load)).toBe(2)
  })

  it('loads again when asked for a fresh answer, and keeps that one', async () => {
    const cache = shortLivedCache<number>(1000, 4, clock().now)
    let loads = 0
    const load = async (): Promise<number> => ++loads
    await cache.get('x', load)
    expect(await cache.get('x', load, true)).toBe(2)
    expect(await cache.get('x', load)).toBe(2)
  })

  it('serves what was put in, without loading', async () => {
    const cache = shortLivedCache<string>(1000, 4, clock().now)
    cache.set('x', 'given')
    expect(await cache.get('x', async () => 'loaded')).toBe('given')
  })

  it('forgets a load that failed, so the next caller tries again', async () => {
    const cache = shortLivedCache<number>(1000, 4, clock().now)
    const failing = async (): Promise<number> => Promise.reject(new Error('HTTP 502'))
    await expect(cache.get('x', failing)).rejects.toThrow('HTTP 502')
    expect(await cache.get('x', async () => 7)).toBe(7)
  })

  it('lets the oldest go past its size', async () => {
    const cache = shortLivedCache<string>(1000, 2, clock().now)
    cache.set('a', 'a')
    cache.set('b', 'b')
    cache.set('c', 'c')
    expect(await cache.get('a', async () => 'reloaded')).toBe('reloaded')
    expect(await cache.get('c', async () => 'reloaded')).toBe('c')
  })
})

/*
  yummy-anime.ru and yani.tv are the site's old addresses, still on bookmarks
  and share links. A title page on either had no resolver, so it never got the
  picker and went down the slow generic path instead.
*/
describe("YummyAnime's old addresses", () => {
  it('reach the resolver', () => {
    expect(hasResolver('https://yummy-anime.ru/catalog/item/sousou-no-frieren')).toBe(true)
    expect(hasResolver('https://yani.tv/catalog/item/sousou-no-frieren')).toBe(true)
  })

  it('are matched even by a caller that did not normalise first', () => {
    expect(YUMMY_DOMAIN.test('https://yummy-anime.ru/catalog/item/sousou-no-frieren')).toBe(true)
    expect(YUMMY_DOMAIN.test('https://old.yummy-anime.ru/catalog/item/sousou-no-frieren')).toBe(true)
    expect(YUMMY_DOMAIN.test('https://yani.tv/catalog/item/sousou-no-frieren')).toBe(true)
    expect(YUMMY_DOMAIN.test('https://api.yani.tv/anime/10661')).toBe(false)
  })
})
