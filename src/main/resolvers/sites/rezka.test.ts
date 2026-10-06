import { describe, expect, it } from 'vitest'
import { classifyYtdlpError } from '../../services/options'
import {
  isBotCheck,
  labelHeight,
  parseEpisodeReply,
  parseEpisodes,
  parseStreamReply,
  parseStreams,
  parseTranslators,
  pickQuality,
  rezkaEpisodeUrl,
  rezkaTitleId
} from './rezka'

/*
  Every rezka mirror answers a browser's user agent with Anubis's proof-of-work
  page, a 200 with HTML in it. Nothing recognised it: the page parser found no
  title id and handed the link back untouched, and the stream API's caller fed
  it to JSON.parse, so each queued episode failed with "Unexpected token '<'".
  Trimmed from the page rezka.ag served on 2026-10-05.
*/
const ANUBIS_PAGE = [
  '<!doctype html><html lang="ru"><head><title>Проверяем, что вы не бот!</title>',
  '<link rel="stylesheet" href="/.within.website/x/xess/xess.min.css?cachebuster=v1.27.0">',
  '<script id="anubis_version" type="application/json">"v1.27.0"</script>',
  '<script id="anubis_challenge" type="application/json">{"rules":{"algorithm":"fast","difficulty":2}}</script>',
  '</head><body id="top"><main><h1 id="title" class="centered-div">Проверяем, что вы не бот!</h1>',
  '<p id="status">Загрузка...</p>',
  '<script id="anubis-main" defer type="module" src="/.within.website/x/cmd/anubis/static/js/main.mjs"></script>',
  '</main></body></html>'
].join('')

const REAL_PAGE = [
  '<!DOCTYPE html><html><head>',
  '<title>Смотреть аниме Чёрный клевер [ТВ-2] онлайн бесплатно в хорошем качестве</title>',
  '<meta property="og:image" content="https://static.hdrezka.ac/i/2026/10/4/poster.jpg">',
  '</head><body><h1 itemprop="name">Чёрный клевер [ТВ-2]</h1>',
  '<ul id="translators-list" class="b-translators__list">',
  '<li title="AniLibria" class="b-translator__item active" data-translator_id="19">AniLibria</li>',
  '<li title="FanVoxUA " class="b-translator__item" data-translator_id="444">FanVoxUA <img title="Украинский" src="ua.png"></li>',
  '</ul>',
  '<li class="b-simple_episode__item active" data-id="92915" data-season_id="2" data-episode_id="1">Серия 1</li>',
  "<script>sof.tv.initCDNSeriesEvents(92915, 19, 2, 1, false, 'rezka.ag', false, false, {});</script>",
  '</body></html>'
].join('')

describe('isBotCheck', () => {
  it('recognises the Anubis challenge', () => {
    expect(isBotCheck(ANUBIS_PAGE)).toBe(true)
  })

  it('recognises it in English too', () => {
    expect(isBotCheck("<html><head><title>Making sure you're not a bot!</title></head></html>")).toBe(true)
  })

  it('leaves a real title page alone', () => {
    expect(isBotCheck(REAL_PAGE)).toBe(false)
  })

  it('leaves the stream API’s JSON alone', () => {
    expect(isBotCheck('{"success":true,"url":"[360p]https://cdn.test/a.mp4"}')).toBe(false)
  })
})

describe('parseStreamReply', () => {
  it('reads the streams out of a good answer', () => {
    const raw = JSON.stringify({ success: true, premium_content: 0, url: '[720p]https://cdn.test/720.mp4' })
    expect(parseStreamReply(raw).map((s) => s.quality)).toEqual(['720p'])
  })

  it('says a bot check is a bot check, not a SyntaxError', () => {
    expect(() => parseStreamReply(ANUBIS_PAGE)).toThrow(/bot check/)
  })

  it('says something readable about any other answer that is not JSON', () => {
    let thrown: unknown
    try {
      parseStreamReply('<html><body>502 Bad Gateway</body></html>')
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).not.toBeInstanceOf(SyntaxError)
    expect((thrown as Error).message).toMatch(/HDrezka/)
    expect((thrown as Error).message).not.toMatch(/Unexpected token|JSON/)
  })

  it('keeps Premium for what actually is Premium', () => {
    const raw = JSON.stringify({ success: true, premium_content: 1, url: false })
    expect(() => parseStreamReply(raw)).toThrow(/Premium/)
  })

  it('does not call a missing episode Premium', () => {
    // What rezka sends for an episode a dub does not have: "session expired".
    const raw = JSON.stringify({
      success: false,
      message: 'Время сессии истекло. Пожалуйста, обновите страницу и повторите попытку.'
    })
    expect(() => parseStreamReply(raw)).toThrow(/no stream/)
    expect(() => parseStreamReply(raw)).not.toThrow(/Premium/)
  })
})

