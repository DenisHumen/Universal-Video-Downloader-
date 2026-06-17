import { net } from 'electron'
import type { StreamingInfo, StreamSeason, StreamTranslator } from '@shared/types'

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
  const json = JSON.parse(raw) as { url?: string; success?: boolean }
  if (!json.url) throw new Error('The stream is unavailable (it may be Premium-only).')
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
  const defaultTranslator = isSeries ? sm![2] : mm ? mm[2] : '0'

  const translators: StreamTranslator[] = []
  const seen = new Set<string>()
  for (const tm of html.matchAll(/data-translator_id="(\d+)"[^>]*>\s*([^<]+?)\s*(?=<)/g)) {
    const tid = tm[1]
    const name = tm[2].trim()
    if (name && !seen.has(tid)) {
      seen.add(tid)
      translators.push({ id: tid, name })
    }
  }
  if (!translators.length) translators.push({ id: defaultTranslator, name: 'Default' })

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

interface Resolver {
  match: RegExp
  resolve: (url: string) => Promise<ResolvedUrl>
}

const resolvers: Resolver[] = [
  { match: /^https?:\/\/(?:[a-z0-9-]+\.)*cumgloryhole\.se\/videos\//i, resolve: resolveCghVideo },
  { match: /^https?:\/\/(?:[a-z0-9-]+\.)*cumgloryhole\.se\/models\//i, resolve: resolveCghModel },
  { match: REZKA_DOMAIN, resolve: resolveRezkaPage }
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
