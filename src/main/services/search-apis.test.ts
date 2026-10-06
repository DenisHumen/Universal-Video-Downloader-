import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bilibiliDuration,
  bilibiliSearchUrl,
  dailymotionSearchUrl,
  htmlText,
  niconicoSearchUrl,
  parseBilibili,
  parseDailymotion,
  parseNiconico,
  plainText
} from './search-apis'

/*
  The fixtures follow the answers the three APIs gave when this was written,
  trimmed to the fields that are read. They are written out here rather than
  saved as captures so each one says what it is about.
*/

const fetchText = vi.hoisted(() => vi.fn())
vi.mock('../resolvers/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../resolvers/http')>()),
  fetchText
}))

beforeEach(() => {
  fetchText.mockReset()
})

describe('parseDailymotion', () => {
  const answer = JSON.stringify({
    page: 1,
    limit: 3,
    total: 1000,
    has_more: true,
    list: [
      {
        id: 'x9gt1t4',
        title: 'Mr. LOFI Winter LOFI 🎼',
        thumbnail_480_url: 'https://s1.dmcdn.net/v/Y7e9e1e0Gn6xIuhTY/x480',
        duration: 240,
        'owner.screenname': 'Mr.LOFI',
        views_total: 23
      },
      { id: 'x8l2csk', title: 'a <3 b & c', duration: 0, views_total: 0 },
      { id: 'x0broken' }
    ]
  })

  it('maps a video to its watch page, cover, length, channel and views', () => {
    const [first] = parseDailymotion(answer)
    expect(first).toEqual({
      id: 'dm-x9gt1t4',
      title: 'Mr. LOFI Winter LOFI 🎼',
      url: 'https://www.dailymotion.com/video/x9gt1t4',
      thumbnail: 'https://s1.dmcdn.net/v/Y7e9e1e0Gn6xIuhTY/x480',
      duration: 240,
      uploader: 'Mr.LOFI',
      viewCount: 23,
      service: 'dailymotion'
    })
  })

  it('keeps a plain-text title whole, markup-looking characters and all', () => {
    expect(parseDailymotion(answer)[1].title).toBe('a <3 b & c')
  })

  it('reads a zero length as unknown, and a zero view count as zero', () => {
    const second = parseDailymotion(answer)[1]
    expect(second.duration).toBeUndefined()
    expect(second.viewCount).toBe(0)
  })

  it('drops an entry without a title rather than showing an untitled tile', () => {
    expect(parseDailymotion(answer).map((r) => r.id)).toEqual(['dm-x9gt1t4', 'dm-x8l2csk'])
  })

  it('asks for the fields it reads, and no live streams', () => {
    const url = new URL(dailymotionSearchUrl('lofi hip hop', 6))
    expect(url.searchParams.get('search')).toBe('lofi hip hop')
    expect(url.searchParams.get('fields')).toBe(
      'id,title,thumbnail_480_url,duration,owner.screenname,views_total'
    )
    expect(url.searchParams.get('flags')).toBe('no_live')
    expect(url.searchParams.get('limit')).toBe('6')
  })
})

describe('parseNiconico', () => {
  const answer = JSON.stringify({
    meta: { status: 200, totalCount: 505 },
    data: [
      {
        contentId: 'sm39911997',
        lengthSeconds: 1805,
        thumbnailUrl: 'https://nicovideo.cdn.nimg.jp/thumbnails/39911997/39911997.1147574',
        title: '【作業用BGM】lofi KYOIKU RADIO',
        viewCounter: 7419
      },
      { contentId: 'sm1', title: '' }
    ]
  })

  it('maps a video to its watch page, with the length and views it reports', () => {
    expect(parseNiconico(answer)).toEqual([
      {
        id: 'nico-sm39911997',
        title: '【作業用BGM】lofi KYOIKU RADIO',
        url: 'https://www.nicovideo.jp/watch/sm39911997',
        thumbnail: 'https://nicovideo.cdn.nimg.jp/thumbnails/39911997/39911997.1147574',
        duration: 1805,
        viewCount: 7419,
        service: 'niconico'
      }
    ])
  })

  it('searches titles, most viewed first, and names the app as the API asks', () => {
    const url = new URL(niconicoSearchUrl('naruto 1', 12))
    expect(url.searchParams.get('q')).toBe('naruto 1')
    expect(url.searchParams.get('targets')).toBe('title')
    expect(url.searchParams.get('_sort')).toBe('-viewCounter')
    expect(url.searchParams.get('_limit')).toBe('12')
    expect(url.searchParams.get('_context')).toBeTruthy()
  })

  it('keeps the page within what the API allows', () => {
    expect(new URL(niconicoSearchUrl('a', 500)).searchParams.get('_limit')).toBe('30')
    expect(new URL(niconicoSearchUrl('a', 0)).searchParams.get('_limit')).toBe('1')
  })
})

