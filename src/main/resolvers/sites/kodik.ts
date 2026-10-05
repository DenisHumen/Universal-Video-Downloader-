import { b64urlDecode, b64urlEncode, cleanHtml, fetchText, netPost, pick } from '../http'
import type { ResolvedUrl, SiteResolver } from '../types'
import type { StreamingInfo } from '@shared/types'

/**
 * Kodik: not a site but the player most Russian anime and film sites embed.
 * YummyAnime plays through it, and so do animego and the many DLE clones, so a
 * copied player link, or a page with one in an iframe, is how users meet it.
 *
 * A player address says what it plays: `/seria/<id>/<hash>` one episode,
 * `/video/` a film, `/season/` one season with an option per episode, and
 * `/serial/` a series, with the episodes of one season in the page. The stream
 * itself comes from a signed POST the player's script makes, which is why
 * neither the engine nor a scrape of the page finds anything there.
 *
 * `/uv/` players are matched only to be refused in words: nobody has checked
 * what Kodik answers for them.
 */
export const KODIK_PLAYER =
  /^https?:\/\/(?:www\.)?(?:kodik(?:player)?\.(?:com|info|biz|cc)|aniqit\.com)\/(?:(?:seria|video|season|serial)\/\d+\/[a-f0-9]+|uv\/)/i

/** The queue address of a Kodik stream: `uvd-kodik://<player, base64url>/<episode>/<quality>`. */
export const KODIK_SCHEME = 'uvd-kodik://'

/*
  Every Kodik domain serves the same catalogue under the same ids and hashes,
  and kodikplayer.com is the only one left: kodik.info, kodik.cc, kodik.biz,
  aniqit.com and the kodikplayer.* variants no longer exist in DNS, and
  kodik.com is a parked page. Old embeds still carry them, so every player is
  fetched from kodikplayer.com - which is also where /ftor is asked, and the
  page's signatures are made out to the host that serves it.
*/
const KODIK_HOST = 'https://kodikplayer.com'
const KODIK_REFERER = 'https://kodikplayer.com/'

const UV_UNSUPPORTED = 'This Kodik /uv/ player is not supported yet.'

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

export interface KodikTarget {
  id: string
  hash: string
  /** What Kodik calls this: a film is asked about differently from an episode. */
  type: 'video' | 'seria'
}

export type KodikKind = 'seria' | 'video' | 'season' | 'serial'

export interface KodikPlayer {
  kind: KodikKind
  id: string
  hash: string
  /** Where to fetch it: on kodikplayer.com, with nothing in the query that hides episodes. */
  url: string
  /** The height the address asks for (`720p`), when it names one. */
  quality?: string
}

/**
 * What a Kodik player address plays, and the address to fetch it at.
 *
 * The query is dropped. `only_episode=true&episode=3`, which is how YummyAnime
 * embeds a season, turns a season player into one episode with no episode list
 * at all, and it is the season the user pasted. A series keeps `season`, the
 * one thing in its query that says which of its seasons the page will hold.
 */
export function parseKodikPlayer(url: string): KodikPlayer | undefined {
  if (!KODIK_PLAYER.test(url)) return undefined
  const m = url.match(/\/(seria|video|season|serial)\/(\d+)\/([a-f0-9]+)(?:\/(\d{3,4}p))?/i)
  if (!m) return undefined
  const kind = m[1].toLowerCase() as KodikKind
  const quality = m[4]?.toLowerCase()
  let query = ''
  if (kind === 'serial') {
    const season = pick(/[?&]season=(\d+)/, url)
    if (season) query = `?season=${season}`
  }
  return {
    kind,
    id: m[2],
    hash: m[3],
    url: `${KODIK_HOST}/${kind}/${m[2]}/${m[3]}/${quality ?? '720p'}${query}`,
    quality
  }
}

