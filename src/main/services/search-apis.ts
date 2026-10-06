import { fetchText } from '../resolvers/http'
import type { SearchResponse, SearchResult } from '@shared/types'

/*
  Dailymotion, Niconico and Bilibili are searched through the sites' own
  public JSON APIs rather than through the engine.

  The engine's way never worked for them: `bilisearch` answers with bare ids
  and no titles (so every entry was filtered out), `nicosearch` answers with
  nothing, and Dailymotion's search page is rendered by script, so handing the
  engine its URL yielded "Downloading 0 items". Three of the seven services
  said "nothing found" to every query. These APIs answer in a fraction of the
  time a yt-dlp process takes to start, and `fetchText` goes through the same
  proxy as the rest of the app's own requests.

  The parsers are kept apart from the fetches so the tests can feed them the
  sites' real answer shapes without a network.
*/

/** What the search APIs are asked to keep a page to. */
const PAGE_LIMIT = 30

// ---- Dailymotion ----

interface DailymotionVideo {
  id?: string
  title?: string
  thumbnail_480_url?: string
  duration?: number
  'owner.screenname'?: string
  views_total?: number
}

const DAILYMOTION_FIELDS = 'id,title,thumbnail_480_url,duration,owner.screenname,views_total'

export function dailymotionSearchUrl(query: string, limit: number): string {
  /*
    `no_live` because a search result is something to keep: queueing a live
    stream from the grid would start a recording that never ends on its own.
  */
  return (
    `https://api.dailymotion.com/videos?search=${encodeURIComponent(query)}` +
    `&fields=${DAILYMOTION_FIELDS}&flags=no_live&limit=${clampLimit(limit)}`
  )
}

export function parseDailymotion(raw: string): SearchResult[] {
  const list = (JSON.parse(raw) as { list?: DailymotionVideo[] }).list ?? []
  return list
    .filter((v) => v.id && v.title)
    .map((v) => ({
      id: `dm-${v.id}`,
      title: plainText(v.title!),
      url: `https://www.dailymotion.com/video/${v.id}`,
      thumbnail: httpsUrl(v.thumbnail_480_url),
      duration: positive(v.duration),
      uploader: v['owner.screenname'] || undefined,
      viewCount: count(v.views_total),
      service: 'dailymotion' as const
    }))
}

export async function searchDailymotion(query: string, limit: number): Promise<SearchResult[]> {
  return parseDailymotion(await fetchText(dailymotionSearchUrl(query, limit)))
}

// ---- Niconico ----

interface NiconicoVideo {
  contentId?: string
  title?: string
  thumbnailUrl?: string
  lengthSeconds?: number
  viewCounter?: number
}

/**
 * The snapshot API asks every caller to name itself in `_context`, so the
 * service can tell who is sending what; it refuses a request without one.
 */
const NICONICO_CONTEXT = 'universal-video-downloader'

export function niconicoSearchUrl(query: string, limit: number): string {
  /*
    Titles only, most viewed first. Searching tags and descriptions too pulls
    in every video that merely mentions the words. The API's own `_score`
    order puts the shortest exact titles first, which turn out to be uploads
    with a few dozen views; by views, the first page is the videos a person
    searching for that title most likely means.
  */
  return (
    'https://snapshot.search.nicovideo.jp/api/v2/snapshot/video/contents/search' +
    `?q=${encodeURIComponent(query)}&targets=title` +
    '&fields=contentId,title,viewCounter,lengthSeconds,thumbnailUrl' +
    `&_sort=-viewCounter&_limit=${clampLimit(limit)}&_context=${NICONICO_CONTEXT}`
  )
}

export function parseNiconico(raw: string): SearchResult[] {
  const data = (JSON.parse(raw) as { data?: NiconicoVideo[] }).data ?? []
  return data
    .filter((v) => v.contentId && v.title)
    .map((v) => ({
      id: `nico-${v.contentId}`,
      title: plainText(v.title!),
      url: `https://www.nicovideo.jp/watch/${v.contentId}`,
      thumbnail: httpsUrl(v.thumbnailUrl),
      duration: positive(v.lengthSeconds),
      viewCount: count(v.viewCounter),
      service: 'niconico' as const
    }))
}

export async function searchNiconico(query: string, limit: number): Promise<SearchResult[]> {
  return parseNiconico(await fetchText(niconicoSearchUrl(query, limit)))
}

// ---- Bilibili ----

interface BilibiliVideo {
  bvid?: string
  title?: string
  author?: string
  play?: number | string
  /** "mm:ss", but the minutes run past 59: "204:29" is three and a half hours. */
  duration?: string
  /** Protocol-relative: "//i0.hdslb.com/bfs/archive/….jpg". */
  pic?: string
}

interface BilibiliAnswer {
  code?: number
  data?: { result?: BilibiliVideo[] }
}

const BILIBILI_REFERER = 'https://www.bilibili.com/'

/**
 * A Bilibili length in seconds.
 *
 * The API writes it as minutes and seconds, but never rolls the minutes over
 * into hours ("204:29"), and doesn't always pad the seconds ("62:0"). Folding
 * the parts from the left reads all of those, and an "h:mm:ss" too should it
 * ever start sending one.
 */
export function bilibiliDuration(text: string | undefined): number | undefined {
  if (!text) return undefined
  const parts = text.trim().split(':')
  if (!parts.every((p) => /^\d+$/.test(p))) return undefined
  return positive(parts.reduce((total, part) => total * 60 + Number(part), 0))
}

/**
 * A Bilibili cover at grid size.
 *
 * The covers come at full resolution - a third of a megabyte each, twelve to a
 * page - and the image service resizes on request when the path ends in
 * `@<w>w_<h>h_1c.jpg`. A tile is 16:9 and a few hundred pixels wide.
 */