describe('bilibiliDuration', () => {
  it('reads minutes that run past an hour', () => {
    // Three and a half hours, written the way the API writes it.
    expect(bilibiliDuration('204:29')).toBe(204 * 60 + 29)
  })

  it('reads unpadded seconds', () => {
    expect(bilibiliDuration('62:0')).toBe(62 * 60)
  })

  it('reads the ordinary case, and an hours field should one appear', () => {
    expect(bilibiliDuration('23:40')).toBe(23 * 60 + 40)
    expect(bilibiliDuration('1:02:03')).toBe(3723)
  })

  it('says nothing rather than guessing at a length it cannot read', () => {
    expect(bilibiliDuration('')).toBeUndefined()
    expect(bilibiliDuration(undefined)).toBeUndefined()
    expect(bilibiliDuration('--:--')).toBeUndefined()
    expect(bilibiliDuration('0:00')).toBeUndefined()
  })
})

describe('parseBilibili', () => {
  const answer = (result: unknown[], code = 0): string =>
    JSON.stringify({ code, message: 'OK', ttl: 1, data: { page: 1, pagesize: 20, result } })

  const video = {
    type: 'video',
    id: 115905665173711,
    bvid: 'BV1u9rkBrErY',
    title: '《<em class="keyword">NARUTO</em>》第一回 &amp; Sasuke&#39;s &quot;return&quot;',
    author: 'SEK-Y',
    play: 12421,
    duration: '204:29',
    pic: '//i0.hdslb.com/bfs/archive/a70c4ba45ed3d151ed0ef1fdea327cb3571f0f7b.jpg'
  }

  it('maps a video to its page, cleaned title, grid-sized cover, length, author and plays', () => {
    expect(parseBilibili(answer([video]))).toEqual([
      {
        id: 'bili-BV1u9rkBrErY',
        title: '《NARUTO》第一回 & Sasuke\'s "return"',
        url: 'https://www.bilibili.com/video/BV1u9rkBrErY',
        thumbnail:
          'https://i0.hdslb.com/bfs/archive/a70c4ba45ed3d151ed0ef1fdea327cb3571f0f7b.jpg@480w_270h_1c.jpg',
        duration: 204 * 60 + 29,
        uploader: 'SEK-Y',
        viewCount: 12421,
        service: 'bilibili'
      }
    ])
  })

  it('reads an unpadded length inside a real answer', () => {
    expect(parseBilibili(answer([{ ...video, duration: '62:0' }]))![0].duration).toBe(3720)
  })

  it('treats a play count it cannot read as unknown', () => {
    expect(parseBilibili(answer([{ ...video, play: '--' }]))![0].viewCount).toBeUndefined()
  })

  it('reports an empty search as an empty list', () => {
    expect(parseBilibili(answer([]))).toEqual([])
    expect(parseBilibili(JSON.stringify({ code: 0, data: {} }))).toEqual([])
  })

  it('tells a refusal apart from an empty search', () => {
    // The anti-bot check's HTML page, served with a 200.
    expect(parseBilibili('<!DOCTYPE html>\n<html lang="zh-cn"><head></head></html>')).toBeNull()
    // A flagged call: JSON, but not a result.
    expect(parseBilibili(answer([video], -412))).toBeNull()
    expect(parseBilibili('{ truncated')).toBeNull()
  })

  it('asks for the video tab, one page of the size wanted', () => {
    const url = new URL(bilibiliSearchUrl('lofi', 6))
    expect(url.searchParams.get('search_type')).toBe('video')
    expect(url.searchParams.get('keyword')).toBe('lofi')
    expect(url.searchParams.get('page_size')).toBe('6')
  })
})

describe('htmlText and plainText', () => {
  it('drops tags before decoding, so escaped markup survives as text', () => {
    expect(htmlText('<em class="keyword">a</em> &lt;b&gt;')).toBe('a <b>')
  })

  it('decodes once, so an escaped entity stays the entity it stood for', () => {
    expect(htmlText('&amp;lt;')).toBe('&lt;')
  })

  it('decodes numeric entities, decimal and hex, and leaves unknown names alone', () => {
    expect(htmlText('&#34;x&#x27;&#39;')).toBe('"x\'\'')
    expect(htmlText('&copy2; &bogus;')).toBe('&copy2; &bogus;')
  })

  it('removes control characters a title must not carry into a file name', () => {
    expect(plainText('a\u0000b\nc\t d')).toBe('a b c d')
  })
})

