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

/**
 * Fetches currently in flight, keyed the same way as the cache.
 *
 * The cache only helps once a fetch has finished, and these all start at the
 * same moment: a queue or a search grid mounts, every tile's direct <img> load
 * fails at once, and every one of them asks the main process independently.
 * Identical URLs — the same video listed twice, a poster shared across
 * episodes — each got their own fetch, and each of those tries up to three
 * referers before giving up. Callers that ask for the same image while one is
 * already running now wait on that one.
 */
const inFlight = new Map<string, Promise<string | null>>()

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

async function fetchOnce(url: string, pageUrl: string | undefined, key: string): Promise<string | null> {
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

export function fetchThumbnail(url: string, pageUrl?: string): Promise<string | null> {
  if (!/^https?:\/\//i.test(url)) return Promise.resolve(null)
  const key = `${url}|${pageUrl ?? ''}`
  const cached = cache.get(key)
  if (cached !== undefined) return Promise.resolve(cached)

  const running = inFlight.get(key)
  if (running) return running

  const task = fetchOnce(url, pageUrl, key).finally(() => inFlight.delete(key))
  inFlight.set(key, task)
  return task
}