/*
  The resolver's own sentences are shown as written only when no rule in the
  error classifier claims them. "Instead of the page" would have been claimed:
  the age-restriction rule's bare "age" matches "page".
*/
describe('rezka’s errors reach the user as written', () => {
  const messages = (): string[] => {
    const out: string[] = []
    for (const raw of [
      ANUBIS_PAGE,
      'not json',
      JSON.stringify({ success: false }),
      JSON.stringify({ success: true, url: false, premium_content: 1 })
    ]) {
      try {
        parseStreamReply(raw)
      } catch (err) {
        out.push((err as Error).message)
      }
    }
    try {
      parseEpisodeReply(JSON.stringify({ success: false }))
    } catch (err) {
      out.push((err as Error).message)
    }
    return out
  }

  it('matches no classifier rule', () => {
    const all = messages()
    expect(all).toHaveLength(5)
    for (const message of all) {
      expect(classifyYtdlpError(message, false)).toEqual({ message, cookieHint: false })
    }
  })
})

describe('parseTranslators', () => {
  it('reads the <li> list rezka uses now', () => {
    // Only <a> was looked for, so every title offered one translator, "Default".
    expect(parseTranslators(REAL_PAGE)).toEqual([
      { id: '19', name: 'AniLibria', premium: false },
      { id: '444', name: 'FanVoxUA', premium: false }
    ])
  })

  it('still reads the linked list some titles have', () => {
    const html =
      '<ul id="translators-list"><li style="float: left;"><a title="Дубляж" class="b-translator__items" ' +
      'data-translator_id="56" href="/series/646-x/dub.html">Дубляж</a></li>' +
      '<li style="float: left;"><a title="лостфильм (LostFilm)" class="b-translator__items" ' +
      'data-translator_id="1" href="/series/646-x/lostfilm.html">лостфильм (LostFilm)</a></li></ul>'
    expect(parseTranslators(html).map((t) => [t.id, t.name])).toEqual([
      ['56', 'Дубляж'],
      ['1', 'лостфильм (LostFilm)']
    ])
  })

  it('marks Premium by the class, not by a studio’s name', () => {
    const html =
      '<li title="Premier" class="b-translator__item" data-translator_id="7">Premier</li>' +
      '<li title="HDrezka Studio" class="b-translator__item b-prem_translator" data-translator_id="8">HDrezka Studio</li>'
    expect(parseTranslators(html).map((t) => [t.id, t.premium])).toEqual([
      ['7', false],
      ['8', true]
    ])
  })
})

describe('episodes', () => {
  it('reads them off the page', () => {
    expect(parseEpisodes(REAL_PAGE)).toEqual([{ season: 2, episodes: [1] }])
  })

  it('reads them out of the answer to get_episodes', () => {
    const raw = JSON.stringify({
      success: true,
      episodes:
        '<ul id="simple-episodes-list-1"><li data-id="646" data-season_id="1" data-episode_id="2">Серия 2</li>' +
        '<li data-id="646" data-season_id="1" data-episode_id="1">Серия 1</li></ul>' +
        '<ul id="simple-episodes-list-2"><li data-id="646" data-season_id="2" data-episode_id="1">Серия 1</li></ul>'
    })
    expect(parseEpisodeReply(raw)).toEqual([
      { season: 1, episodes: [1, 2] },
      { season: 2, episodes: [1] }
    ])
  })

  it('says a bot check is a bot check there too', () => {
    expect(() => parseEpisodeReply(ANUBIS_PAGE)).toThrow(/bot check/)
  })
})

