import { b64urlDecode, b64urlEncode, fetchText, pick } from '../http'
import type { ResolvedUrl, SiteResolver } from '../types'
import { NotReleasedError, releaseAtFrom } from '../upcoming'
import { kodikGetM3u8 } from './kodik'
import type { SearchResult, StreamingInfo, StreamSeason, StreamTranslator } from '@shared/types'

/*
  yummy-anime.ru and yani.tv are the site's old addresses. normalizeUrl moves a
  title page on either onto yummyani.me before any resolver sees it; they are
  matched here as well for a caller that skipped it, which is safe because the
  page fetch follows the site's own redirect.
*/
export const YUMMY_DOMAIN =
  /^https?:\/\/(?:[a-z0-9-]+\.)*(?:yummyani\.me|yummy-anime\.ru|yani\.tv)\/catalog\/item\//i

const REFERER = 'https://old.yummyani.me/'

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

export interface KodikDub {
  /** The season player this dub plays from - which is also what identifies it. */
  base: string
  name: string
  episodes: number[]
}

/**
 * One entry per player, not one per label.
 *
 * A dub is identified here by the address of its Kodik player, because that
 * address is all the downloader needs and it survives in saved watches. The
 * site sometimes files two labels against the same player - a fifteen-episode
 * translation and a stray one-episode record under another studio name. Keyed
 * by label, both claimed the same id and the later one overwrote the earlier
 * episode list, so a complete dub was shown, and followed, as having one
 * episode. The same player is the same stream: the episodes are pooled, and the
 * label with the most records behind it names the result.
 */
export function groupKodikDubs(
  videos: { number: string | number; iframe_url: string; data: { player: string; dubbing: string } }[]
): KodikDub[] {
  const byBase = new Map<string, { labels: Map<string, number>; episodes: Set<number> }>()
  for (const v of videos) {
    if (v.data.player !== 'Плеер Kodik') continue
    const episode = Number(v.number)
    if (!Number.isFinite(episode)) continue
    const base = v.iframe_url.split('?')[0]
    const entry = byBase.get(base) ?? { labels: new Map(), episodes: new Set() }
    const label = v.data.dubbing || 'Kodik'
    entry.labels.set(label, (entry.labels.get(label) ?? 0) + 1)
    entry.episodes.add(episode)
    byBase.set(base, entry)
  }
  return [...byBase].map(([base, entry]) => ({
    base,
    // Map keeps insertion order, so a tie goes to the label the site listed first.
    name: [...entry.labels].reduce((best, next) => (next[1] > best[1] ? next : best))[0],
    episodes: [...entry.episodes].sort((x, y) => x - y)
  }))
}

function episodeCount(seasons: StreamSeason[] | undefined): number {
  return (seasons ?? []).reduce((n, s) => n + s.episodes.length, 0)
}

/**
 * The dub to open a title on: the one carrying the most episodes.
 *
 * The API lists dubs in no useful order, and the first one is sometimes a
 * single uploaded episode sitting in front of eight complete translations.
 * Opening on it made a fifteen-episode series look like a film - the home card
 * drew the film picker, and following it was refused as "a single video" -
 * because whether a title is a series was read off that one dub. A tie keeps
 * the order the site gave, so the choice does not move between visits.
 */
export function fullestDub(
  translators: { id: string }[],
  episodesByTranslator: Record<string, StreamSeason[]>
): string {
  let best = translators[0].id
  for (const t of translators) {
    if (episodeCount(episodesByTranslator[t.id]) > episodeCount(episodesByTranslator[best])) {
      best = t.id
    }
  }
  return best
}

/**
 * Build the full streaming picker (dubbings → episodes → qualities) for an
 * anime from its numeric yani.tv id. Shared by the page resolver and the
 * search-result resolver (uvd-yummy-item://<id>), and by Shikimori links,
 * which are matched to a yani.tv id first.
 */
