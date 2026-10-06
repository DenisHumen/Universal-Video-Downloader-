import { b64urlDecode, b64urlEncode, fetchText, pick } from '../http'
import type { ResolvedUrl, SiteResolver } from '../types'
import { NotReleasedError, releaseAtFrom } from '../upcoming'
import { AKSOR_REFERER, aksorEpisode, aksorHash, pickAksorTier } from './aksor'
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
  /** Seconds; only Aksor's are read. */
  duration?: number
}

/** The part of a video record the dub groupers read. */
type YaniEntry = Pick<YaniVideo, 'iframe_url' | 'data' | 'duration'> & { number: string | number }

const KODIK = 'Плеер Kodik'
const AKSOR = 'Плеер Aksor'

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
export function groupKodikDubs(videos: YaniEntry[]): KodikDub[] {
  const byBase = new Map<string, { labels: Map<string, number>; episodes: Set<number> }>()
  for (const v of videos) {
    if (v.data.player !== KODIK) continue
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

export interface AksorDub {
  /** The site's label for the dub, which is what finds its episodes again. */
  dubbing: string
  name: string
  episodes: number[]
  /** The player hash of one of its episodes, asked which heights the dub comes in. */
  sample: string
}

/** The empty label is a dub too; it is keyed and found under the same ''. */
const dubbingOf = (v: YaniEntry): string => v.data.dubbing || ''

/**
 * One entry per dub on Aksor, YummyAnime's own player.
 *
 * Unlike Kodik, Aksor has no player per season: every episode is a page of its
 * own, so a dub is the site's label for it. The name says which player it is
 * on, because the same studio is usually on Kodik as well - "Озвучка
 * AniLibria" twice in the list, one of them 720p and the other 1080p, with
 * nothing to choose between them by.
 */
export function groupAksorDubs(videos: YaniEntry[]): AksorDub[] {
  const byDub = new Map<string, { episodes: Set<number>; sample: string }>()
  for (const v of videos) {
    if (v.data.player !== AKSOR) continue
    const episode = Number(v.number)
    const hash = aksorHash(v.iframe_url)
    if (!Number.isFinite(episode) || !hash) continue
    const dubbing = dubbingOf(v)
    const entry = byDub.get(dubbing) ?? { episodes: new Set(), sample: hash }
    entry.episodes.add(episode)
    byDub.set(dubbing, entry)
  }
  return [...byDub].map(([dubbing, entry]) => ({
    dubbing,
    name: dubbing ? `${dubbing} · Aksor` : 'Aksor',
    episodes: [...entry.episodes].sort((x, y) => x - y),
    sample: entry.sample
  }))
}

/*
  An Aksor dub has no address of its own to stand for it, so its translator id
  is what finds its episodes again: the title and the dub's label. Decoded, a
  Kodik id is a `//` player address and an Aksor one starts `aksor:`, which is
  how the stream resolver tells them apart. Watches keep these ids, so this
  shape stays as it is.
*/
const AKSOR_ID = /^aksor:(\d+):([\s\S]*)$/

export function aksorTranslatorId(animeId: string, dubbing: string): string {
  return b64urlEncode(`aksor:${animeId}:${dubbing}`)
}

/** The title and dub an Aksor translator id names, or undefined for a Kodik one. */
export function parseAksorTranslator(
  decoded: string
): { animeId: string; dubbing: string } | undefined {
  const m = AKSOR_ID.exec(decoded)
  return m ? { animeId: m[1], dubbing: m[2] } : undefined
}

/**
 * The player page of one episode of an Aksor dub. A dub listed twice for the
 * same episode plays the first; the list is the site's, in the site's order.
 */
export function findAksorEpisode(
  videos: YaniEntry[],
  dubbing: string,
  episode: number
): { hash: string; duration?: number } | undefined {
  for (const v of videos) {
    if (v.data.player !== AKSOR || dubbingOf(v) !== dubbing || Number(v.number) !== episode) continue
    const hash = aksorHash(v.iframe_url)
    if (hash) return { hash, duration: v.duration && v.duration > 0 ? v.duration : undefined }
  }
  return undefined
}

const KODIK_HEIGHTS = [360, 480, 720]

/**
 * The heights the picker offers for a title.
 *
 * Kodik's are the 360p-720p ladder the picker has always shown, its player
 * taking the nearest one at or below. Aksor's are only the ones its dubs were
 * found in: a 1080p button on a title with no 1080p stream anywhere would be a
 * promise nothing keeps. A title on Aksor alone whose player did not answer
 * still gets a ladder - every height falls back to the nearest the episode has.
 */
export function yummyQualities(hasKodik: boolean, aksorHeights: number[]): string[] {
  const heights = new Set([...(hasKodik ? KODIK_HEIGHTS : []), ...aksorHeights])
  if (!heights.size) KODIK_HEIGHTS.forEach((h) => heights.add(h))
  return [...heights].sort((a, b) => a - b).map((h) => `${h}p`)
}

/**
 * Every height some Aksor dub of the title comes in.
 *
 * The video list does not say; only the player does, one episode at a time.
 * Across the titles checked every episode of a dub came in the same heights,
 * so one episode per dub is asked, all at once. An answer that fails or is
 * slow costs only its heights a place in the list: the dub is still offered.
 */
async function aksorHeights(dubs: AksorDub[]): Promise<number[]> {
  const answers = await Promise.allSettled(dubs.map((d) => aksorEpisode(d.sample, 8_000)))
  return answers.flatMap((a) => (a.status === 'fulfilled' ? a.value.map((t) => t.height) : []))
}

export interface ShortLivedCache<T> {
  get(key: string, load: () => Promise<T>, fresh?: boolean): Promise<T>
  set(key: string, value: T): void
}

/**
 * What `load` answered for a key, kept for `ttl` ms and shared with every
 * caller that asks meanwhile. A load that fails is forgotten at once, so the
 * next caller tries again; past `max` keys the oldest goes.
 */
export function shortLivedCache<T>(
  ttl: number,
  max: number,
  now: () => number = Date.now
): ShortLivedCache<T> {
  const entries = new Map<string, { at: number; value: Promise<T> }>()
  const put = (key: string, value: Promise<T>): Promise<T> => {
    entries.delete(key)
    entries.set(key, { at: now(), value })
    value.catch(() => {
      if (entries.get(key)?.value === value) entries.delete(key)
    })
    while (entries.size > max) entries.delete(entries.keys().next().value as string)
    return value
  }
  return {
    get(key, load, fresh = false) {
      const hit = entries.get(key)
      if (!fresh && hit && now() - hit.at < ttl) return hit.value
      return put(key, load())
    },
    set(key, value) {
      put(key, Promise.resolve(value))
    }
  }
}

async function fetchVideos(animeId: string): Promise<YaniVideo[]> {
  const raw = await fetchText(`https://api.yani.tv/anime/${animeId}/videos`, { Referer: REFERER })
  return (JSON.parse(raw) as { response: YaniVideo[] }).response
}

const aksorOnly = (videos: YaniVideo[]): YaniVideo[] => videos.filter((v) => v.data.player === AKSOR)

/*
  A title's Aksor records, kept for a few minutes after they were read.

  An Aksor episode is found by looking it up in the title's video list, which
  is all of /anime/<id>/videos - about a megabyte for a long title, nearly all
  of it other players. Queuing a season resolves every episode in turn, and
  each would fetch that megabyte again, moments after the picker that queued
  them read it. A lookup that misses in a remembered list asks afresh before
  giving up, so an episode that has appeared since is still found.
*/
const aksorLists = shortLivedCache<YaniVideo[]>(5 * 60_000, 8)

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
  const videos = await fetchVideos(animeId)
  aksorLists.set(animeId, aksorOnly(videos))

  const dubs = groupKodikDubs(videos)
  const aksor = groupAksorDubs(videos)
  if (!dubs.length && !aksor.length) {
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
    throw new Error('No downloadable streams found for this title.')
  }

  const translators: StreamTranslator[] = []
  const episodesByTranslator: Record<string, StreamSeason[]> = {}
  for (const dub of dubs) {
    const tid = b64urlEncode(dub.base)
    translators.push({ id: tid, name: dub.name })
    episodesByTranslator[tid] = [{ season: 1, episodes: dub.episodes }]
  }
  // After Kodik's, so a tie in fullestDub opens the title on Kodik as it always has.
  for (const dub of aksor) {
    const tid = aksorTranslatorId(animeId, dub.dubbing)
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
    qualities: yummyQualities(dubs.length > 0, aksor.length ? await aksorHeights(aksor) : [])
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

/** One episode of an Aksor dub, at the height requested or the nearest below it. */
async function resolveAksorStream(
  dub: { animeId: string; dubbing: string },
  episode: number,
  requested: string,
  uvdUrl: string
): Promise<ResolvedUrl> {
  const load = async (): Promise<YaniVideo[]> => aksorOnly(await fetchVideos(dub.animeId))
  const found =
    findAksorEpisode(await aksorLists.get(dub.animeId, load), dub.dubbing, episode) ??
    findAksorEpisode(await aksorLists.get(dub.animeId, load, true), dub.dubbing, episode)
  if (!found) throw new Error('Episode not found in the Aksor player')
  const tier = pickAksorTier(await aksorEpisode(found.hash), requested)
  if (!tier) throw new Error('No streams returned by Aksor')
  return {
    url: tier.url,
    /*
      The manifest needs no referer. The downloader, though, names the file
      after the episode only for a stream that came with one; without it the
      engine's own title for the manifest is used, and that is "1080".
    */
    referer: AKSOR_REFERER,
    extractor: 'YummyAnime',
    duration: found.duration,
    downloadUrl: uvdUrl
  }
}

/**
 * uvd-yummy://<translatorId>/<episode>/<quality>, the translator id being a
 * Kodik season player or an Aksor dub (see aksorTranslatorId), base64url.
 */
export async function resolveYummyaniStream(uvdUrl: string): Promise<ResolvedUrl> {
  const [tid, episode, quality] = uvdUrl.replace(/^uvd-yummy:\/\//, '').split('/')
  const decoded = b64urlDecode(tid)
  const requested = decodeURIComponent(quality || 'best')
  const aksor = parseAksorTranslator(decoded)
  if (aksor) return resolveAksorStream(aksor, Number(episode), requested, uvdUrl)
  const m3u8 = await kodikGetM3u8(decoded, Number(episode), requested, REFERER)
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
