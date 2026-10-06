import { app } from 'electron'
import { cleanHtml, fetchText, hostOf, netPost, pick } from '../http'
import type { ResolvedUrl, SiteResolver } from '../types'
import type { StreamingInfo, StreamSeason, StreamTranslator } from '@shared/types'

/** Matches any host containing "rezka": rezka.ag, hdrezka.me, rezka-tv.to, … */
export const REZKA_DOMAIN = /^https?:\/\/(?:[a-z0-9-]+\.)*[a-z0-9-]*rezka[a-z0-9-]*\.[a-z]{2,}\//i

/**
 * The user agent rezka is asked with.
 *
 * Every rezka mirror now sits behind Anubis, a proof-of-work gate whose stock
 * policy challenges anything that calls itself a browser. To the Chrome agent
 * every other resolver sends, the page and the stream API alike answered with
 * "Проверяем, что вы не бот!" and a page of challenge script; to a
 * client naming itself plainly they answered with the real thing. Not `curl`:
 * the site refuses that one outright. Rezka only — the other sites still want
 * to see Chrome.
 *
 * A function, because `app` exists only inside Electron and the tests import
 * this module without it.
 */
function rezkaUserAgent(): string {
  return `UniversalVideoDownloader/${app.getVersion()}`
}

/**
 * Whether rezka answered with Anubis's challenge instead of what was asked for.
 *
 * The challenge is a 200 with an HTML body, so nothing downstream noticed. The
 * page parser found no title id and handed the link back untouched — no picker,
 * no error — and every queued episode failed on the stream API's reply with
 * "Unexpected token '<'… is not valid JSON".
 */
export function isBotCheck(body: string): boolean {
  return /\/\.within\.website\/|<title>[^<]*(?:не бот|not a bot)/i.test(body)
}

/*
  Says what happened in words no rule in `classifyYtdlpError` claims, so it
  reaches the user as written. "Instead of the page" would not have: the bare
  "age" in the age-restriction rule matches "page", and the user would have been
  told the title was age-restricted and sent off to set up cookies.
*/
const BOT_CHECK = 'HDrezka answered with a bot check instead of the video.'

interface RezkaStream {
  quality: string
  height: number
  url: string
}

/**
 * The height a HDRezka quality label stands for.
 *
 * These are free text from the site: `360p`, `1080p`, `1080p Ultra`, `4K`.
 * Reading them with `parseInt` turned `4K` into 4, which sorted the best stream
 * the site offers below its worst — so "best quality" picked 1080p and never
 * once chose 4K, and asking for 480p could hand back the 4K stream because 4 is
 * less than 480.
 */
export function labelHeight(label: string): number {
  const k = /(\d+)\s*k\b/i.exec(label)
  if (k) return { 2: 1440, 4: 2160, 8: 4320 }[Number(k[1])] ?? Number(k[1]) * 540
  const p = /(\d{3,4})\s*p?/i.exec(label)
  return p ? Number(p[1]) : 0
}

export function parseStreams(raw: string): RezkaStream[] {
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
    out.push({ quality: label, height: labelHeight(label), url })
  }
  return out.sort((a, b) => a.height - b.height)
}

export function pickQuality(streams: RezkaStream[], requested: string): RezkaStream | undefined {
  if (!streams.length) return undefined
  if (requested === 'best' || requested === 'audio' || !requested) return streams[streams.length - 1]
  const want = labelHeight(requested)
  const atOrBelow = streams.filter((s) => s.height <= want)
  return atOrBelow.length ? atOrBelow[atOrBelow.length - 1] : streams[0]
}

interface RezkaReply {
  success?: boolean
  premium_content?: number
  url?: string | false
  episodes?: string
}

/**
 * Read an answer from rezka's player API.
 *
 * Not trusted to be JSON. Behind the bot check it is the challenge page, and
 * `JSON.parse` failing on that was the whole of what the user saw — a raw
 * SyntaxError on every queued episode, since those ask again on every start
 * and retry.
 */
function readReply(raw: string): RezkaReply {
  if (isBotCheck(raw)) throw new Error(BOT_CHECK)
  try {
    const json: unknown = JSON.parse(raw)
    if (json && typeof json === 'object') return json as RezkaReply
  } catch {
    /* said below */
  }
  throw new Error('HDrezka answered with something other than its player data.')
}

/** The streams in an answer to `get_stream` / `get_movie`. */
export function parseStreamReply(raw: string): RezkaStream[] {
  const json = readReply(raw)
  if (json.premium_content) {
    throw new Error('This translation requires HDrezka Premium — it can’t be downloaded.')
  }
  /*
    What rezka sends for an episode a translation does not have: no URL, and a
    Russian "the session has expired, refresh the page", whatever actually
    happened. This used to be reported as Premium, which sends somebody
    looking for a subscription that would not help.
  */
  if (json.success === false || !json.url) {
    throw new Error('HDrezka has no stream for this translation and episode.')
  }
  return parseStreams(json.url)
}

/** Seasons and episodes as rezka marks them up, on the page and in its API alike. */
export function parseEpisodes(html: string): StreamSeason[] {
  const epMap = new Map<number, Set<number>>()
  for (const em of html.matchAll(/data-season_id="(\d+)"\s+data-episode_id="(\d+)"/g)) {
    const s = Number(em[1])
    if (!epMap.has(s)) epMap.set(s, new Set())
    epMap.get(s)!.add(Number(em[2]))
  }
  return [...epMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([season, set]) => ({ season, episodes: [...set].sort((a, b) => a - b) }))
}