export async function streamingFromId(animeId: string, webUrl: string): Promise<ResolvedUrl> {
  const meta = (
    JSON.parse(await fetchText(`https://api.yani.tv/anime/${animeId}`, { Referer: REFERER })) as {
      response: {
        title?: string
        poster?: YaniPoster
        anime_status?: { alias?: string }
        episodes?: { aired?: number; next_date?: number }
      }
    }
  ).response
  const thumbnail = normalizeYaniPoster(meta.poster)
  const videos = (
    JSON.parse(await fetchText(`https://api.yani.tv/anime/${animeId}/videos`, { Referer: REFERER })) as {
      response: YaniVideo[]
    }
  ).response

  const dubs = groupKodikDubs(videos)
  if (!dubs.length) {
    /*
      Nothing to play is two different situations. A title the site has only
      announced will have streams later, and says roughly when; anything else
      with no streams is simply not downloadable. Only the first is worth
      waiting for, so only the first is reported as "not yet".
    */
    const announced =
      meta.anime_status?.alias === 'announcement' || (meta.episodes?.aired ?? 1) === 0
    if (announced) {
      throw new NotReleasedError({
        title: meta.title || 'Anime',
        thumbnail,
        releaseAt: releaseAtFrom(meta.episodes?.next_date)
      })
    }
    throw new Error('No playable Kodik streams found for this title.')
  }

  const translators: StreamTranslator[] = []
  const episodesByTranslator: Record<string, StreamSeason[]> = {}
  for (const dub of dubs) {
    const tid = b64urlEncode(dub.base)
    translators.push({ id: tid, name: dub.name })
    episodesByTranslator[tid] = [{ season: 1, episodes: dub.episodes }]
  }
  const defaultTranslator = fullestDub(translators, episodesByTranslator)

  const streaming: StreamingInfo = {
    provider: 'yummyani',
    host: 'old.yummyani.me',
    id: animeId,
    title: meta.title || 'Anime',
    thumbnail,
    isSeries: episodeCount(episodesByTranslator[defaultTranslator]) > 1,
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

/**
 * Every number on the page that might be this title's id, likeliest first.
 *
 * The page carries two, and they are not always the same number. The
 * `short_link` meta tag is the site's own short numbering, and the id block on
 * the rating widget is what api.yani.tv answers to. Across a sample of a dozen
 * titles the two agreed on eleven and disagreed on one - an older season, where
 * the short link pointed at a number the API has never heard of. Reading the
 * short link first therefore worked for most of the catalogue and failed
 * silently on the back half of it, with nothing to show for it but "HTTP 404".
 *
 * Ordered rather than chosen, because a page that changes shape should degrade
 * into trying the next number rather than into not working.
 */
export function animeIdCandidates(page: string): string[] {
  const out: string[] = []
  const add = (value?: string): void => {
    if (value && !out.includes(value)) out.push(value)
  }
  add(pick(/class="rating-info"[^>]*data-id="(\d+)"/, page))
  add(pick(/data-id="(\d+)"[^>]*class="rating-info"/, page))
  add(pick(/data-id="(\d+)"/, page))
  add(pick(/yani\.tv\/a(\d+)/, page))
  return out
}

/** A 404 means the number was not an anime id, not that the title is gone. */
function looksLikeAWrongId(err: unknown): boolean {
  return /\b404\b/.test(err instanceof Error ? err.message : String(err))
}

async function resolvePage(url: string): Promise<ResolvedUrl> {
  const page = await fetchText(url, { Referer: REFERER })
  const candidates = animeIdCandidates(page)
  if (!candidates.length) return { url }

  let last: unknown
  for (const animeId of candidates) {
    try {
      return await streamingFromId(animeId, url)
    } catch (err) {
      last = err
      // Anything else is a real answer about the right title - a season with no
      // streams yet, a network failure - and asking a different number about it
      // would only turn a clear message into a confusing one.
      if (!looksLikeAWrongId(err)) throw err
    }
  }
  throw last
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
  const m3u8 = await kodikGetM3u8(base, Number(episode), decodeURIComponent(quality || 'best'), REFERER)
  return {
    url: m3u8,
    referer: 'https://kodikplayer.com/',
    extractor: 'YummyAnime',
    downloadUrl: uvdUrl
  }
}

export interface YaniSearchItem {
  anime_id: number
  anime_url: string
  title: string
  poster?: YaniPoster
  year?: number
  views?: number
  /** The title's ids on other catalogues; what a Shikimori link is matched by. */
  remote_ids?: { shikimori_id?: number | string }
}

/** The yani.tv search answer as it comes, ids on other catalogues included. */
export async function searchYani(query: string): Promise<YaniSearchItem[]> {
  const raw = await fetchText(`https://api.yani.tv/search?q=${encodeURIComponent(query)}`, {
    Referer: REFERER
  })
  return (JSON.parse(raw) as { response?: YaniSearchItem[] }).response || []
}

/** Search anime by title via the yani.tv API (powers the 'yummyani' service). */
export async function searchYummyani(query: string, limit: number): Promise<SearchResult[]> {
  const list = await searchYani(query)
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
