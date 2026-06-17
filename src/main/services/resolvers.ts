import { net } from 'electron'

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

interface Resolver {
  match: RegExp
  resolve: (url: string) => Promise<ResolvedUrl>
}

const resolvers: Resolver[] = [
  { match: /^https?:\/\/(?:[a-z0-9-]+\.)*cumgloryhole\.se\/videos\//i, resolve: resolveCghVideo },
  { match: /^https?:\/\/(?:[a-z0-9-]+\.)*cumgloryhole\.se\/models\//i, resolve: resolveCghModel }
]

/**
 * Resolve an input URL to something the engine can download. For supported
 * custom sites this scrapes the page for the real stream URL (and required
 * referer) or a playlist of entries. For everything else it passes through.
 */
export async function resolveUrl(input: string): Promise<ResolvedUrl> {
  const trimmed = input.trim()
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