/** The episodes in an answer to `get_episodes`. */
export function parseEpisodeReply(raw: string): StreamSeason[] {
  const json = readReply(raw)
  if (json.success === false || typeof json.episodes !== 'string') {
    throw new Error('HDrezka did not list the episodes of this translation.')
  }
  return parseEpisodes(json.episodes)
}

function playerApi(host: string, params: URLSearchParams): Promise<string> {
  return netPost(`https://${host}/ajax/get_cdn_series/?t=${Date.now()}`, params.toString(), {
    Referer: `https://${host}/`,
    'User-Agent': rezkaUserAgent()
  })
}

async function getStreams(
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
  return parseStreamReply(await playerApi(host, params))
}

/**
 * The episodes one translation has.
 *
 * A rezka page lists the episodes of the translation it opens on and no other;
 * the rest are this request away, the same one the site's own player makes
 * when another translation is clicked. Dubs run at different paces, so the
 * page's list is not a stand-in for anybody else's.
 */
export async function rezkaEpisodes(
  host: string,
  id: string,
  translatorId: string
): Promise<StreamSeason[]> {
  const params = new URLSearchParams({ id, translator_id: translatorId, action: 'get_episodes' })
  return parseEpisodeReply(await playerApi(host, params))
}

const TRANSLATOR = /<(?:a|li)\b([^>]*\bdata-translator_id="(\d+)"[^>]*)>\s*([^<]*)/g

/**
 * The translators a title page offers.
 *
 * Some titles list them as links, others as plain `<li data-translator_id>`.
 * Only the links were looked for, so a title of the second kind came back with
 * one translator called "Default", the page's own, and none of the others
 * could be picked.
 */
export function parseTranslators(html: string): StreamTranslator[] {
  const translators: StreamTranslator[] = []
  const seen = new Set<string>()
  for (const tm of html.matchAll(TRANSLATOR)) {
    const attrs = tm[1]
    const tid = tm[2]
    const title = pick(/title="([^"]*)"/, attrs)
    const name = cleanHtml(title || tm[3] || '')
    if (name && !seen.has(tid)) {
      seen.add(tid)
      // The class, not the whole tag: a studio called Premier is not a paywall.
      translators.push({ id: tid, name, premium: /class="[^"]*prem/i.test(attrs) })
    }
  }
  return translators
}

async function resolvePage(url: string): Promise<ResolvedUrl> {
  const host = hostOf(url)
  const html = await fetchText(url, { Referer: `https://${host}/`, 'User-Agent': rezkaUserAgent() })
  if (isBotCheck(html)) throw new Error(BOT_CHECK)

  const sm = html.match(/initCDNSeriesEvents\((\d+),\s*(\d+),\s*(\d+),\s*(\d+),[^,]+,\s*'([^']+)'/)
  const mm = html.match(/initCDNMoviesEvents\((\d+),\s*(\d+)/)
  const isSeries = !!sm
  const id = isSeries ? sm![1] : mm ? mm[1] : pick(/data-post_id="(\d+)"/, html)
  if (!id) return { url }
  let defaultTranslator = isSeries ? sm![2] : mm ? mm[2] : '0'

  const translators = parseTranslators(html)
  if (!translators.length) translators.push({ id: defaultTranslator, name: 'Default' })
  // Start on a free translation so the picker doesn't open on a locked one.
  if (!translators.some((t) => t.id === defaultTranslator && !t.premium)) {
    defaultTranslator = (translators.find((t) => !t.premium) ?? translators[0]).id
  }

  const seasons = parseEpisodes(html)

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

/** The title number in a rezka page address: `/646-vo-vse-tyazhkie-2008-latest.html` is 646. */
export function rezkaTitleId(pageUrl: string): string | undefined {
  try {
    for (const segment of new URL(pageUrl).pathname.split('/')) {
      const m = /^(\d+)-/.exec(segment)
      if (m) return m[1]
    }
  } catch {
    /* not a URL */
  }
  return undefined
}

/**
 * The internal URL for one episode of the title at `pageUrl`.
 *
 * A watch keeps only the address the user pasted, and the number rezka hands
 * its player is the one in that address — checked on films, series and
 * anime — so an episode can be named without fetching the page again.
 */
export function rezkaEpisodeUrl(
  pageUrl: string,
  translatorId: string,
  season: number,
  episode: number,
  quality: string
): string {
  const host = hostOf(pageUrl)
  const id = rezkaTitleId(pageUrl)
  if (!host || !id) throw new Error('Cannot tell which HDrezka title this link is.')
  const q = encodeURIComponent(quality || 'best')
  return `uvd-rezka://${host}/${id}/${translatorId}/${season}/${episode}/${q}`
}

/**
 * Internal scheme the UI builds per chosen episode:
 *   uvd-rezka://<host>/<id>/<translatorId>/<season|movie>/<episode>/<quality>
 */
export async function resolveRezkaStream(uvdUrl: string): Promise<ResolvedUrl> {
  const rest = uvdUrl.replace(/^uvd-rezka:\/\//, '')
  const [host, id, translatorId, season, episode, quality] = rest.split('/')
  const isMovie = season === 'movie'
  const streams = await getStreams(host, id, translatorId, isMovie ? '' : season, isMovie ? '' : episode)
  const chosen = pickQuality(streams, decodeURIComponent(quality || 'best'))
  if (!chosen) throw new Error('No playable stream found for this episode.')
  return { url: chosen.url, referer: `https://${host}/`, extractor: 'HDrezka', downloadUrl: uvdUrl }
}

export const rezkaResolvers: SiteResolver[] = [
  { id: 'HDrezka', match: REZKA_DOMAIN, resolve: resolvePage }
]
