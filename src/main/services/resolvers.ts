import { net } from 'electron'
import type { SearchResult, StreamingInfo, StreamSeason, StreamTranslator } from '@shared/types'

export interface ResolvedEntry {
  url: string
  title: string
  thumbnail?: string
}

export interface ResolvedUrl {
  /** URL to hand to the engine — a stream URL for resolved sites, else the input. */
  url: string
  referer?: string
  title?: string
  thumbnail?: string
  extractor?: string
  isPlaylist?: boolean
  playlistTitle?: string
  entries?: ResolvedEntry[]
  /** Rich streaming info for sites that need translator/episode/quality selection. */
  streaming?: StreamingInfo
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

function fetchText(url: string, headers: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, redirect: 'follow' })
    request.setHeader('User-Agent', UA)
    for (const [k, v] of Object.entries(headers)) request.setHeader(k, v)
    request.on('response', (response) => {
      if ((response.statusCode ?? 0) >= 400) {
        reject(new Error(`HTTP ${response.statusCode}`))
        return
      }
      let data = ''
      response.on('data', (c: Buffer) => (data += c.toString()))
      response.on('end', () => resolve(data))
      response.on('error', reject)
    })
    request.on('error', reject)
    request.end()
  })
}

function netPost(url: string, body: string, headers: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, method: 'POST', redirect: 'follow' })
    request.setHeader('User-Agent', UA)
    request.setHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8')
    request.setHeader('X-Requested-With', 'XMLHttpRequest')
    for (const [k, v] of Object.entries(headers)) request.setHeader(k, v)
    request.on('response', (response) => {
      if ((response.statusCode ?? 0) >= 400) {
        reject(new Error(`HTTP ${response.statusCode}`))
        return
      }
      let data = ''
      response.on('data', (c: Buffer) => (data += c.toString()))
      response.on('end', () => resolve(data))
      response.on('error', reject)
    })
    request.on('error', reject)
    request.write(body)
    request.end()
  })
}

function pick(re: RegExp, html: string): string | undefined {
  const m = html.match(re)
  return m ? m[1] : undefined
}

