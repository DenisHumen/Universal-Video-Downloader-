import { beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyYtdlpError } from '../../services/options'
import { resolveUrl } from '../index'
import { NotReleasedError } from '../upcoming'
import { streamUrl } from '@shared/streaming'
import fixture from './fixtures/aniliberty-release.json'
import {
  ANILIB_SCHEME,
  ANILIBERTY_EPISODE,
  ANILIBERTY_RELEASE,
  ANILIBRIA_LEGACY_RELEASE,
  anilibStreamUrl,
  anilibertyAlias,
  anilibertyInfo,
  apiHosts,
  episodeLabel,
  episodeTiers,
  parseAnilibStreamUrl,
  pickAnilibTier,
  playableEpisodes,
  type AniEpisode,
  type AniRelease
} from './aniliberty'

const h = vi.hoisted(() => ({ fetchText: vi.fn() }))

// Every resolver, this one included, asks the fake network instead of the real one.
vi.mock('../http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../http')>()),
  fetchText: h.fetchText
}))

/*
  `fixtures/aniliberty-release.json` is what /api/v1/anime/releases/<alias>
  answered for a running ONA with three episodes out, trimmed to the fields the
  resolver reads (no description, genres, members or torrents) and with the
  country code in the manifest addresses blanked.
*/
const recorded = fixture as AniRelease
const release = (over: Partial<AniRelease> = {}): AniRelease => ({
  ...structuredClone(recorded),
  ...over
})
const ALIAS = 'steel-ball-run-jojo-no-kimyou-na-bouken'
const PAGE = `https://aniliberty.top/anime/releases/release/${ALIAS}/episodes`
const manifest = (ep: number, height: number): string =>
  `https://cache.libria.fun/videos/media/ts/10172/${ep}/${height}/x.m3u8`

describe('the AniLiberty matchers', () => {
  it('take a release page on each of the three hosts, with or without www', () => {
    for (const host of ['aniliberty.top', 'anilibria.top', 'anilibria.app', 'www.aniliberty.top']) {
      const url = `https://${host}/anime/releases/release/${ALIAS}`
      expect(ANILIBERTY_RELEASE.test(url), url).toBe(true)
      expect(anilibertyAlias(url), url).toBe(ALIAS)
    }
  })

  it('read the alias past the tab the page was opened on', () => {
    expect(anilibertyAlias(PAGE)).toBe(ALIAS)
    expect(anilibertyAlias(`https://anilibria.top/anime/releases/release/${ALIAS}?tab=torrents`)).toBe(ALIAS)
  })

  it('take the old anilibria.tv release address, whose code is the alias', () => {
    const url = `https://www.anilibria.tv/release/${ALIAS}.html`
    expect(ANILIBRIA_LEGACY_RELEASE.test(url)).toBe(true)
    expect(anilibertyAlias(url)).toBe(ALIAS)
  })

  it('take an episode’s watch page', () => {
    expect(
      ANILIBERTY_EPISODE.test('https://aniliberty.top/anime/video/episode/a159552a-9fa7-4737-867b-d22cf7115602')
    ).toBe(true)
  })

  it('leave the catalogue, other sites and look-alike hosts alone', () => {
    for (const url of [
      'https://aniliberty.top/anime/catalog/',
      'https://aniliberty.top/anime/schedule',
      `https://aniliberty.top.example.com/anime/releases/release/${ALIAS}`,
      `https://example.com/anime/releases/release/${ALIAS}`,
      'https://www.anilibria.tv/pages/catalog.php',
      'https://aniliberty.top/anime/video/episode/not-a-uuid'
    ]) {
      expect(anilibertyAlias(url), url).toBeUndefined()
      expect(ANILIBERTY_EPISODE.test(url), url).toBe(false)
    }
  })
})

describe('apiHosts', () => {
  it('asks the page’s own host first, then the mirrors', () => {
    expect(apiHosts('anilibria.top')).toEqual(['anilibria.top', 'aniliberty.top', 'api.anilibria.app'])
    expect(apiHosts('www.aniliberty.top')[0]).toBe('aniliberty.top')
  })

  it('never asks anilibria.app, whose /api/v1 is a page about the apps', () => {
    expect(apiHosts('anilibria.app')).toEqual(['aniliberty.top', 'anilibria.top', 'api.anilibria.app'])
    expect(apiHosts()).not.toContain('anilibria.app')
  })
})