/**
 * Work out which thing to ask Kodik for, and how to ask.
 *
 * A series player carries an <option> per episode, each with the id and hash
 * for that episode, and is asked about with type=seria. A film has no episode
 * list at all - the player is /video/<id>/<hash> and those two values in the
 * address are the whole answer - and asking about it as an episode is answered
 * with HTTP 500. Reading only the option list therefore worked for every series
 * and failed on every film, with nothing to show for it but "episode not found"
 * on a page that has no episodes to find.
 *
 * An episode's own player, /seria/<id>/<hash>, is the same: no list, and the
 * address is the answer. It was read as a series and failed the same way, and
 * it is the shape animego and its kind embed, so every pasted episode link did.
 *
 * Failing all that, the page's `vInfo` names what it plays - but only on a page
 * with no episode list and no season in its address. A season or series page
 * has a vInfo too, and it is whichever episode the player opens on: read there,
 * an episode missing from the list would quietly download a different one under
 * its name instead of saying it is not there.
 */
export function kodikTarget(
  playerUrl: string,
  html: string,
  episode: number
): KodikTarget | undefined {
  const single = playerUrl.match(/\/(seria|video)\/(\d+)\/([a-f0-9]+)/)
  if (single) return { id: single[2], hash: single[3], type: single[1] as KodikTarget['type'] }

  for (const opt of html.match(/<option[^>]*>/g) || []) {
    const id = pick(/data-id="(\d+)"/, opt)
    const hash = pick(/data-hash="([a-f0-9]+)"/, opt)
    if (id && hash && Number(pick(/value="(\d+)"/, opt)) === episode) {
      return { id, hash, type: 'seria' }
    }
  }

  // Some players number their options from something other than one.
  const seq = [...html.matchAll(/data-id="(\d+)"\s+data-hash="([a-f0-9]+)"/g)]
  const fallback = seq[episode - 1]
  if (fallback) return { id: fallback[1], hash: fallback[2], type: 'seria' }

  if (/\/(?:season|serial)\//.test(playerUrl) || /<option[^>]*\sdata-hash="/.test(html)) {
    return undefined
  }
  const type = pick(/vInfo\.type\s*=\s*'(seria|video)'/, html)
  const hash = pick(/vInfo\.hash\s*=\s*'([a-f0-9]+)'/, html)
  const id = pick(/vInfo\.id\s*=\s*'(\d+)'/, html)
  return type && hash && id ? { id, hash, type: type as KodikTarget['type'] } : undefined
}

interface KodikStream {
  url: string
  /** Every height Kodik offered for it, lowest first (`360p`, `480p`, …). */
  heights: string[]
}