function slugToTitle(path: string): string {
  const slug = path.split('/').filter(Boolean).pop() || path
  return slug
    .replace(/-/g, ' ')
    .replace(/\bporn video\b/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// ---- cumgloryhole.se ----

const CGH = 'https://cumgloryhole.se'
const CGH_REFERER = 'https://cumgloryhole.se/'

async function resolveCghVideo(url: string): Promise<ResolvedUrl> {
  const html = await fetchText(url, { Referer: CGH_REFERER })
  const m3u8 = pick(/(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/, html)
  if (!m3u8) return { url }
  const rawTitle =
    pick(/<meta property="og:title" content="([^"]+)"/, html) || pick(/<title>([^<]+)<\/title>/, html) || ''
  const title = rawTitle.replace(/\s*[-|]\s*CumGloryHole.*$/i, '').trim()
  const thumbnail =
    pick(/<meta property="og:image" content="([^"]+)"/, html) ||
    pick(/(https?:\/\/[^"'\s]+\/cover\/[^"'\s]+\.(?:jpg|jpeg|webp))/, html)
  return { url: m3u8, referer: CGH_REFERER, title: title || undefined, thumbnail, extractor: 'CumGloryHole' }
}

async function resolveCghModel(url: string): Promise<ResolvedUrl> {
  const html = await fetchText(url, { Referer: CGH_REFERER })
  const paths = [...new Set([...html.matchAll(/href="(\/videos\/[^"]+)"/g)].map((m) => m[1]))]
  const entries: ResolvedEntry[] = paths.map((p) => ({ url: CGH + p, title: slugToTitle(p) }))
  const name = pick(/\/models\/[^/]+\/([^/?#]+)/, url) || 'playlist'
  return {
    url,
    isPlaylist: true,
    playlistTitle: slugToTitle('/' + name),
    entries,
    extractor: 'CumGloryHole'
  }
}

// ---- HDrezka (hdrezka / rezka and mirror domains) ----

// Matches any host containing "rezka": rezka.ag, hdrezka.me, rezka-tv.to, …
const REZKA_DOMAIN = /^https?:\/\/(?:[a-z0-9-]+\.)*[a-z0-9-]*rezka[a-z0-9-]*\.[a-z]{2,}\//i

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

function cleanHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '').trim()
}

interface RezkaStream {
  quality: string
  height: number
  url: string
}

function parseRezkaStreams(raw: string): RezkaStream[] {
  const out: RezkaStream[] = []
  const re = /\[([^\]]+)\]([^,]+?)(?=,\[|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    const label = cleanHtml(m[1])
    if (/ultra|premium/i.test(label)) continue // subscription-only tiers
    const url = m[2]
      .split(' or ')[0]
      .trim()
      .replace(/:hls:manifest\.m3u8$/i, '')
    if (!/^https?:\/\//.test(url)) continue
    out.push({ quality: label, height: parseInt(label, 10) || 0, url })
  }
  return out.sort((a, b) => a.height - b.height)
}

function pickQuality(streams: RezkaStream[], requested: string): RezkaStream | undefined {
  if (!streams.length) return undefined
  if (requested === 'best' || requested === 'audio' || !requested) return streams[streams.length - 1]
  const want = parseInt(requested, 10)
  const atOrBelow = streams.filter((s) => s.height <= want)
  return atOrBelow.length ? atOrBelow[atOrBelow.length - 1] : streams[0]
}

async function rezkaGetStreams(
  host: string,
  id: string,
  translatorId: string,
  season: string,
  episode: string
): Promise<RezkaStream[]> {
  const params = new URLSearchParams({
    id,
    translator_id: translatorId,
    action: season ? 'get_stream' : 'get_movie'
  })
  if (season) {
    params.set('season', season)
    params.set('episode', episode)
  }
  const raw = await netPost(
    `https://${host}/ajax/get_cdn_series/?t=${Date.now()}`,
    params.toString(),
    { Referer: `https://${host}/` }
  )
  const json = JSON.parse(raw) as { url?: string; success?: boolean; premium_content?: number }
  if (json.premium_content || !json.url) {
    throw new Error('This translation requires HDrezka Premium — it can’t be downloaded.')
  }
  return parseRezkaStreams(json.url)
}

async function resolveRezkaPage(url: string): Promise<ResolvedUrl> {
  const host = hostOf(url)
  const html = await fetchText(url, { Referer: `https://${host}/` })

  const sm = html.match(/initCDNSeriesEvents\((\d+),\s*(\d+),\s*(\d+),\s*(\d+),[^,]+,\s*'([^']+)'/)
  const mm = html.match(/initCDNMoviesEvents\((\d+),\s*(\d+)/)
  const isSeries = !!sm
  const id = isSeries ? sm![1] : mm ? mm[1] : pick(/data-post_id="(\d+)"/, html)
  if (!id) return { url }
  let defaultTranslator = isSeries ? sm![2] : mm ? mm[2] : '0'

  const translators: StreamTranslator[] = []
  const seen = new Set<string>()
  for (const tm of html.matchAll(/<a\b([^>]*\bdata-translator_id="(\d+)"[^>]*)>\s*([^<]*)/g)) {
    const attrs = tm[1]
    const tid = tm[2]
    const title = pick(/title="([^"]*)"/, attrs)
    const name = (title || tm[3] || '').trim()
    if (name && !seen.has(tid)) {
      seen.add(tid)
      translators.push({ id: tid, name, premium: /prem/i.test(attrs) })
    }
  }
  if (!translators.length) translators.push({ id: defaultTranslator, name: 'Default' })
  // Start on a free translation so the picker doesn't open on a locked one.
  if (!translators.some((t) => t.id === defaultTranslator && !t.premium)) {
    defaultTranslator = (translators.find((t) => !t.premium) ?? translators[0]).id
  }

  const epMap = new Map<number, Set<number>>()
  for (const em of html.matchAll(/data-season_id="(\d+)"\s+data-episode_id="(\d+)"/g)) {
    const s = Number(em[1])
    if (!epMap.has(s)) epMap.set(s, new Set())
    epMap.get(s)!.add(Number(em[2]))
  }
  const seasons: StreamSeason[] = [...epMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([season, set]) => ({ season, episodes: [...set].sort((a, b) => a - b) }))

  const h1 = pick(/<h1[^>]*>([^<]+)<\/h1>/, html) || ''
  const title =
    h1.split(/\s+[-–—]\s+/)[0].trim() || cleanHtml(pick(/<title>([^<]+)<\/title>/, html) || 'Video')
  const thumbnail = pick(/<meta property="og:image" content="([^"]+)"/, html)

  const streaming: StreamingInfo = {
    provider: 'rezka',
    host,
    id,
    title,
    thumbnail,
    isSeries,
    translators,
    defaultTranslator,
    seasons: isSeries ? seasons : [],
    qualities: ['360p', '480p', '720p', '1080p']
  }
  return { url, streaming, extractor: 'HDrezka', title, thumbnail }
}

// Internal scheme the UI builds per chosen episode:
//   uvd-rezka://<host>/<id>/<translatorId>/<season|movie>/<episode>/<quality>
async function resolveRezkaStream(uvdUrl: string): Promise<ResolvedUrl> {
  const rest = uvdUrl.replace(/^uvd-rezka:\/\//, '')
  const [host, id, translatorId, season, episode, quality] = rest.split('/')
  const isMovie = season === 'movie'
  const streams = await rezkaGetStreams(host, id, translatorId, isMovie ? '' : season, isMovie ? '' : episode)
  const chosen = pickQuality(streams, decodeURIComponent(quality || 'best'))
  if (!chosen) throw new Error('No playable stream found for this episode.')
  return { url: chosen.url, referer: `https://${host}/`, extractor: 'HDrezka' }
}

// ---- yummyani.me (anime, played through Kodik) ----

const YUMMY_DOMAIN = /^https?:\/\/(?:[a-z0-9-]+\.)*yummyani\.me\/catalog\/item\//i

function b64urlEncode(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlDecode(s: string): string {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
}

function caesar(s: string, n: number): string {
  return s.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97
    return String.fromCharCode(((c.charCodeAt(0) - base + n) % 26) + base)
  })
}

/**
 * Kodik encodes its stream URLs as a Caesar cipher + base64. The shift changes
 * periodically (it has been 13, 16, 18, …), so we brute-force it and accept the
 * shift that decodes to a valid URL.
 */
function kodikDecode(src: string): string {
  for (let n = 1; n < 26; n++) {
    try {
      let out = Buffer.from(caesar(src, n), 'base64').toString('utf-8')
      if (out.startsWith('//') || /^https?:\/\//.test(out)) {
        if (out.startsWith('//')) out = 'https:' + out
        return out
      }
    } catch {
      /* try next shift */
    }
  }
  let out = Buffer.from(src, 'base64').toString('utf-8')
  if (out.startsWith('//')) out = 'https:' + out
  return out
}

interface KodikLinks {
  [quality: string]: { src: string; type?: string }[]
}

async function kodikGetM3u8(playerUrl: string, episode: number, requested: string): Promise<string> {
  const url = playerUrl.startsWith('//') ? 'https:' + playerUrl : playerUrl
  const html = await fetchText(url, { Referer: 'https://old.yummyani.me/' })
  const upRaw = pick(/urlParams = '([^']+)'/, html)
  if (!upRaw) throw new Error('Kodik player params not found')
  const up = JSON.parse(upRaw) as Record<string, string>

  // Episode <option> elements carry data-id (episodeID) and data-hash (episodeHash).
  let id = ''
  let hash = ''
  for (const opt of html.match(/<option[^>]*>/g) || []) {
    const oid = pick(/data-id="(\d+)"/, opt)
    const oh = pick(/data-hash="([a-f0-9]+)"/, opt)
    const v = pick(/value="(\d+)"/, opt)
    if (oid && oh && Number(v) === episode) {
      id = oid
      hash = oh
      break
    }
  }
  if (!id) {
    const seq = [...html.matchAll(/data-id="(\d+)"\s+data-hash="([a-f0-9]+)"/g)]
    const fallback = seq[episode - 1]
    if (fallback) {
      id = fallback[1]
      hash = fallback[2]
    }
  }
  if (!id || !hash) throw new Error('Episode not found in the Kodik player')

  const body = new URLSearchParams({
    d: up.d,
    d_sign: up.d_sign,
    pd: up.pd,
    pd_sign: up.pd_sign,
    ref: decodeURIComponent(up.ref || ''),
    ref_sign: up.ref_sign,
    bad_user: 'false',
    cdn_is_working: 'true',
    type: 'seria',
    hash,
    id
  })
  const raw = await netPost('https://kodikplayer.com/ftor', body.toString(), {
    Referer: 'https://kodikplayer.com/'
  })
  const json = JSON.parse(raw) as { links?: KodikLinks }
  const links = json.links || {}
  const tiers = Object.keys(links)
    .map((q) => ({ q, h: parseInt(q, 10) || 0 }))
    .sort((a, b) => a.h - b.h)
  if (!tiers.length) throw new Error('No streams returned by Kodik')
  const want = requested === 'best' || requested === 'audio' ? Infinity : parseInt(requested, 10) || Infinity
  const chosen = tiers.filter((t) => t.h <= want).pop()?.q || tiers[tiers.length - 1].q
  return kodikDecode(links[chosen][0].src)
}

interface YaniVideo {
  number: string
  data: { player: string; dubbing: string }
  iframe_url: string
}

type YaniPoster = string | Record<string, string> | undefined

/** yani.tv posters come as an object of sizes with protocol-relative URLs. */
function normalizeYaniPoster(poster: YaniPoster): string | undefined {
  let u: string | undefined
  if (typeof poster === 'string') u = poster
  else if (poster && typeof poster === 'object') {
    u = poster.fullsize || poster.big || poster.medium || poster.small || poster.huge || poster.mega
  }
  if (!u) return undefined
  if (u.startsWith('//')) u = 'https:' + u
  else if (u.startsWith('/')) u = 'https://static.yani.tv' + u
  return u
}

/**
 * Build the full streaming picker (dubbings → episodes → qualities) for an
 * anime from its numeric yani.tv id. Shared by the page resolver and the
 * search-result resolver (uvd-yummy-item://<id>).
 */
async function yummyStreamingFromId(animeId: string, webUrl: string): Promise<ResolvedUrl> {
  const meta = (
    JSON.parse(await fetchText(`https://api.yani.tv/anime/${animeId}`, { Referer: 'https://old.yummyani.me/' })) as {
      response: { title?: string; poster?: YaniPoster }
    }
  ).response
  const thumbnail = normalizeYaniPoster(meta.poster)
  const videos = (
    JSON.parse(
      await fetchText(`https://api.yani.tv/anime/${animeId}/videos`, { Referer: 'https://old.yummyani.me/' })
    ) as { response: YaniVideo[] }
  ).response

  // Group Kodik entries by dubbing — each dubbing maps to one season player URL.
  const byDub = new Map<string, { base: string; episodes: Set<number> }>()
  for (const v of videos) {
    if (v.data.player !== 'Плеер Kodik') continue
    const base = v.iframe_url.split('?')[0]
    const dub = v.data.dubbing || 'Kodik'
    if (!byDub.has(dub)) byDub.set(dub, { base, episodes: new Set() })
    byDub.get(dub)!.episodes.add(Number(v.number))
  }
  if (!byDub.size) throw new Error('No playable Kodik streams found for this title.')

  const translators: StreamTranslator[] = []
  const episodesByTranslator: Record<string, StreamSeason[]> = {}
  for (const [dub, info] of byDub) {
    const tid = b64urlEncode(info.base)
    translators.push({ id: tid, name: dub })
    episodesByTranslator[tid] = [{ season: 1, episodes: [...info.episodes].sort((a, b) => a - b) }]
  }
  const defaultTranslator = translators[0].id

  const streaming: StreamingInfo = {
    provider: 'yummyani',
    host: 'old.yummyani.me',
    id: animeId,
    title: meta.title || 'Anime',
    thumbnail,
    isSeries: episodesByTranslator[defaultTranslator][0].episodes.length > 1,
    translators,
    defaultTranslator,
    seasons: episodesByTranslator[defaultTranslator],
    episodesByTranslator,
    qualities: ['360p', '480p', '720p']
  }
  return { url: webUrl, streaming, extractor: 'YummyAnime', title: streaming.title, thumbnail: streaming.thumbnail }
}

async function resolveYummyaniPage(url: string): Promise<ResolvedUrl> {
  const page = await fetchText(url, { Referer: 'https://old.yummyani.me/' })
  const animeId = pick(/yani\.tv\/a(\d+)/, page) || pick(/data-id="(\d+)"/, page)
  if (!animeId) return { url }
  return yummyStreamingFromId(animeId, url)
}

// Internal scheme built from a search result: uvd-yummy-item://<animeId>
async function resolveYummyaniItem(uvdUrl: string): Promise<ResolvedUrl> {
  const animeId = uvdUrl.replace(/^uvd-yummy-item:\/\//, '').split('/')[0]
  return yummyStreamingFromId(animeId, uvdUrl)
}

interface YaniSearchItem {
  anime_id: number
  anime_url: string
  title: string
  poster?: YaniPoster
  year?: number
  views?: number
}

/** Search anime by title via the yani.tv API (powers the 'yummyani' service). */
export async function searchYummyani(query: string, limit: number): Promise<SearchResult[]> {
  const raw = await fetchText(`https://api.yani.tv/search?q=${encodeURIComponent(query)}`, {
    Referer: 'https://old.yummyani.me/'
  })
  const list = (JSON.parse(raw) as { response?: YaniSearchItem[] }).response || []
  return list.slice(0, limit).map((it) => ({
    id: `yani-${it.anime_id}`,
    title: it.title,
    url: `https://yummyani.me/catalog/item/${it.anime_url}`,
    pickerUrl: `uvd-yummy-item://${it.anime_id}`,
    thumbnail: normalizeYaniPoster(it.poster),
    uploader: it.year ? String(it.year) : undefined,
    viewCount: it.views,
    service: 'yummyani' as const
  }))
}

// uvd-yummy://<translatorId(=base64url kodik season url)>/<episode>/<quality>
async function resolveYummyaniStream(uvdUrl: string): Promise<ResolvedUrl> {
  const [tid, episode, quality] = uvdUrl.replace(/^uvd-yummy:\/\//, '').split('/')
  const base = b64urlDecode(tid)
  const m3u8 = await kodikGetM3u8(base, Number(episode), decodeURIComponent(quality || 'best'))
  return { url: m3u8, referer: 'https://kodikplayer.com/', extractor: 'YummyAnime' }
}

interface Resolver {
  match: RegExp
  resolve: (url: string) => Promise<ResolvedUrl>
}

const resolvers: Resolver[] = [
  { match: /^https?:\/\/(?:[a-z0-9-]+\.)*cumgloryhole\.se\/videos\//i, resolve: resolveCghVideo },
  { match: /^https?:\/\/(?:[a-z0-9-]+\.)*cumgloryhole\.se\/models\//i, resolve: resolveCghModel },
  { match: REZKA_DOMAIN, resolve: resolveRezkaPage },
  { match: YUMMY_DOMAIN, resolve: resolveYummyaniPage }
]

/**
 * Resolve an input URL to something the engine can download. For supported
 * custom sites this scrapes the page for the real stream URL (and required
 * referer) or a playlist of entries. For everything else it passes through.
 */
export async function resolveUrl(input: string): Promise<ResolvedUrl> {
  const trimmed = input.trim()
  if (trimmed.startsWith('uvd-rezka://')) {
    return resolveRezkaStream(trimmed)
  }
  if (trimmed.startsWith('uvd-yummy-item://')) {
    return resolveYummyaniItem(trimmed)
  }
  if (trimmed.startsWith('uvd-yummy://')) {
    return resolveYummyaniStream(trimmed)
  }
  for (const r of resolvers) {
    if (r.match.test(trimmed)) {
      try {
        return await r.resolve(trimmed)
      } catch {
        // Fall back to passthrough so the engine can still try the page.
        return { url: trimmed }
      }
    }
  }
  return { url: trimmed }
}

/** Whether a URL is handled by a custom resolver (used to skip the engine probe). */
export function hasResolver(input: string): boolean {
  return resolvers.some((r) => r.match.test(input.trim()))
}
