import { cumgloryholeResolvers } from './sites/cumgloryhole'
import { rezkaResolvers, resolveRezkaStream } from './sites/rezka'
import { yummyaniResolvers, resolveYummyaniItem, resolveYummyaniStream } from './sites/yummyani'
import { resolveSniffUrl, SNIFF_SCHEME } from './universal'
import { DIRECT_SCHEME, resolveDirectUrl } from './universal/direct'
import { normalizeUrl } from '@shared/urls'
import type { ResolveOptions, ResolvedUrl, SiteResolver } from './types'

export type { ResolvedEntry, ResolveOptions, ResolvedUrl, SiteResolver } from './types'
export { searchYummyani } from './sites/yummyani'
export { resolveUniversal, sniffUrlFor, SNIFF_SCHEME } from './universal'
export type { UniversalStage } from './universal'
export { directUrlFor, DIRECT_SCHEME } from './universal/direct'

/**
 * Hand-written resolvers, tried in order. Most sites never need one — the
 * engine or the universal resolver handles them. These exist for the awkward
 * cases: players that hide their stream behind a signed AJAX call, or listing
 * pages we want to turn into a downloadable playlist.
 *
 * Adding a site: drop a module in `./sites`, export a `SiteResolver[]`, and
 * list it here. Nothing else in the app needs to change.
 */
const resolvers: SiteResolver[] = [
  ...cumgloryholeResolvers,
  ...rezkaResolvers,
  ...yummyaniResolvers
]

/** Internal `uvd-*://` URLs the queue stores so streams can be re-resolved. */
const internalSchemes: {
  prefix: string
  resolve: (url: string, options?: ResolveOptions) => Promise<ResolvedUrl>
}[] = [
  { prefix: 'uvd-rezka://', resolve: resolveRezkaStream },
  { prefix: 'uvd-yummy-item://', resolve: resolveYummyaniItem },
  { prefix: 'uvd-yummy://', resolve: resolveYummyaniStream },
  { prefix: SNIFF_SCHEME, resolve: resolveSniffUrl },
  { prefix: DIRECT_SCHEME, resolve: resolveDirectUrl }
]

export function isInternalUrl(input: string): boolean {
  const trimmed = input.trim()
  return internalSchemes.some((s) => trimmed.startsWith(s.prefix))
}

/**
 * Resolve an input URL to something the engine can download. Custom sites are
 * scraped for their real stream URL (and required headers); everything else
 * passes through untouched so the engine — and then the universal resolver —
 * can have a go at it.
 */
export async function resolveUrl(
  input: string,
  options: ResolveOptions = {}
): Promise<ResolvedUrl> {
  const raw = input.trim()

  for (const scheme of internalSchemes) {
    if (raw.startsWith(scheme.prefix)) return scheme.resolve(raw, options)
  }

  // Callers normalise before queueing, but history written by an older build
  // has not been through it — and a share link with a stale tracking parameter
  // is one the engine may well refuse.
  const trimmed = normalizeUrl(raw)

  for (const r of resolvers) {
    if (!r.match.test(trimmed)) continue
    try {
      const resolved = await r.resolve(trimmed)
      return { extractor: r.id, ...resolved }
    } catch (err) {
      // A resolver that throws for a real reason (premium content, removed
      // video) should surface that reason rather than silently degrading.
      if (err instanceof Error && !/HTTP \d{3}|timed out/i.test(err.message)) throw err
      return { url: trimmed }
    }
  }

  return { url: trimmed }
}

/** Whether a URL is handled by a hand-written resolver. */
export function hasResolver(input: string): boolean {
  return resolvers.some((r) => r.match.test(normalizeUrl(input)))
}
