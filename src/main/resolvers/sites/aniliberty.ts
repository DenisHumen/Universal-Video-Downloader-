import { absoluteUrl, cleanHtml, fetchText, hostOf } from '../http'
import { NotReleasedError } from '../upcoming'
import type { ResolvedUrl, SiteResolver } from '../types'
import type { StreamingInfo } from '@shared/types'

/**
 * AniLiberty, which is what AniLibria became: one dub team's own site, on
 * aniliberty.top and its mirror anilibria.top, with the old anilibria.tv still
 * up and still linked from everywhere.
 *
 * A release page lists every episode in 480p, 720p and 1080p, and the engine
 * does not know the site at all. Left to the universal resolver, a release was
 * scraped for its manifests, which all score the same, and the first in the
 * markup won: the newest episode at 720p, under the release's title, with no
 * way to choose another. The site's open API answers the same question
 * properly - every episode, every height, no token - so a release becomes an
 * episode picker, and an episode's own watch page a picker for its heights.
 *
 * A release address on anilibria.app, the apps' own domain, is taken as well:
 * the alias in it is all that is read, and the API is asked elsewhere.
 */
export const ANILIBERTY_RELEASE =
  /^https?:\/\/(?:www\.)?(?:aniliberty\.top|anilibria\.top|anilibria\.app)\/anime\/releases\/release\/([^/?#]+)/i

/**
 * anilibria.tv's release address, `/release/<code>.html`. The old site still
 * serves it, and its code is the alias the new API answers to.
 */
export const ANILIBRIA_LEGACY_RELEASE = /^https?:\/\/(?:www\.)?anilibria\.tv\/release\/([^/?#]+?)\.html/i

/** The page the player opens for one episode: `/anime/video/episode/<uuid>`. */
export const ANILIBERTY_EPISODE =
  /^https?:\/\/(?:www\.)?(?:aniliberty\.top|anilibria\.top)\/anime\/video\/episode\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

/** The queue address of one episode: `uvd-anilib://<alias>/<ordinal>/<quality>`. */
export const ANILIB_SCHEME = 'uvd-anilib://'

/*
  Every host below answers /api/v1 from the same catalogue, and any one of them
  can be the one that is blocked or down where the user is - the reason the
  mirrors exist at all. anilibria.app is not among them: its release addresses,
  and its /api/v1, answer with the page about AniLibria's apps, so a link there
  is asked about at api.anilibria.app instead.
*/
const API_HOSTS = ['aniliberty.top', 'anilibria.top', 'api.anilibria.app']
const API_TIMEOUT = 15_000
/*
  The CDN serves the manifests to anyone. The referer is still sent: the
  downloader names the file after the episode only for a stream that came with
  one, and without it the engine's own title for the manifest would be used.
*/
const REFERER = 'https://aniliberty.top/'
const EXTRACTOR = 'AniLiberty'
const DUB_NAME = 'AniLibria'

/*
  Worded for the error classifier: "region" lands on its geo rule and "has been
  removed" on its unavailable one, so both reach the user in their language. A
  copyright block is usually a regional one too, which the unavailable message
  allows for.
*/
const GEO_BLOCKED = 'AniLiberty does not stream this release in your region.'
const COPYRIGHT_BLOCKED = "This release has been removed from AniLiberty's player at the rights holder's request."
const NO_EPISODES = 'This AniLiberty release has no episodes, so there is nothing to download.'
const EPISODE_MISSING = 'Episode not found on this AniLiberty release.'
const NO_STREAMS = 'AniLiberty has no stream for this episode.'
const NO_ALIAS = "AniLiberty's answer did not say which release it was."

const HEIGHTS = [1080, 720, 480] as const

export interface AniEpisode {
  id?: string | null
  name?: string | null
  ordinal?: number | string | null
  duration?: number | null
  hls_480?: string | null
  hls_720?: string | null
  hls_1080?: string | null
  sort_order?: number | null
}

/** A release as `/api/v1/anime/releases/<alias>` gives it, trimmed to what is read. */
export interface AniRelease {
  alias?: string | null
  name?: { main?: string | null; english?: string | null } | null
  poster?: { src?: string | null; optimized?: { src?: string | null } | null } | null
  is_ongoing?: boolean | null
  is_in_production?: boolean | null
  episodes_total?: number | null
  is_blocked_by_geo?: boolean | null
  is_blocked_by_copyrights?: boolean | null
  episodes?: AniEpisode[] | null
}

/** One episode as `/api/v1/anime/releases/episodes/<uuid>` gives it, its release attached. */
export interface AniEpisodeAnswer extends AniEpisode {
  release?: AniRelease | null
}

export interface AniTier {
  height: number
  url: string
}

/** The alias a release or legacy address names, or undefined for anything else. */
export function anilibertyAlias(url: string): string | undefined {
  const m = ANILIBERTY_RELEASE.exec(url) ?? ANILIBRIA_LEGACY_RELEASE.exec(url)
  if (!m) return undefined
  try {
    return decodeURIComponent(m[1]).trim() || undefined
  } catch {
    return undefined
  }
}

/** The hosts to ask, the page's own first when it has an API of its own. */
export function apiHosts(pageHost?: string): string[] {
  const own = (pageHost ?? '').toLowerCase().replace(/^www\./, '')
  return API_HOSTS.includes(own) ? [own, ...API_HOSTS.filter((h) => h !== own)] : [...API_HOSTS]
}

/**
 * Ask each API host in turn and take the first real answer.
 *
 * When every host fails, the first one's failure is the one reported: it is the
 * user's own host, and its "HTTP 404" or timeout is what lets `resolveUrl` hand
 * the page to the universal resolver rather than end on an error.
 */
async function fetchApi<T>(path: string, pageHost?: string): Promise<{ data: T; origin: string }> {
  let first: unknown
  for (const host of apiHosts(pageHost)) {
    const origin = `https://${host}`
    try {
      const raw = await fetchText(
        `${origin}/api/v1/${path}`,
        { Accept: 'application/json', Referer: REFERER },
        { timeout: API_TIMEOUT }
      )
      let data: T
      try {
        data = JSON.parse(raw) as T
      } catch {
        throw new Error(`${host} answered with a page instead of release data`)
      }
      if (!data || typeof data !== 'object') throw new Error(`${host} answered with no release data`)
      return { data, origin }
    } catch (err) {
      first ??= err
    }
  }
  throw first instanceof Error ? first : new Error(String(first))
}

/** An episode's number, or undefined when it has none worth showing. */
export function episodeOrdinal(ep: AniEpisode): number | undefined {
  if (ep.ordinal === null || ep.ordinal === undefined || ep.ordinal === '') return undefined
  const n = Number(ep.ordinal)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/** The streams an episode comes in, highest first: only the heights it has a manifest for. */
export function episodeTiers(ep: AniEpisode): AniTier[] {
  const out: AniTier[] = []
  for (const height of HEIGHTS) {
    const raw = ep[`hls_${height}` as const]
    if (typeof raw !== 'string') continue
    const url = raw.trim().startsWith('//') ? `https:${raw.trim()}` : raw.trim()
    if (/^https?:\/\//i.test(url)) out.push({ height, url })
  }
  return out
}

/**
 * The stream at the height asked for, or the nearest below it - and when every
 * one is above it, the lowest, which is the closest to what was asked for. The
 * same rule as Kodik's and Aksor's.
 */
export function pickAnilibTier(tiers: AniTier[], requested: string): AniTier | undefined {
  if (!tiers.length) return undefined
  const sorted = [...tiers].sort((a, b) => b.height - a.height)
  const want =
    requested === 'best' || requested === 'audio' ? Infinity : parseInt(requested, 10) || Infinity
  return sorted.find((t) => t.height <= want) ?? sorted[sorted.length - 1]
}

/**
 * The episodes that can be downloaded, in order, each number once.
 *
 * One with no manifest at all - only a YouTube or Rutube id, or nothing yet -
 * is left out rather than offered: the queue would fail it on every attempt.
 * When two share a number, the one the site sorts first is kept.
 */
export function playableEpisodes(release: AniRelease): { ordinal: number; episode: AniEpisode }[] {
  const list = [...(release.episodes ?? [])].sort(
    (a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity)
  )
  const seen = new Map<number, AniEpisode>()
  for (const episode of list) {
    const ordinal = episodeOrdinal(episode)
    if (ordinal === undefined || seen.has(ordinal) || !episodeTiers(episode).length) continue
    seen.set(ordinal, episode)
  }
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([ordinal, episode]) => ({ ordinal, episode }))
}

/** The release's name: the Russian one the site leads with, then the English, then the alias. */
export function releaseTitle(release: AniRelease): string {
  for (const raw of [release.name?.main, release.name?.english, release.alias]) {
    const name = cleanHtml(String(raw ?? ''))
    if (name) return name
  }
  return EXTRACTOR
}

function posterOf(release: AniRelease, origin: string): string | undefined {
  const src = release.poster?.src || release.poster?.optimized?.src
  return src ? absoluteUrl(src, `${origin}/`) : undefined
}

/** `E03`, or `E12.5` for the recap between two episodes. */
export function episodeLabel(ordinal: number): string {
  return `E${Number.isInteger(ordinal) ? String(ordinal).padStart(2, '0') : ordinal}`
}

/**
 * Heights as a picker's qualities, lowest first, the order every other
 * provider lists them in.
 *
 * The order is load-bearing: the watch dialog takes the last entry as the best
 * one when no height was carried over, so listed highest first, a followed
 * release would have downloaded every new episode in 480p while 1080p was
 * there.
 */
function qualityLabels(heights: Iterable<number>): string[] {
  return [...new Set(heights)].sort((a, b) => a - b).map((h) => `${h}p`)
}

/** Every height any episode comes in, lowest first, as the picker lists them. */
function releaseQualities(episodes: { episode: AniEpisode }[]): string[] {
  const heights: number[] = []
  for (const { episode } of episodes) for (const t of episodeTiers(episode)) heights.push(t.height)
  return qualityLabels(heights)
}

/**
 * Refuse a release the site will not play, in words.
 *
 * Checked before the episode list, which a blocked release may or may not
 * still carry: either way the manifests would be refused, and "no episodes"
 * would send the user looking for the wrong cause.
 */
export function assertPlayable(release: AniRelease): void {
  if (release.is_blocked_by_copyrights) throw new Error(COPYRIGHT_BLOCKED)
  if (release.is_blocked_by_geo) throw new Error(GEO_BLOCKED)
}

/**
 * The episode picker for a release.
 *
 * One dub, AniLibria's own, whose id is the release's alias: like a YummyAnime
 * or Kodik dub, the id names what to fetch, so the episode number is all an
 * episode's address adds to it, and a watch needs nothing else to build one.
 *
 * A series whenever it can grow: more than one episode, still airing, or more
 * planned. A running show with one episode out is exactly the thing worth
 * following, and counting the episodes alone would have called it a film.
 * The episode list is filled in for a film too - its one episode need not be
 * number one, and the picker's film button builds its address from this list.
 */
export function anilibertyInfo(release: AniRelease, origin: string, pageHost: string): StreamingInfo {
  assertPlayable(release)
  const alias = (release.alias ?? '').trim()
  const title = releaseTitle(release)
  const thumbnail = posterOf(release, origin)
  const episodes = playableEpisodes(release)
  if (!episodes.length) {
    /*
      Nothing out on a release the team is still working on is "not yet", and a
      watch can wait for it; carrying the provider is what lets that watch build
      AniLiberty addresses once something is out.
    */
    if (release.is_ongoing || release.is_in_production) {
      throw new NotReleasedError({
        title,
        thumbnail,
        provider: 'aniliberty',
        qualities: qualityLabels(HEIGHTS)
      })
    }
    throw new Error(NO_EPISODES)
  }
  if (!alias) throw new Error(NO_ALIAS)
  const ordinals = episodes.map((e) => e.ordinal)
  return {
    provider: 'aniliberty',
    host: pageHost.replace(/^www\./, '') || 'aniliberty.top',
    id: alias,
    title,
    thumbnail,
    isSeries:
      ordinals.length > 1 || Boolean(release.is_ongoing) || (Number(release.episodes_total) || 0) > 1,
    translators: [{ id: alias, name: DUB_NAME }],
    defaultTranslator: alias,
    seasons: [{ season: 1, episodes: ordinals }],
    qualities: releaseQualities(episodes)
  }
}

/** The queue address that re-resolves one episode to a fresh stream. */
export function anilibStreamUrl(alias: string, ordinal: number, quality: string): string {
  return `${ANILIB_SCHEME}${encodeURIComponent(alias)}/${ordinal}/${encodeURIComponent(quality)}`
}

/** What a `uvd-anilib://` address asks for, or undefined when it is not one. */
export function parseAnilibStreamUrl(
  url: string
): { alias: string; ordinal: number; quality: string } | undefined {
  if (!url.startsWith(ANILIB_SCHEME)) return undefined
  const [alias, ordinal, quality] = url.slice(ANILIB_SCHEME.length).split('/')
  const n = Number(ordinal)
  if (!alias || !ordinal || !Number.isFinite(n)) return undefined
  try {
    return {
      alias: decodeURIComponent(alias),
      ordinal: n,
      quality: decodeURIComponent(quality || 'best')
    }
  } catch {
    return undefined
  }
}

/** A release page, on the new site or the old one. */
async function resolveRelease(url: string): Promise<ResolvedUrl> {
  const alias = anilibertyAlias(url)
  if (!alias) return { url }
  const pageHost = hostOf(url).toLowerCase()
  const { data, origin } = await fetchApi<AniRelease>(
    `anime/releases/${encodeURIComponent(alias)}`,
    pageHost
  )
  /*
    The legacy site's host is shown as aniliberty.top: the picker's tag says
    where the episodes come from, and that is no longer anilibria.tv.
  */
  const host = ANILIBERTY_RELEASE.test(url) ? pageHost : 'aniliberty.top'
  const streaming = anilibertyInfo({ ...data, alias: data.alias || alias }, origin, host)
  return { url, streaming, extractor: EXTRACTOR, title: streaming.title, thumbnail: streaming.thumbnail }
}

/**
 * One episode's watch page: its stream, and a picker for its heights.
 *
 * The picker is what detection shows; the stream is for anything that only
 * wants one. Both are named after the release and the episode, since the page
 * itself is titled after neither.
 */
async function resolveEpisodePage(url: string): Promise<ResolvedUrl> {
  const id = ANILIBERTY_EPISODE.exec(url)?.[1]
  if (!id) return { url }
  const pageHost = hostOf(url).toLowerCase()
  const { data, origin } = await fetchApi<AniEpisodeAnswer>(
    `anime/releases/episodes/${id.toLowerCase()}`,
    pageHost
  )
  const release = data.release ?? {}
  assertPlayable(release)
  const alias = (release.alias ?? '').trim()
  const ordinal = episodeOrdinal(data)
  const tiers = episodeTiers(data)
  if (!alias || ordinal === undefined) throw new Error(EPISODE_MISSING)
  if (!tiers.length) throw new Error(NO_STREAMS)
  const title = `${releaseTitle(release)} - ${episodeLabel(ordinal)}`
  const thumbnail = posterOf(release, origin)
  const streaming: StreamingInfo = {
    provider: 'aniliberty',
    host: pageHost.replace(/^www\./, ''),
    id: alias,
    title,
    thumbnail,
    isSeries: false,
    loneEpisode: true,
    translators: [{ id: alias, name: DUB_NAME }],
    defaultTranslator: alias,
    seasons: [{ season: 1, episodes: [ordinal] }],
    qualities: qualityLabels(tiers.map((t) => t.height))
  }
  return {
    url: tiers[0].url,
    referer: REFERER,
    extractor: EXTRACTOR,
    title,
    thumbnail,
    duration: data.duration ?? undefined,
    streaming,
    downloadUrl: anilibStreamUrl(alias, ordinal, 'best')
  }
}

/**
 * Re-resolve a queued `uvd-anilib://` episode to a fresh stream.
 *
 * The release is asked for again rather than the manifest kept: the queue may
 * start this hours later, and the address is the one thing that stays put.
 */
export async function resolveAnilibStream(uvdUrl: string): Promise<ResolvedUrl> {
  const parsed = parseAnilibStreamUrl(uvdUrl)
  if (!parsed) throw new Error(EPISODE_MISSING)
  const { data, origin } = await fetchApi<AniRelease>(
    `anime/releases/${encodeURIComponent(parsed.alias)}`
  )
  assertPlayable(data)
  const found = playableEpisodes(data).find((e) => e.ordinal === parsed.ordinal)
  if (!found) throw new Error(EPISODE_MISSING)
  const tier = pickAnilibTier(episodeTiers(found.episode), parsed.quality)
  if (!tier) throw new Error(NO_STREAMS)
  return {
    url: tier.url,
    referer: REFERER,
    extractor: EXTRACTOR,
    title: `${releaseTitle(data)} - ${episodeLabel(parsed.ordinal)}`,
    thumbnail: posterOf(data, origin),
    duration: found.episode.duration ?? undefined,
    downloadUrl: uvdUrl
  }
}

export const anilibertyResolvers: SiteResolver[] = [
  { id: EXTRACTOR, match: ANILIBERTY_RELEASE, resolve: resolveRelease },
  { id: EXTRACTOR, match: ANILIBRIA_LEGACY_RELEASE, resolve: resolveRelease },
  { id: EXTRACTOR, match: ANILIBERTY_EPISODE, resolve: resolveEpisodePage }
]