function bilibiliCover(pic: string | undefined): string | undefined {
  const url = httpsUrl(pic)
  if (!url) return undefined
  return /\.(jpe?g|png|webp)$/i.test(url) && !url.includes('@') ? `${url}@480w_270h_1c.jpg` : url
}

/**
 * The results of one answer from the search API, or `null` when the answer is
 * not a search result at all.
 *
 * `null` is the anti-bot check talking. Without a device cookie, about one
 * call in three gets an HTML error page served with a 200, and a call it has
 * flagged gets JSON with a non-zero code. Neither means "nothing found", so
 * neither may be reported as an empty list.
 */
export function parseBilibili(raw: string): SearchResult[] | null {
  if (!raw.trimStart().startsWith('{')) return null
  let answer: BilibiliAnswer
  try {
    answer = JSON.parse(raw) as BilibiliAnswer
  } catch {
    return null
  }
  if (answer.code !== 0) return null
  return (answer.data?.result ?? [])
    .filter((v) => v.bvid && v.title)
    .map((v) => ({
      id: `bili-${v.bvid}`,
      // Matched words arrive wrapped in <em class="keyword">, and the rest is HTML-escaped.
      title: htmlText(v.title!),
      url: `https://www.bilibili.com/video/${v.bvid}`,
      thumbnail: bilibiliCover(v.pic),
      duration: bilibiliDuration(v.duration),
      uploader: v.author || undefined,
      viewCount: count(typeof v.play === 'string' ? Number(v.play) : v.play),
      service: 'bilibili' as const
    }))
}

/*
  The device cookie the anti-bot check looks for, fetched once and kept for
  the session. Kept as the promise, so a burst of searches shares one
  handshake instead of racing to make several.
*/
let bilibiliDevice: Promise<string> | undefined

function bilibiliCookie(fresh: boolean): Promise<string> {
  if (fresh || !bilibiliDevice) {
    const pending = fetchText('https://api.bilibili.com/x/frontend/finger/spi', {
      Referer: BILIBILI_REFERER
    }).then((raw) => {
      const data = (JSON.parse(raw) as { data?: { b_3?: string; b_4?: string } }).data
      if (!data?.b_3) throw new Error('Bilibili sent no device id.')
      return data.b_4 ? `buvid3=${data.b_3}; buvid4=${data.b_4}` : `buvid3=${data.b_3}`
    })
    bilibiliDevice = pending
    // A failed handshake is not kept: the next search asks again.
    pending.catch(() => {
      if (bilibiliDevice === pending) bilibiliDevice = undefined
    })
  }
  return bilibiliDevice
}

export function bilibiliSearchUrl(query: string, limit: number): string {
  return (
    'https://api.bilibili.com/x/web-interface/search/type?search_type=video' +
    `&keyword=${encodeURIComponent(query)}&page=1&page_size=${clampLimit(limit)}`
  )
}

export async function searchBilibili(query: string, limit: number): Promise<SearchResponse> {
  const url = bilibiliSearchUrl(query, limit)
  // A turned-away answer gets one more try on a new device cookie, which is
  // usually all it takes; a second refusal is reported rather than retried.
  for (let attempt = 0; attempt < 2; attempt++) {
    // Without the cookie the search still answers more often than not, so a
    // failed handshake is no reason to give up before trying.
    const cookie = await bilibiliCookie(attempt > 0).catch(() => '')
    const headers: Record<string, string> = { Referer: BILIBILI_REFERER }
    if (cookie) headers.Cookie = cookie
    let raw: string
    try {
      raw = await fetchText(url, headers)
    } catch (err) {
      // The same check sometimes answers with a bare 412 instead of a page.
      if (err instanceof Error && err.message === 'HTTP 412') continue
      throw err
    }
    const results = parseBilibili(raw)
    if (results) return { ok: true, results: results.slice(0, clampLimit(limit)) }
  }
  return {
    ok: false,
    error: 'Bilibili turned the search away with its anti-bot check. Wait a minute and try again.',
    errorCode: 'rateLimited'
  }
}

// ---- Shared ----

function clampLimit(limit: number): number {
  return Math.max(1, Math.min(PAGE_LIMIT, Math.round(limit) || 1))
}

function positive(n: number | undefined): number | undefined {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined
}

function count(n: number | undefined): number | undefined {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined
}

/** Protocol-relative and plain-http image URLs, made https so the page will load them. */
function httpsUrl(u: string | undefined): string | undefined {
  if (!u) return undefined
  if (u.startsWith('//')) return `https:${u}`
  if (u.startsWith('http://')) return `https://${u.slice('http://'.length)}`
  return u.startsWith('https://') ? u : undefined
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' '
}

/**
 * A title fit to become a file name and an argument: control characters gone,
 * because a NUL in an argument makes `spawn` throw instead of starting the
 * engine, and runs of whitespace folded to one space.
 */
export function plainText(s: string): string {
  return s
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * A title written as HTML, as text: tags dropped, then entities decoded.
 *
 * Only for an API that really sends markup. Dailymotion and Niconico send
 * plain text, where "<3" or "a < b" is part of the title, and stripping tags
 * there would cut it short.
 *
 * Entities are decoded in a single pass, so an escaped entity ("&amp;lt;")
 * comes out as the text it stood for ("&lt;") instead of being decoded twice.
 */
export function htmlText(s: string): string {
  return plainText(
    s
      .replace(/<[^>]*>/g, '')
      .replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]+);/gi, (whole, name: string) => {
        if (name[0] !== '#') return NAMED_ENTITIES[name.toLowerCase()] ?? whole
        const hex = name[1] === 'x' || name[1] === 'X'
        const code = hex ? parseInt(name.slice(2), 16) : Number(name.slice(1))
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
      })
  )
}
