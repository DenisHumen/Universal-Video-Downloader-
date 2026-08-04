import { b64urlDecode, b64urlEncode, fetchText, netPost, pick } from '../http'
import type { ResolvedUrl, SiteResolver } from '../types'
import type { SearchResult, StreamingInfo, StreamSeason, StreamTranslator } from '@shared/types'

export const YUMMY_DOMAIN = /^https?:\/\/(?:[a-z0-9-]+\.)*yummyani\.me\/catalog\/item\//i

const REFERER = 'https://old.yummyani.me/'

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
  const html = await fetchText(url, { Referer: REFERER })
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
async function streamingFromId(animeId: string, webUrl: string): Promise<ResolvedUrl> {
  const meta = (
    JSON.parse(await fetchText(`https://api.yani.tv/anime/${animeId}`, { Referer: REFERER })) as {
      response: { title?: string; poster?: YaniPoster }
    }
  ).response
  const thumbnail = normalizeYaniPoster(meta.poster)
  const videos = (
    JSON.parse(await fetchText(`https://api.yani.tv/anime/${animeId}/videos`, { Referer: REFERER })) as {
      response: YaniVideo[]
    }
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
  return {
    url: webUrl,
    streaming,
    extractor: 'YummyAnime',
    title: streaming.title,
    thumbnail: streaming.thumbnail
  }
}

async function resolvePage(url: string): Promise<ResolvedUrl> {
  const page = await fetchText(url, { Referer: REFERER })
  const animeId = pick(/yani\.tv\/a(\d+)/, page) || pick(/data-id="(\d+)"/, page)
  if (!animeId) return { url }
  return streamingFromId(animeId, url)
}

/** Internal scheme built from a search result: uvd-yummy-item://<animeId> */
export async function resolveYummyaniItem(uvdUrl: string): Promise<ResolvedUrl> {
  const animeId = uvdUrl.replace(/^uvd-yummy-item:\/\//, '').split('/')[0]
  return streamingFromId(animeId, uvdUrl)
}

/** uvd-yummy://<translatorId(=base64url kodik season url)>/<episode>/<quality> */
export async function resolveYummyaniStream(uvdUrl: string): Promise<ResolvedUrl> {
  const [tid, episode, quality] = uvdUrl.replace(/^uvd-yummy:\/\//, '').split('/')
  const base = b64urlDecode(tid)
  const m3u8 = await kodikGetM3u8(base, Number(episode), decodeURIComponent(quality || 'best'))
  return {
    url: m3u8,
    referer: 'https://kodikplayer.com/',
    extractor: 'YummyAnime',
    downloadUrl: uvdUrl
  }
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
    Referer: REFERER
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

export const yummyaniResolvers: SiteResolver[] = [
  { id: 'YummyAnime', match: YUMMY_DOMAIN, resolve: resolvePage }
]
