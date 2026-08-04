import { b64urlDecode, b64urlEncode } from '../http'
import type { ResolvedUrl } from '../types'

/**
 * `uvd-direct://` — a stream the user picked by hand in the built-in browser.
 *
 * The captured URL works immediately, but CDN links are signed and short-lived,
 * so the payload also remembers the page it came from. A fresh capture is used
 * as-is; once it has aged past the grace window (a retry hours later, say) the
 * page is re-resolved instead, which produces a new signed URL using the same
 * cookies the user established in the browser.
 */

export const DIRECT_SCHEME = 'uvd-direct://'

/** How long a captured stream URL is assumed to still be valid. */
const FRESH_MS = 5 * 60 * 1000

export interface DirectPayload {
  url: string
  headers?: Record<string, string>
  referer?: string
  pageUrl?: string
  title?: string
  thumbnail?: string
  capturedAt: number
}

export function directUrlFor(payload: Omit<DirectPayload, 'capturedAt'>): string {
  return DIRECT_SCHEME + b64urlEncode(JSON.stringify({ ...payload, capturedAt: Date.now() }))
}

export function parseDirectUrl(uvdUrl: string): DirectPayload | null {
  try {
    return JSON.parse(b64urlDecode(uvdUrl.slice(DIRECT_SCHEME.length))) as DirectPayload
  } catch {
    return null
  }
}

export async function resolveDirectUrl(uvdUrl: string): Promise<ResolvedUrl> {
  const payload = parseDirectUrl(uvdUrl)
  if (!payload) throw new Error('This download link is corrupted — pick the video again.')

  const fresh = Date.now() - payload.capturedAt < FRESH_MS
  if (!fresh && payload.pageUrl) {
    // Lazily imported: the universal resolver pulls in the headless browser.
    const { resolveUniversal } = await import('./index')
    const refreshed = await resolveUniversal(payload.pageUrl).catch(() => null)
    if (refreshed) {
      return {
        ...refreshed,
        title: payload.title || refreshed.title,
        thumbnail: payload.thumbnail || refreshed.thumbnail,
        downloadUrl: uvdUrl
      }
    }
  }

  return {
    url: payload.url,
    referer: payload.referer,
    headers: payload.headers,
    title: payload.title,
    thumbnail: payload.thumbnail,
    extractor: 'Browser',
    downloadUrl: uvdUrl
  }
}