/*
  A watch keeps the page address the user pasted. The episode link was built by
  splicing that whole address in where the host and title id belong, with the
  translator left out, so the first episode a rezka watch found would have been
  queued as something nothing could resolve.
*/
describe('rezkaEpisodeUrl', () => {
  const clover = 'https://rezka.ag/animation/adventures/92915-chernyy-klever-tv-2-2026.html'
  const breakingBad = 'https://hdrezka.me/series/thriller/646-vo-vse-tyazhkie-2008.html'

  it('names the host, title, translator, episode and quality', () => {
    expect(rezkaEpisodeUrl(clover, '19', 2, 1, '720p')).toBe('uvd-rezka://rezka.ag/92915/19/2/1/720p')
  })

  it('falls back to best when the watch names no quality', () => {
    expect(rezkaEpisodeUrl(breakingBad, '56', 5, 16, '')).toBe('uvd-rezka://hdrezka.me/646/56/5/16/best')
  })

  it('reads the title from a translator’s own address as well', () => {
    const dubPage = 'https://rezka.ag/series/thriller/646-vo-vse-tyazhkie-2008-latest/mhxivesb-dublyazh.html'
    expect(rezkaTitleId(dubPage)).toBe('646')
  })

  it('refuses an address with no title number in it', () => {
    expect(() => rezkaEpisodeUrl('https://rezka.ag/series/', '19', 1, 1, 'best')).toThrow(/HDrezka title/)
  })
})

/*
  HDRezka labels its streams in free text and `4K` is one of them. Reading the
  label with `parseInt` gave 4, which put the best stream the site has below its
  worst — "best quality" always came back 1080p, and a request for 480p could be
  answered with the 4K stream, because 4 is less than 480.
*/
describe('labelHeight', () => {
  it('reads the ordinary labels', () => {
    expect(labelHeight('360p')).toBe(360)
    expect(labelHeight('480p')).toBe(480)
    expect(labelHeight('720p')).toBe(720)
    expect(labelHeight('1080p')).toBe(1080)
  })

  it('reads the ones written in K', () => {
    expect(labelHeight('4K')).toBe(2160)
    expect(labelHeight('2K')).toBe(1440)
    expect(labelHeight('8K')).toBe(4320)
  })

  it('gives up on a label with no number in it', () => {
    expect(labelHeight('auto')).toBe(0)
  })
})

describe('parseStreams', () => {
  const raw = '[360p]https://cdn.test/360.mp4,[1080p]https://cdn.test/1080.mp4,[4K]https://cdn.test/4k.mp4'

  it('sorts 4K above 1080p rather than below 360p', () => {
    expect(parseStreams(raw).map((s) => s.quality)).toEqual(['360p', '1080p', '4K'])
  })

  it('skips the tiers that need a subscription', () => {
    const withUltra = `${raw},[1080p Ultra]https://cdn.test/ultra.mp4`
    expect(parseStreams(withUltra).map((s) => s.quality)).not.toContain('1080p Ultra')
  })
})

describe('pickQuality', () => {
  const streams = parseStreams(
    '[360p]https://cdn.test/360.mp4,[1080p]https://cdn.test/1080.mp4,[4K]https://cdn.test/4k.mp4'
  )

  it('picks 4K for best', () => {
    expect(pickQuality(streams, 'best')?.quality).toBe('4K')
  })

  it('does not hand back 4K to someone who asked for 480p', () => {
    expect(pickQuality(streams, '480')?.quality).toBe('360p')
  })

  it('takes the nearest below the request', () => {
    expect(pickQuality(streams, '1080')?.quality).toBe('1080p')
    expect(pickQuality(streams, '2160')?.quality).toBe('4K')
  })

  it('falls back to the lowest when everything is above the request', () => {
    expect(pickQuality(streams, '240')?.quality).toBe('360p')
  })

  it('has nothing to say about an empty list', () => {
    expect(pickQuality([], 'best')).toBeUndefined()
  })
})
