import { b64urlDecode, b64urlEncode } from '../http'
import type { ResolveOptions, ResolvedUrl } from '../types'

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

/**
 * Headers that are the user's credentials rather than a description of the
 * request. These never go into the URL.
 */
const SECRET_HEADER = /^(cookie|authorization|x-csrf-token|x-auth-token)$/i

/**
 * The credentials for a picked stream, held in memory and nowhere else.
 *
 * This URL is the queue item's `url` and `sourceUrl`, and it is base64 rather
 * than encrypted — so everything inside it is written to history.json and sent
 * to the renderer on every progress update. The sanitiser that keeps captured
 * headers out of both only deletes `DownloadItem.headers`; it cannot see into
 * an encoded string, so a session cookie from a site the user is signed into
 * was landing on disk and surviving restarts.
 *
 * Keeping them here means they last exactly as long as the process, which is
 * also as long as they are worth anything: a stale capture re-resolves the page
 * through the browsing session, which still holds the real login.
 */
const secrets = new Map<string, Record<string, string>>()

/** Bounded so a long session of picking streams cannot grow it without limit. */
const MAX_SECRETS = 200

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
  const safe: Record<string, string> = {}
  const secret: Record<string, string> = {}
  for (const [key, value] of Object.entries(payload.headers ?? {})) {
    if (SECRET_HEADER.test(key)) secret[key] = value
    else safe[key] = value
  }

  const uvdUrl =
    DIRECT_SCHEME +
    b64urlEncode(
      JSON.stringify({
        ...payload,
        headers: Object.keys(safe).length ? safe : undefined,
        capturedAt: Date.now()
      })
    )

  if (Object.keys(secret).length) {
    if (secrets.size >= MAX_SECRETS) secrets.delete(secrets.keys().next().value as string)
    secrets.set(uvdUrl, secret)
  }
  return uvdUrl
}

/** The credentials for this URL, if they were captured in this session. */
export function directSecrets(uvdUrl: string): Record<string, string> | undefined {
  return secrets.get(uvdUrl)
}

export function parseDirectUrl(uvdUrl: string): DirectPayload | null {
  try {
    return JSON.parse(b64urlDecode(uvdUrl.slice(DIRECT_SCHEME.length))) as DirectPayload
  } catch {
    return null
  }
}

export async function resolveDirectUrl(
  uvdUrl: string,
  options: ResolveOptions = {}
): Promise<ResolvedUrl> {
  const payload = parseDirectUrl(uvdUrl)
  if (!payload) throw new Error('This download link is corrupted — pick the video again.')

  const fresh = Date.now() - payload.capturedAt < FRESH_MS
  if (!fresh && payload.pageUrl) {
    // Lazily imported: the universal resolver pulls in the headless browser.
    const { resolveUniversal } = await import('./index')
    const refreshed = await resolveUniversal(payload.pageUrl, options).catch(() => null)
    if (refreshed) {
      return {
        ...refreshed,
        title: payload.title || refreshed.title,
        thumbnail: payload.thumbnail || refreshed.thumbnail,
        downloadUrl: uvdUrl
      }
    }
  }

  /*
    Put the credentials back on, from memory. They are what makes a stream from
    a site the user is signed into fetchable at all, and they are deliberately
    not in the URL — see `secrets` above. After a restart there are none, which
    is the right outcome: a capture that old has almost certainly expired, and
    the branch above re-resolves the page through the browsing session, which
    still holds the real login.
  */
  const secret = directSecrets(uvdUrl)
  const headers = { ...(payload.headers ?? {}), ...(secret ?? {}) }

  return {
    url: payload.url,
    referer: payload.referer,
    headers: Object.keys(headers).length ? headers : undefined,
    title: payload.title,
    thumbnail: payload.thumbnail,
    extractor: 'Browser',
    downloadUrl: uvdUrl
  }
}
