import { fetchBinary, originOf } from '../resolvers/http'

/**
 * Thumbnail loading for hotlink-protected CDNs.
 *
 * Plenty of sites (adult tubes especially) serve poster images only when the
 * request carries a `Referer` from their own domain. The renderer can't do
 * that — it fetches with `no-referrer` on purpose, so a plain <img src> gets a
 * 403 and the card shows a broken image. The main process has no such
 * restriction, so it fetches the bytes with the right headers and hands the
 * renderer a data: URL instead.
 *
 * Only used as a fallback: images that load directly never come through here.
 */

const MAX_ENTRIES = 240
const cache = new Map<string, string | null>()

function remember(key: string, value: string | null): string | null {
  if (cache.size >= MAX_ENTRIES) {
    // Plain FIFO eviction — these are cheap to re-fetch.
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, value)
  return value
}

/**
 * Referers worth trying, best first: the page the image belongs to, then the
 * image's own origin (which satisfies CDNs that merely require *some* referer).
 */
function refererCandidates(url: string, pageUrl?: string): (string | undefined)[] {
  const candidates: (string | undefined)[] = []
  const page = pageUrl ? originOf(pageUrl) : undefined
  if (page) candidates.push(page + '/')
  const own = originOf(url)
  if (own && own + '/' !== candidates[0]) candidates.push(own + '/')
  candidates.push(undefined)
  return candidates
}

export async function fetchThumbnail(url: string, pageUrl?: string): Promise<string | null> {
  if (!/^https?:\/\//i.test(url)) return null
  const key = `${url}|${pageUrl ?? ''}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  for (const referer of refererCandidates(url, pageUrl)) {
    try {
      const { body, contentType } = await fetchBinary(url, referer ? { Referer: referer } : {})
      if (!body.length || !/^image\//i.test(contentType)) continue
      return remember(key, `data:${contentType};base64,${body.toString('base64')}`)
    } catch {
      // Try the next referer before giving up.
    }
  }
  // Remember the failure too, so a grid of dead thumbnails doesn't retry forever.
  return remember(key, null)
}