describe('searchBilibili', () => {
  const spi = JSON.stringify({ code: 0, data: { b_3: 'DEVICE-3', b_4: 'DEVICE-4' } })
  const ok = JSON.stringify({ code: 0, data: { result: [{ bvid: 'BV1', title: 'one', duration: '1:00' }] } })
  const page = '<!DOCTYPE html><html></html>'

  /*
    The device cookie is kept for the session, in the module. Each test takes
    a fresh copy of the module so one test's cookie is not the next one's.
  */
  const fresh = async (): Promise<typeof import('./search-apis')> => {
    vi.resetModules()
    return import('./search-apis')
  }

  /** Answer the handshake with a device id, and searches with `searches` in turn. */
  const route = (searches: (string | Error)[]): void => {
    fetchText.mockImplementation(async (url: string) => {
      if (url.includes('/finger/spi')) return spi
      const next = searches.shift()
      if (next instanceof Error) throw next
      return next ?? page
    })
  }

  const searchCalls = (): [string, Record<string, string>][] =>
    fetchText.mock.calls.filter(([url]) => !String(url).includes('/finger/spi')) as [
      string,
      Record<string, string>
    ][]

  it('sends the device cookie and the referer the search wants', async () => {
    const { searchBilibili } = await fresh()
    route([ok])
    const res = await searchBilibili('lofi', 6)
    expect(res.ok).toBe(true)
    expect(res.results?.map((r) => r.url)).toEqual(['https://www.bilibili.com/video/BV1'])
    const [, headers] = searchCalls()[0]
    expect(headers.Cookie).toBe('buvid3=DEVICE-3; buvid4=DEVICE-4')
    expect(headers.Referer).toBe('https://www.bilibili.com/')
  })

  it('asks for the device id once and keeps it for later searches', async () => {
    const { searchBilibili } = await fresh()
    route([ok, ok])
    await searchBilibili('a', 6)
    await searchBilibili('b', 6)
    expect(fetchText.mock.calls.filter(([url]) => String(url).includes('/finger/spi'))).toHaveLength(1)
  })

  it('tries once more on a new device id when turned away', async () => {
    const { searchBilibili } = await fresh()
    route([page, ok])
    const res = await searchBilibili('lofi', 6)
    expect(res.ok).toBe(true)
    expect(searchCalls()).toHaveLength(2)
    expect(fetchText.mock.calls.filter(([url]) => String(url).includes('/finger/spi'))).toHaveLength(2)
  })

  it('treats a bare 412 as the same refusal', async () => {
    const { searchBilibili } = await fresh()
    route([new Error('HTTP 412'), ok])
    expect((await searchBilibili('lofi', 6)).ok).toBe(true)
  })

  it('says it was turned away, in words, after a second refusal', async () => {
    const { searchBilibili } = await fresh()
    route([page, page])
    const res = await searchBilibili('lofi', 6)
    expect(res.ok).toBe(false)
    expect(res.errorCode).toBe('rateLimited')
    expect(res.error).toMatch(/Bilibili/)
    expect(searchCalls()).toHaveLength(2)
  })

  it('still searches when the handshake itself fails', async () => {
    const { searchBilibili } = await fresh()
    fetchText.mockImplementation(async (url: string) => {
      if (url.includes('/finger/spi')) throw new Error('HTTP 503')
      return ok
    })
    const res = await searchBilibili('lofi', 6)
    expect(res.ok).toBe(true)
    expect(searchCalls()[0][1].Cookie).toBeUndefined()
  })

  it('lets a network failure through for the caller to describe', async () => {
    const { searchBilibili } = await fresh()
    route([new Error('Request timed out')])
    await expect(searchBilibili('lofi', 6)).rejects.toThrow('Request timed out')
  })
})

/*
  The real APIs, through the same URLs and parsers. Off by default - CI has no
  business depending on three foreign sites being up - and run by hand with
  UVD_LIVE_SEARCH=1 npx vitest run src/main/services/search-apis.test.ts
  when one of them seems to have changed.
*/
const live = process.env.UVD_LIVE_SEARCH ? describe : describe.skip

live('the live search APIs', () => {
  const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  const get = async (url: string, headers: Record<string, string> = {}): Promise<string> =>
    (await fetch(url, { headers: { 'User-Agent': UA, ...headers } })).text()

  it('Dailymotion answers with titled videos', async () => {
    const results = parseDailymotion(await get(dailymotionSearchUrl('lofi', 3)))
    expect(results.length).toBeGreaterThan(0)
  }, 20_000)

  it('Niconico answers with titled videos', async () => {
    const results = parseNiconico(await get(niconicoSearchUrl('lofi', 3)))
    expect(results.length).toBeGreaterThan(0)
  }, 20_000)

  it('Bilibili answers with titled videos once it has a device id', async () => {
    const device = JSON.parse(await get('https://api.bilibili.com/x/frontend/finger/spi')) as {
      data: { b_3: string; b_4: string }
    }
    const raw = await get(bilibiliSearchUrl('lofi', 3), {
      Referer: 'https://www.bilibili.com/',
      Cookie: `buvid3=${device.data.b_3}; buvid4=${device.data.b_4}`
    })
    expect(parseBilibili(raw)?.length).toBeGreaterThan(0)
  }, 20_000)
})