/** Ask Kodik for the stream a fetched player page plays, at the height requested or below. */
async function streamFrom(
  url: string,
  html: string,
  episode: number,
  requested: string
): Promise<KodikStream> {
  const upRaw = pick(/urlParams = '([^']+)'/, html)
  if (!upRaw) throw new Error('Kodik player params not found')
  const up = JSON.parse(upRaw) as Record<string, string>

  const target = kodikTarget(url, html, episode)
  if (!target) throw new Error('Episode not found in the Kodik player')

  const body = new URLSearchParams({
    d: up.d,
    d_sign: up.d_sign,
    pd: up.pd,
    pd_sign: up.pd_sign,
    ref: decodeURIComponent(up.ref || ''),
    ref_sign: up.ref_sign,
    bad_user: 'false',
    cdn_is_working: 'true',
    type: target.type,
    hash: target.hash,
    id: target.id
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
  /*
    Nothing at or below the request means every tier is above it — so take the
    lowest, the closest thing to what was asked for. This used to take
    `tiers[tiers.length - 1]`, the highest, which is the furthest: ask for 360p
    on a title Kodik only carries in 720p and 1080p and you were handed the
    1080p. The rezka resolver has always fallen back the other way.
  */
  const chosen = tiers.filter((t) => t.h <= want).pop()?.q || tiers[0].q
  return {
    url: kodikDecode(links[chosen][0].src),
    heights: tiers.filter((t) => t.h > 0).map((t) => `${t.h}p`)
  }
}

/**
 * The stream for one episode of a player, at the height requested or below.
 *
 * `referer` is what the player page is fetched with. Kodik signs whichever
 * site that names into the page, so each caller passes its own: YummyAnime its
 * site, a pasted player Kodik's own address.
 */
export async function kodikGetM3u8(
  playerUrl: string,
  episode: number,
  requested: string,
  referer: string
): Promise<string> {
  const url = playerUrl.startsWith('//') ? 'https:' + playerUrl : playerUrl
  const html = await fetchText(url, { Referer: referer })
  return (await streamFrom(url, html, episode, requested)).url
}

/** Episode numbers in a season or series player, each once and in order. */
export function kodikEpisodes(html: string): number[] {
  /*
    Only options with both an id and a hash. The voiceover list sits in the same
    page as options too, with a data-id of their own and a data-media-hash, and
    counted as episodes they would add one per dub.
  */
  const options = (html.match(/<option[^>]*>/g) || []).filter(
    (opt) => /\sdata-id="\d+"/.test(opt) && /\sdata-hash="[a-f0-9]+"/.test(opt)
  )
  const numbers = new Set<number>()
  for (const opt of options) {
    const n = Number(pick(/\svalue="(\d+)"/, opt))
    if (Number.isInteger(n) && n > 0) numbers.add(n)
  }
  // With no numbers on the options, they are asked for by position.
  if (!numbers.size) return options.map((_, i) => i + 1)
  return [...numbers].sort((a, b) => a - b)
}

/** The page's own title, unless it is the placeholder single players carry. */
function kodikTitle(html: string): string | undefined {
  const title = cleanHtml(pick(/<title[^>]*>([\s\S]*?)<\/title>/i, html) ?? '')
  return title && !/^kodik player$/i.test(title) ? title : undefined
}

/** The voiceover the player plays, from its `translationTitle`. */
function kodikTranslation(html: string): string | undefined {
  // The first one is often `null`; the quoted one further down is the answer.
  const raw = pick(/translationTitle\s*=\s*("(?:[^"\\]|\\.)*")/, html)
  if (!raw) return undefined
  try {
    return (JSON.parse(raw) as string).trim() || undefined
  } catch {
    return undefined
  }
}

/**
 * The episode picker for a season or series player.
 *
 * One voiceover, the one this player plays. The page also lists every other
 * dub of the season, but only with an episode count, and guessing their
 * episodes as 1..count would hand a dub that numbers from 13 the wrong episode
 * under the right label. A series player holds one season's episodes and no
 * other's, so that is the one season offered.
 *
 * Always a series, whatever the count: the address says so, and a season with
 * one episode out is exactly the thing worth following.
 */
export function kodikSeasonInfo(player: KodikPlayer, html: string): StreamingInfo | undefined {
  const episodes = kodikEpisodes(html)
  if (!episodes.length) return undefined
  const season =
    Number(pick(/seasonNumber\s*=\s*Number\((\d+)\)/, html)) ||
    Number(pick(/[?&]season=(\d+)/, player.url)) ||
    1
  const tid = b64urlEncode(player.url)
  const seasons = [{ season, episodes }]
  return {
    provider: 'kodik',
    host: 'kodikplayer.com',
    id: player.id,
    title: kodikTitle(html) || 'Kodik',
    isSeries: true,
    translators: [{ id: tid, name: kodikTranslation(html) || 'Kodik' }],
    defaultTranslator: tid,
    seasons,
    episodesByTranslator: { [tid]: seasons },
    qualities: ['360p', '480p', '720p']
  }
}

/**
 * The picker for an episode or a film on a player of its own: just the heights
 * Kodik offered, and the dub, which is the one thing the page names - single
 * players are all titled "Kodik Player", so the id stands in for a title.
 */
export function kodikSingleInfo(player: KodikPlayer, html: string, heights: string[]): StreamingInfo {
  const tid = b64urlEncode(player.url)
  return {
    provider: 'kodik',
    host: 'kodikplayer.com',
    id: player.id,
    title: kodikTitle(html) || `Kodik ${player.id}`,
    isSeries: false,
    loneEpisode: player.kind === 'seria' || undefined,
    translators: [{ id: tid, name: kodikTranslation(html) || 'Kodik' }],
    defaultTranslator: tid,
    seasons: [],
    qualities: heights.length ? heights : ['360p', '480p', '720p']
  }
}

/** The queue address that re-resolves one episode of a player to a fresh stream. */
export function kodikStreamUrl(playerUrl: string, episode: number, quality: string): string {
  return `${KODIK_SCHEME}${b64urlEncode(playerUrl)}/${episode}/${encodeURIComponent(quality)}`
}

/**
 * A Kodik player link: pasted, or found in an iframe on a page.
 *
 * A season or series becomes an episode picker. An episode or a film comes
 * back as its stream and as a picker for its heights both: the picker is what
 * detection shows, because the engine cannot describe Kodik's playlist - it
 * names no codecs, and a format with none never reaches the format list, so
 * the link was reported as having nothing to download - while anything that
 * only wants a stream takes the url.
 *
 * None of it is labelled YummyAnime, and none of it is queued as a YummyAnime
 * address: the label names the download folder, and a player copied off some
 * other site has nothing to do with YummyAnime.
 */
export async function resolveKodikPlayer(url: string): Promise<ResolvedUrl> {
  if (/^https?:\/\/[^/]+\/uv\//i.test(url)) throw new Error(UV_UNSUPPORTED)
  const player = parseKodikPlayer(url)
  if (!player) return { url }
  const html = await fetchText(player.url, { Referer: KODIK_REFERER })

  if (player.kind === 'season' || player.kind === 'serial') {
    const streaming = kodikSeasonInfo(player, html)
    if (!streaming) throw new Error('No episodes found in this Kodik player.')
    return { url: player.url, streaming, extractor: 'Kodik', title: streaming.title }
  }

  const quality = player.quality ?? 'best'
  const stream = await streamFrom(player.url, html, 1, quality)
  const streaming = kodikSingleInfo(player, html, stream.heights)
  return {
    url: stream.url,
    referer: KODIK_REFERER,
    extractor: 'Kodik',
    title: streaming.title,
    streaming,
    downloadUrl: kodikStreamUrl(player.url, 1, quality)
  }
}

/**
 * A Kodik player's answer, for the page it was found embedded in.
 *
 * An episode or a film takes the page's title: its own is "Kodik <id>", while
 * the page usually names the show and the episode. A season keeps Kodik's,
 * which names the season. A caller that needs a stream - a queued item being
 * re-resolved - gets the episode's or film's stream with no picker attached,
 * and nothing for a season, which has no one stream to give.
 */
export function kodikOnPage(
  resolved: ResolvedUrl,
  page: { title?: string; thumbnail?: string },
  needStream = false
): ResolvedUrl | null {
  const s = resolved.streaming
  if (!s) return null
  if (s.isSeries) return needStream ? null : resolved
  if (!resolved.downloadUrl) return null
  const title = page.title || resolved.title
  const thumbnail = page.thumbnail || resolved.thumbnail
  if (needStream) return { ...resolved, streaming: undefined, title, thumbnail }
  return {
    ...resolved,
    title,
    thumbnail,
    streaming: { ...s, title: title || s.title, thumbnail: thumbnail || s.thumbnail }
  }
}

/** Re-resolve a queued `uvd-kodik://` item to a fresh stream. */
export async function resolveKodikStream(uvdUrl: string): Promise<ResolvedUrl> {
  const [tid, episode, quality] = uvdUrl.slice(KODIK_SCHEME.length).split('/')
  const m3u8 = await kodikGetM3u8(
    b64urlDecode(tid),
    Number(episode),
    decodeURIComponent(quality || 'best'),
    KODIK_REFERER
  )
  return { url: m3u8, referer: KODIK_REFERER, extractor: 'Kodik', downloadUrl: uvdUrl }
}

export const kodikResolvers: SiteResolver[] = [
  { id: 'Kodik', match: KODIK_PLAYER, resolve: resolveKodikPlayer }
]
