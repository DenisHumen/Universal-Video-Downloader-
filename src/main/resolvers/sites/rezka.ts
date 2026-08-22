import { cleanHtml, fetchText, hostOf, netPost, pick } from '../http'
import type { ResolvedUrl, SiteResolver } from '../types'
import type { StreamingInfo, StreamSeason, StreamTranslator } from '@shared/types'

/** Matches any host containing "rezka": rezka.ag, hdrezka.me, rezka-tv.to, … */
export const REZKA_DOMAIN = /^https?:\/\/(?:[a-z0-9-]+\.)*[a-z0-9-]*rezka[a-z0-9-]*\.[a-z]{2,}\//i

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
  const raw = await netPost(`https://${host}/ajax/get_cdn_series/?t=${Date.now()}`, params.toString(), {
    Referer: `https://${host}/`
  })
  const json = JSON.parse(raw) as { url?: string; success?: boolean; premium_content?: number }
  if (json.premium_content || !json.url) {
    throw new Error('This translation requires HDrezka Premium — it can’t be downloaded.')
  }
  return parseStreams(json.url)
}

async function resolvePage(url: string): Promise<ResolvedUrl> {
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
