import { SEARCH_CAP, SEARCH_CAP_PER_SERVICE, type SearchResult, type SearchScope } from '@shared/types'

/** The first page of a search: per service when every service is searched, so the grid stays balanced. */
export const firstLimit = (scope: SearchScope): number => (scope === 'all' ? 6 : 12)

/** As far as a search can go; main clamps to the same figures. */
export const capLimit = (scope: SearchScope): number => (scope === 'all' ? SEARCH_CAP_PER_SERVICE : SEARCH_CAP)

/**
 * Whether asking for more could bring anything.
 *
 * By service, because the limit is per service when everything is searched: a
 * service that came back short has told all it knows, and the search is worth
 * repeating only if one of them filled its page.
 */
export function mightHaveMore(results: SearchResult[], limit: number): boolean {
  const counts = new Map<string, number>()
  for (const r of results) counts.set(r.service, (counts.get(r.service) ?? 0) + 1)
  return [...counts.values()].some((n) => n >= limit)
}

/** The rows on screen, in place, then what the wider answer adds, by URL as main itself dedupes. */
export function mergeByUrl(
  have: SearchResult[],
  more: SearchResult[]
): { merged: SearchResult[]; fresh: SearchResult[] } {
  const seen = new Set(have.map((r) => r.url))
  const fresh = more.filter((r) => {
    if (seen.has(r.url)) return false
    seen.add(r.url)
    return true
  })
  return { merged: [...have, ...fresh], fresh }
}
