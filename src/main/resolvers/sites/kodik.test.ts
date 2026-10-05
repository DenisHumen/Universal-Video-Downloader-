import { describe, expect, it } from 'vitest'
import { b64urlDecode } from '../http'
import { classifyYtdlpError } from '../../services/options'
import {
  KODIK_PLAYER,
  KODIK_SCHEME,
  kodikEpisodes,
  kodikOnPage,
  kodikSeasonInfo,
  kodikSingleInfo,
  kodikStreamUrl,
  kodikTarget,
  parseKodikPlayer,
  resolveKodikPlayer
} from './kodik'

/*
  Fixtures are written in the shape the player pages have, trimmed to what the
  code reads: options spread over several lines, a voiceover list in the same
  page, and the `vInfo` block every player carries.
*/

const episodeOption = (n: number): string => `
            <option
              value="${n}"
              data-id="90${n}"
              data-hash="aaa${n}"
              data-title="${n} серия"
              data-other-translation="false"
            >${n} серия</option>`

// The voiceover list: data-id too, but a data-media-hash rather than a data-hash.
const dubOption = (id: number, name: string): string => `
              <option
                value="${id}"
                data-id="${id}"
                data-translation-type="voice"
                data-media-id="7${id}"
                data-media-hash="bbb${id}"
                data-media-type="season"
                data-title="${name}"
                data-episode-count="3"
              >${name} (3 эп.)</option>`

const vInfo = (type: string, id: string, hash: string): string =>
  `<script>var vInfo = {};\n   vInfo.type = '${type}'; \n   vInfo.hash = '${hash}'; \n   vInfo.id = '${id}'; </script>`

const seasonPage = (episodes: number[], extra = ''): string =>
  [
    '<html><head><title>Фрирен [ТВ-1] - 1 сезон</title>',
    '<script>var seasonNumber = Number(1);',
    '    var translationTitle = "AniLibria.TV";</script></head><body>',
    extra,
    '<div class="serial-series-box"><select>',
    ...episodes.map(episodeOption),
    '</select></div>',
    '<div class="serial-translations-box"><select>',
    dubOption(3560, 'AniDUB'),
    dubOption(610, 'AniLibria.TV'),
    '</select></div></body></html>'
  ].join('\n')

const SERIA_PAGE = [
  '<html><head><title>Kodik Player</title>',
  '<script>var type = "seria"; var translationTitle = null;</script></head><body>',
  '<script>var translationTitle = "AniDUB";</script>',
  vInfo('seria', '1674742', '73b56ca992e1b75e86fbc9dc3e3f2508'),
  '</body></html>'
].join('\n')

describe('KODIK_PLAYER', () => {
  /*
    No resolver claimed a Kodik address, and the engine has no extractor for
    one: a copied player link came back as "Unsupported URL".
  */
  it('claims a player on every domain Kodik has served from', () => {
    for (const host of [
      'kodikplayer.com',
      'www.kodikplayer.com',
      'kodik.info',
      'kodik.cc',
      'kodik.biz',
      'kodik.com',
      'kodikplayer.info',
      'aniqit.com'
    ]) {
      expect(KODIK_PLAYER.test(`https://${host}/seria/1674742/73b56ca9/720p`), host).toBe(true)
    }
    expect(KODIK_PLAYER.test('http://kodik.info/video/25135/b57cd290/720p')).toBe(true)
  })

  it('claims every kind of player, and /uv/ so it can be refused in words', () => {
    for (const kind of ['seria', 'video', 'season', 'serial']) {
      expect(KODIK_PLAYER.test(`https://kodikplayer.com/${kind}/94795/d5a209e9/720p`), kind).toBe(true)
    }
    expect(KODIK_PLAYER.test('https://kodikplayer.com/uv/abc')).toBe(true)
  })

  it('leaves other addresses alone', () => {
    expect(KODIK_PLAYER.test('https://kodikplayer.com/ftor')).toBe(false)
    expect(KODIK_PLAYER.test('https://kodikplayer.com/season/94795')).toBe(false)
    expect(KODIK_PLAYER.test('https://notkodik.com/seria/1/ab/720p')).toBe(false)
    expect(KODIK_PLAYER.test('https://kodik.info.example.test/seria/1/ab/720p')).toBe(false)
    expect(KODIK_PLAYER.test('https://example.test/?u=https://kodikplayer.com/seria/1/ab')).toBe(false)
  })
})

