import { fetchText, pick, slugToTitle } from '../http'
import type { ResolvedEntry, ResolvedUrl, SiteResolver } from '../types'

const BASE = 'https://cumgloryhole.se'
const REFERER = 'https://cumgloryhole.se/'

async function resolveVideo(url: string): Promise<ResolvedUrl> {
  const html = await fetchText(url, { Referer: REFERER })
  const m3u8 = pick(/(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/, html)
  if (!m3u8) return { url }
  const rawTitle =
    pick(/<meta property="og:title" content="([^"]+)"/, html) ||
    pick(/<title>([^<]+)<\/title>/, html) ||
    ''
  const title = rawTitle.replace(/\s*[-|]\s*CumGloryHole.*$/i, '').trim()
  const thumbnail =
    pick(/<meta property="og:image" content="([^"]+)"/, html) ||
    pick(/(https?:\/\/[^"'\s]+\/cover\/[^"'\s]+\.(?:jpg|jpeg|webp))/, html)
  return {
    url: m3u8,
    referer: REFERER,
    title: title || undefined,
    thumbnail,
    extractor: 'CumGloryHole'
  }
}

async function resolveModel(url: string): Promise<ResolvedUrl> {
  const html = await fetchText(url, { Referer: REFERER })
  const paths = [...new Set([...html.matchAll(/href="(\/videos\/[^"]+)"/g)].map((m) => m[1]))]
  const entries: ResolvedEntry[] = paths.map((p) => ({ url: BASE + p, title: slugToTitle(p) }))
  const name = pick(/\/models\/[^/]+\/([^/?#]+)/, url) || 'playlist'
  return {
    url,
    isPlaylist: true,
    playlistTitle: slugToTitle('/' + name),
    entries,
    extractor: 'CumGloryHole'
  }
}

export const cumgloryholeResolvers: SiteResolver[] = [
  {
    id: 'CumGloryHole',
    match: /^https?:\/\/(?:[a-z0-9-]+\.)*cumgloryhole\.se\/videos\//i,
    resolve: resolveVideo
  },
  {
    id: 'CumGloryHole',
    match: /^https?:\/\/(?:[a-z0-9-]+\.)*cumgloryhole\.se\/models\//i,
    resolve: resolveModel
  }
]