describe('anilibertyInfo', () => {
  it('turns the recorded release into an episode picker', () => {
    const info = anilibertyInfo(release(), 'https://aniliberty.top', 'aniliberty.top')
    expect(info).toEqual({
      provider: 'aniliberty',
      host: 'aniliberty.top',
      id: ALIAS,
      title: 'Невероятные приключения ДжоДжо: Гонка «Стальной шар»',
      thumbnail:
        'https://aniliberty.top/storage/releases/posters/10172/5bHZeLaIKOser7WZsyhCy6jVrneAKOfO.jpg',
      isSeries: true,
      translators: [{ id: ALIAS, name: 'AniLibria' }],
      defaultTranslator: ALIAS,
      seasons: [{ season: 1, episodes: [1, 2, 3] }],
      qualities: ['1080p', '720p', '480p']
    })
  })

  it('offers only the heights some episode has a manifest for', () => {
    const episodes = recorded.episodes!.map((e) => ({ ...e, hls_1080: null }))
    const info = anilibertyInfo(release({ episodes }), 'https://aniliberty.top', 'aniliberty.top')
    expect(info.qualities).toEqual(['720p', '480p'])
  })

  it('calls a running show with one episode out a series, and a finished one-episode release a film', () => {
    const one = [recorded.episodes![0]]
    expect(anilibertyInfo(release({ episodes: one }), 'https://x', 'x').isSeries).toBe(true)
    const film = release({ episodes: one, is_ongoing: false, episodes_total: 1 })
    expect(anilibertyInfo(film, 'https://x', 'x').isSeries).toBe(false)
  })

  it('takes the English name, then the alias, when the Russian one is missing', () => {
    const english = release({ name: { main: '  ', english: 'Steel Ball Run' } })
    expect(anilibertyInfo(english, 'https://x', 'x').title).toBe('Steel Ball Run')
    expect(anilibertyInfo(release({ name: null }), 'https://x', 'x').title).toBe(ALIAS)
  })

  it('refuses a geo-blocked release in words the classifier reads as a region block', () => {
    let message = ''
    try {
      anilibertyInfo(release({ is_blocked_by_geo: true }), 'https://x', 'x')
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toMatch(/region/)
    expect(classifyYtdlpError(message, false).code).toBe('geo')
  })

  it('refuses a release taken down for its rights holder as unavailable', () => {
    let message = ''
    try {
      anilibertyInfo(release({ is_blocked_by_copyrights: true }), 'https://x', 'x')
    } catch (err) {
      message = (err as Error).message
    }
    expect(classifyYtdlpError(message, false).code).toBe('unavailable')
  })

  it('says "not yet", for AniLiberty, about a release still in work with nothing out', () => {
    let caught: unknown
    try {
      anilibertyInfo(release({ episodes: [] }), 'https://aniliberty.top', 'aniliberty.top')
    } catch (err) {
      caught = err
    }
    // Filed under YummyAnime, a watch on it would build YummyAnime addresses.
    expect(caught).toBeInstanceOf(NotReleasedError)
    expect((caught as NotReleasedError).provider).toBe('aniliberty')
    expect((caught as NotReleasedError).qualities).toEqual(['480p', '720p', '1080p'])
    expect((caught as NotReleasedError).thumbnail).toMatch(/^https:\/\/aniliberty\.top\/storage\//)
  })

  it('says there is nothing to download on a finished release with no episodes', () => {
    const empty = release({ episodes: [], is_ongoing: false, is_in_production: false })
    let message = ''
    try {
      anilibertyInfo(empty, 'https://x', 'x')
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toMatch(/no episodes/)
    expect(classifyYtdlpError(message, false).code).toBe('noFormats')
  })
})

describe('playableEpisodes', () => {
  const ep = (ordinal: number | null, over: Partial<AniEpisode> = {}): AniEpisode => ({
    ordinal,
    sort_order: ordinal,
    hls_720: manifest(ordinal ?? 0, 720),
    ...over
  })

  it('leaves out an episode with no manifest, rather than offering one that always fails', () => {
    const list = playableEpisodes({ episodes: [ep(1), ep(2, { hls_720: null }), ep(3)] })
    expect(list.map((e) => e.ordinal)).toEqual([1, 3])
  })

  it('keeps a recap between two episodes in its place, and each number once', () => {
    const list = playableEpisodes({
      episodes: [ep(13), ep(12.5), ep(12), ep(13, { sort_order: 99, hls_720: manifest(99, 720) })]
    })
    expect(list.map((e) => e.ordinal)).toEqual([12, 12.5, 13])
    expect(episodeTiers(list[2].episode)[0].url).toBe(manifest(13, 720))
  })

  it('skips an episode with no number', () => {
    expect(playableEpisodes({ episodes: [ep(null), ep(1)] }).map((e) => e.ordinal)).toEqual([1])
  })
})

describe('episodeTiers and pickAnilibTier', () => {
  const tiers = episodeTiers({
    hls_480: manifest(1, 480),
    hls_720: manifest(1, 720),
    hls_1080: manifest(1, 1080)
  })

  it('lists the heights an episode comes in, highest first', () => {
    expect(tiers.map((t) => t.height)).toEqual([1080, 720, 480])
  })

  it('reads a protocol-relative manifest and ignores anything that is not an address', () => {
    const odd = episodeTiers({ hls_480: '//cdn.example.com/a.m3u8', hls_720: 'soon', hls_1080: '' })
    expect(odd).toEqual([{ height: 480, url: 'https://cdn.example.com/a.m3u8' }])
  })

  it('takes the height asked for, in either spelling', () => {
    expect(pickAnilibTier(tiers, '720')?.height).toBe(720)
    expect(pickAnilibTier(tiers, '720p')?.height).toBe(720)
  })

  it('falls back to the next height down', () => {
    expect(pickAnilibTier(tiers, '1000')?.height).toBe(720)
    const no1080 = tiers.filter((t) => t.height !== 1080)
    expect(pickAnilibTier(no1080, '1080')?.height).toBe(720)
  })

  it('takes the lowest when everything is above the request, and the highest for best or audio', () => {
    expect(pickAnilibTier(tiers, '360')?.height).toBe(480)
    expect(pickAnilibTier(tiers, 'best')?.height).toBe(1080)
    expect(pickAnilibTier(tiers, 'audio')?.height).toBe(1080)
    expect(pickAnilibTier([], 'best')).toBeUndefined()
  })
})

describe('the uvd-anilib:// scheme', () => {
  it('round-trips an alias, an episode and a quality', () => {
    const url = anilibStreamUrl(ALIAS, 3, '720p')
    expect(url).toBe(`${ANILIB_SCHEME}${ALIAS}/3/720p`)
    expect(parseAnilibStreamUrl(url)).toEqual({ alias: ALIAS, ordinal: 3, quality: '720p' })
    expect(parseAnilibStreamUrl(anilibStreamUrl(ALIAS, 12.5, 'best'))?.ordinal).toBe(12.5)
  })

  it('reads what the picker builds, for an episode and for a film', () => {
    const info = anilibertyInfo(release(), 'https://aniliberty.top', 'aniliberty.top')
    const episode = streamUrl(info, info.defaultTranslator, '1080', { season: 1, episode: 2 })
    expect(parseAnilibStreamUrl(episode)).toEqual({ alias: ALIAS, ordinal: 2, quality: '1080' })
    // A film's one episode need not be number one; the picker's list says which it is.
    const film = { ...info, isSeries: false, seasons: [{ season: 1, episodes: [7] }] }
    expect(parseAnilibStreamUrl(streamUrl(film, ALIAS, 'best'))?.ordinal).toBe(7)
  })

  it('refuses an address with no episode in it', () => {
    expect(parseAnilibStreamUrl(`${ANILIB_SCHEME}${ALIAS}`)).toBeUndefined()
    expect(parseAnilibStreamUrl(`${ANILIB_SCHEME}${ALIAS}/x/720`)).toBeUndefined()
    expect(parseAnilibStreamUrl('uvd-kodik://abc/1/720')).toBeUndefined()
  })

  it('labels an episode the way the picker numbers it', () => {
    expect(episodeLabel(3)).toBe('E03')
    expect(episodeLabel(12.5)).toBe('E12.5')
    expect(episodeLabel(120)).toBe('E120')
  })
})

describe('resolveUrl on AniLiberty', () => {
  const answer = (body: unknown): string => JSON.stringify(body)

  beforeEach(() => {
    h.fetchText.mockReset()
  })

  it('turns a release page into its picker, asking the page’s own host', async () => {
    h.fetchText.mockResolvedValueOnce(answer(recorded))
    const resolved = await resolveUrl(PAGE)
    expect(h.fetchText.mock.calls[0][0]).toBe(`https://aniliberty.top/api/v1/anime/releases/${ALIAS}`)
    expect(resolved.extractor).toBe('AniLiberty')
    expect(resolved.streaming?.seasons).toEqual([{ season: 1, episodes: [1, 2, 3] }])
    expect(resolved.title).toBe(recorded.name?.main)
  })

  it('asks the next mirror when the first cannot be reached', async () => {
    h.fetchText
      .mockRejectedValueOnce(new Error('Could not reach anilibria.top: the connection was dropped.'))
      .mockResolvedValueOnce(answer(recorded))
    const resolved = await resolveUrl(`https://anilibria.top/anime/releases/release/${ALIAS}`)
    expect(h.fetchText.mock.calls[1][0]).toMatch(/^https:\/\/aniliberty\.top\/api\/v1\//)
    // The poster is made absolute against the host that answered.
    expect(resolved.streaming?.thumbnail).toMatch(/^https:\/\/aniliberty\.top\/storage\//)
    expect(resolved.streaming?.host).toBe('anilibria.top')
  })

  it('leaves the page to the universal resolver when no host knows the release', async () => {
    h.fetchText.mockRejectedValue(new Error('HTTP 404'))
    const resolved = await resolveUrl(PAGE)
    expect(resolved).toEqual({ url: PAGE })
    expect(h.fetchText).toHaveBeenCalledTimes(3)
  })

  it('surfaces a geo block instead of falling back', async () => {
    h.fetchText.mockResolvedValueOnce(answer({ ...recorded, is_blocked_by_geo: true }))
    await expect(resolveUrl(PAGE)).rejects.toThrow(/region/)
  })

  it('re-resolves a queued episode to its manifest at the height asked for', async () => {
    h.fetchText.mockResolvedValueOnce(answer(recorded))
    const uvd = anilibStreamUrl(ALIAS, 2, '720')
    const resolved = await resolveUrl(uvd)
    expect(resolved.url).toBe(recorded.episodes![1].hls_720)
    expect(resolved.referer).toBe('https://aniliberty.top/')
    expect(resolved.downloadUrl).toBe(uvd)
    expect(resolved.duration).toBe(1516)
    expect(resolved.title).toBe(`${recorded.name?.main} - E02`)
  })

  it('falls back to the next height down when the episode lacks the one asked for', async () => {
    const episodes = recorded.episodes!.map((e) => ({ ...e, hls_1080: null }))
    h.fetchText.mockResolvedValueOnce(answer({ ...recorded, episodes }))
    const resolved = await resolveUrl(anilibStreamUrl(ALIAS, 1, '1080'))
    expect(resolved.url).toBe(recorded.episodes![0].hls_720)
  })

  it('says so when a queued episode is no longer on the release', async () => {
    h.fetchText.mockResolvedValueOnce(answer(recorded))
    await expect(resolveUrl(anilibStreamUrl(ALIAS, 9, 'best'))).rejects.toThrow(/Episode not found/)
  })

  it('turns an episode’s watch page into that episode, with a picker for its heights', async () => {
    const episode = { ...recorded.episodes![1], release: recorded }
    h.fetchText.mockResolvedValueOnce(answer(episode))
    const page = `https://aniliberty.top/anime/video/episode/${episode.id}`
    const resolved = await resolveUrl(page)
    expect(h.fetchText.mock.calls[0][0]).toBe(
      `https://aniliberty.top/api/v1/anime/releases/episodes/${episode.id}`
    )
    expect(resolved.url).toBe(episode.hls_1080)
    expect(resolved.downloadUrl).toBe(anilibStreamUrl(ALIAS, 2, 'best'))
    expect(resolved.streaming).toMatchObject({
      isSeries: false,
      loneEpisode: true,
      title: `${recorded.name?.main} - E02`,
      seasons: [{ season: 1, episodes: [2] }],
      qualities: ['1080p', '720p', '480p']
    })
    // The picker's download button queues episode 2, not episode 1.
    const s = resolved.streaming!
    expect(streamUrl(s, s.defaultTranslator, '480')).toBe(anilibStreamUrl(ALIAS, 2, '480'))
  })
})