describe('parseKodikPlayer', () => {
  it('fetches from kodikplayer.com, the only Kodik domain still in DNS', () => {
    // An old embed on kodik.info names a domain that no longer exists.
    expect(parseKodikPlayer('https://kodik.info/seria/1674742/73b56ca9/720p')).toEqual({
      kind: 'seria',
      id: '1674742',
      hash: '73b56ca9',
      url: 'https://kodikplayer.com/seria/1674742/73b56ca9/720p',
      quality: '720p'
    })
  })

  it('drops a query that would hide the season behind one episode', () => {
    // YummyAnime's embed shape: with only_episode the page has no episode list.
    const player = parseKodikPlayer(
      'https://kodikplayer.com/season/94795/d5a209e9/720p?translations=false&only_episode=true&episode=3'
    )
    expect(player?.url).toBe('https://kodikplayer.com/season/94795/d5a209e9/720p')
  })

  it('keeps the season a series link asks for, and nothing else', () => {
    expect(
      parseKodikPlayer('https://kodikplayer.com/serial/54001/abc123/720p?only_season=true&season=2')?.url
    ).toBe('https://kodikplayer.com/serial/54001/abc123/720p?season=2')
  })

  it('supplies a height when the address names none', () => {
    const player = parseKodikPlayer('https://kodikplayer.com/video/25135/b57cd290')
    expect(player?.url).toBe('https://kodikplayer.com/video/25135/b57cd290/720p')
    expect(player?.quality).toBeUndefined()
  })

  it('gives nothing for a /uv/ player, which has no id and hash to read', () => {
    expect(parseKodikPlayer('https://kodikplayer.com/uv/abc')).toBeUndefined()
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

  it('reads an episode player straight out of its address, with nothing fetched yet', () => {
    // The pasted link that failed as "Episode not found": a seria page has no options.
    expect(
      kodikTarget('https://kodikplayer.com/seria/1674742/73b56ca992e1b75e86fbc9dc3e3f2508/720p', '', 1)
    ).toEqual({ id: '1674742', hash: '73b56ca992e1b75e86fbc9dc3e3f2508', type: 'seria' })
  })

  it("falls back to the page's vInfo when the address does not say what it plays", () => {
    expect(kodikTarget('https://kodikplayer.com/embed/1674742', SERIA_PAGE, 1)).toEqual({
      id: '1674742',
      hash: '73b56ca992e1b75e86fbc9dc3e3f2508',
      type: 'seria'
    })
  })

  it('never takes vInfo for an episode a season does not list', () => {
    // A season's vInfo is whichever episode it opens on. Read for episode 7 of
    // three, it would download that one under episode 7's name.
    const page = seasonPage([1, 2, 3], vInfo('seria', '903', 'aaa3'))
    expect(kodikTarget('https://kodikplayer.com/season/94795/d5a209e9/720p', page, 7)).toBeUndefined()
  })

  it('never takes vInfo on a season or series address, even with no list on the page', () => {
    const lone = vInfo('seria', '903', 'aaa3')
    expect(kodikTarget('https://kodikplayer.com/season/94795/d5a209e9/720p', lone, 1)).toBeUndefined()
    expect(kodikTarget('https://kodikplayer.com/serial/54001/abc123/720p', lone, 1)).toBeUndefined()
  })

  it('never takes vInfo on a page with an episode list, whatever its address says', () => {
    const page = seasonPage([1, 2, 3], vInfo('seria', '903', 'aaa3'))
    expect(kodikTarget('https://kodikplayer.com/embed/94795', page, 9)).toBeUndefined()
  })
})

describe('kodikEpisodes', () => {
  it('lists the episodes, not the voiceovers sharing the page with them', () => {
    // Counted as episodes, the dub list would add one per voiceover.
    expect(kodikEpisodes(seasonPage([1, 2, 3]))).toEqual([1, 2, 3])
  })

  it('keeps the numbers a season gives its episodes', () => {
    expect(kodikEpisodes(seasonPage([14, 13, 15]))).toEqual([13, 14, 15])
  })

  it('numbers by position when the options carry no number', () => {
    const page = '<option data-id="901" data-hash="aaa1"></option><option data-id="902" data-hash="aaa2"></option>'
    expect(kodikEpisodes(page)).toEqual([1, 2])
  })

  it('finds none on a single player', () => {
    expect(kodikEpisodes(SERIA_PAGE)).toEqual([])
  })
})

describe('kodikSeasonInfo', () => {
  const player = parseKodikPlayer('https://kodikplayer.com/season/94795/d5a209e9/720p')!

  it('builds a picker for the dub the player plays', () => {
    const info = kodikSeasonInfo(player, seasonPage([1, 2, 3]))!
    expect(info.provider).toBe('kodik')
    expect(info.title).toBe('Фрирен [ТВ-1] - 1 сезон')
    expect(info.translators).toHaveLength(1)
    expect(info.translators[0].name).toBe('AniLibria.TV')
    expect(info.seasons).toEqual([{ season: 1, episodes: [1, 2, 3] }])
  })

  it('names the dub by the player address, which is what an episode is fetched from', () => {
    const info = kodikSeasonInfo(player, seasonPage([1, 2]))!
    expect(b64urlDecode(info.defaultTranslator)).toBe(player.url)
    expect(info.episodesByTranslator?.[info.defaultTranslator]).toEqual(info.seasons)
  })

  it('calls a season a series even with one episode out, so it can be followed', () => {
    expect(kodikSeasonInfo(player, seasonPage([1]))?.isSeries).toBe(true)
  })

  it('reads the season from the series address when the page does not say', () => {
    const serial = parseKodikPlayer('https://kodikplayer.com/serial/54001/abc123/720p?season=3')!
    const page = seasonPage([1, 2]).replace('var seasonNumber = Number(1);', '')
    expect(kodikSeasonInfo(serial, page)?.seasons[0].season).toBe(3)
  })

  it('gives nothing for a page without episodes, rather than an empty picker', () => {
    expect(kodikSeasonInfo(player, SERIA_PAGE)).toBeUndefined()
  })
})

/*
  An episode or film resolved straight to Kodik's playlist was shown to the
  engine, which found no codecs named in it and so no format worth listing:
  detection said there was nothing to download at a link that plays fine.
*/
describe('kodikSingleInfo', () => {
  const seria = parseKodikPlayer('https://kodikplayer.com/seria/1674742/73b56ca9/720p')!
  const film = parseKodikPlayer('https://kodikplayer.com/video/25135/b57cd290/720p')!

  it('offers the heights Kodik listed, under the dub the page names', () => {
    const info = kodikSingleInfo(seria, SERIA_PAGE, ['360p', '480p', '720p'])
    expect(info.isSeries).toBe(false)
    expect(info.qualities).toEqual(['360p', '480p', '720p'])
    expect(info.translators.map((t) => t.name)).toEqual(['AniDUB'])
    expect(b64urlDecode(info.defaultTranslator)).toBe(seria.url)
  })

  it('stands the id in for a title, since every single player is called "Kodik Player"', () => {
    expect(kodikSingleInfo(seria, SERIA_PAGE, []).title).toBe('Kodik 1674742')
  })

  it('calls an episode an episode and a film a film', () => {
    expect(kodikSingleInfo(seria, SERIA_PAGE, []).loneEpisode).toBe(true)
    expect(kodikSingleInfo(film, SERIA_PAGE, []).loneEpisode).toBeUndefined()
  })

  it('still offers the usual heights if Kodik named none', () => {
    expect(kodikSingleInfo(film, SERIA_PAGE, []).qualities).toEqual(['360p', '480p', '720p'])
  })
})

describe('kodikOnPage', () => {
  const seria = parseKodikPlayer('https://kodikplayer.com/seria/1674742/73b56ca9/720p')!
  const season = parseKodikPlayer('https://kodikplayer.com/season/94795/d5a209e9/720p')!
  const single = {
    url: 'https://cdn.test/720.mp4:hls:manifest.m3u8',
    referer: 'https://kodikplayer.com/',
    title: 'Kodik 1674742',
    streaming: kodikSingleInfo(seria, SERIA_PAGE, ['720p']),
    downloadUrl: kodikStreamUrl(seria.url, 1, '720p')
  }
  const series = {
    url: season.url,
    streaming: kodikSeasonInfo(season, seasonPage([1, 2, 3]))!
  }
  const page = { title: 'Frieren episode 5', thumbnail: 'https://anime.test/poster.jpg' }

  it("names an episode after the page, which names the show where Kodik's player does not", () => {
    const found = kodikOnPage(single, page)!
    expect(found.streaming?.title).toBe('Frieren episode 5')
    expect(found.streaming?.thumbnail).toBe('https://anime.test/poster.jpg')
    expect(found.downloadUrl).toBe(single.downloadUrl)
  })

  it('gives a queued item the stream itself, with no picker in the way', () => {
    const found = kodikOnPage(single, page, true)!
    expect(found.streaming).toBeUndefined()
    expect(found.url).toBe(single.url)
    expect(found.title).toBe('Frieren episode 5')
  })

  it("keeps a season's own title, which says which season it is", () => {
    expect(kodikOnPage(series, page)?.streaming?.title).toBe('Фрирен [ТВ-1] - 1 сезон')
  })

  it('gives a queued item nothing for a season, which has no one stream', () => {
    expect(kodikOnPage(series, page, true)).toBeNull()
  })

  it('gives nothing for an answer that is not a Kodik one', () => {
    expect(kodikOnPage({ url: 'https://kodikplayer.com/uv/abc' }, page)).toBeNull()
  })
})

describe('kodikStreamUrl', () => {
  it('carries the player, the episode and the height', () => {
    const url = kodikStreamUrl('https://kodikplayer.com/seria/1/ab/720p', 1, '720p')
    expect(url.startsWith(KODIK_SCHEME)).toBe(true)
    const [tid, episode, quality] = url.slice(KODIK_SCHEME.length).split('/')
    expect(b64urlDecode(tid)).toBe('https://kodikplayer.com/seria/1/ab/720p')
    expect([episode, quality]).toEqual(['1', '720p'])
  })
})

describe('resolveKodikPlayer', () => {
  it('refuses a /uv/ player in words a person can act on, without asking Kodik', async () => {
    const err = await resolveKodikPlayer('https://kodikplayer.com/uv/abc').catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    const classified = classifyYtdlpError((err as Error).message, false)
    expect(classified.code).toBe('unsupportedPlayer')
    expect(classified.cookieHint).toBe(false)
  })
})
