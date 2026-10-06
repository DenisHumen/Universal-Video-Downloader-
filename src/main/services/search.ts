import { spawn } from 'child_process'
import { ytdlpBinaryPath, ytdlpSpawnOptions, engineUnavailable } from './ytdlp'
import { killTree } from './process'
import { classifyYtdlpError } from './options'
import { searchYummyani } from '../resolvers'
import { unreachableCode } from '../resolvers/neterror'
import { searchBilibili, searchDailymotion, searchNiconico } from './search-apis'
import { getSettings } from './settings'
import { ADULT_SEARCH_SERVICES, allowedSearchServices, SEARCH_ALL_SERVICES } from '@shared/types'
import { isAbsoluteUrl } from '@shared/urls'
import type { SearchResponse, SearchResult, SearchScope, SearchService } from '@shared/types'

interface FlatEntry {
  id?: string
  url?: string
  webpage_url?: string
  title?: string
  duration?: number
  uploader?: string
  channel?: string
  view_count?: number
  thumbnails?: { url: string }[]
  thumbnail?: string
}

interface FlatPlaylist {
  entries?: FlatEntry[]
}

/** Services searched through the engine's `<prefix>N:query` search extractors. */
const PREFIX: Partial<Record<SearchService, string>> = {
  youtube: 'ytsearch',
  soundcloud: 'scsearch'
}

/** Services searched by handing the engine a site search-results URL. */
const URL_SEARCH: Partial<Record<SearchService, (q: string) => string>> = {
  pornhub: (q) => `https://www.pornhub.com/video/search?search=${encodeURIComponent(q)}`
}

/**
 * Services searched through the site's own API, without the engine.
 *
 * Each answers with a whole response rather than a bare list, because
 * Bilibili has a failure of its own to report: an anti-bot refusal that is
 * neither "nothing found" nor a network error.
 */
const API_SEARCH: Partial<Record<SearchService, (q: string, cap: number) => Promise<SearchResponse>>> = {
  yummyani: async (q, cap) => ({ ok: true, results: await searchYummyani(q, cap) }),
  dailymotion: async (q, cap) => ({ ok: true, results: await searchDailymotion(q, cap) }),
  niconico: async (q, cap) => ({ ok: true, results: await searchNiconico(q, cap) }),
  bilibili: searchBilibili
}

function thumbnailOf(entry: FlatEntry, service: SearchService): string | undefined {
  let u: string | undefined
  if (entry.thumbnail) u = entry.thumbnail
  else if (entry.thumbnails?.length) u = entry.thumbnails[entry.thumbnails.length - 1].url
  // YouTube flat entries sometimes come without thumbnails — derive one.
  else if (service === 'youtube' && entry.id) u = `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`
  if (u && u.startsWith('//')) u = 'https:' + u
  return u
}

/** Run one engine search (prefix- or URL-based) and map the flat entries. */
function ytdlpSearch(target: string, service: SearchService, limit: number): Promise<SearchResponse> {
  const args = [
    '-J',
    '--flat-playlist',
    '--no-warnings',
    '--no-progress',
    '--ignore-config',
    '--encoding',
    'utf-8'
  ]
  // The proxy arrives through the spawn environment; cookies are skipped -
  // extracting them per search would slow every roundtrip for no benefit.
  // The target is always prefixed today; `--` keeps it that way whatever changes.
  args.push('--playlist-end', String(Math.max(1, Math.min(30, limit))), '--', target)

  return new Promise((resolve) => {
    const child = spawn(ytdlpBinaryPath(), args, ytdlpSpawnOptions())
    let stdout = ''
    let stderr = ''
    let settled = false
    const done = (value: SearchResponse): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(value)
    }
    const timeout = setTimeout(() => {
      killTree(child)
      done({
        ok: false,
        error: 'Search timed out. Check your connection and try again.',
        errorCode: 'timeout'
      })
    }, 45_000)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d: string) => (stdout += d))
    child.stderr.on('data', (d: string) => (stderr += d))
    child.on('error', (err) => done({ ok: false, error: err.message }))
    child.on('close', (code) => {
      if (code !== 0 || !stdout.trim()) {
        // `true` for cookies: a search is not the place to suggest configuring
        // them, and the hint would be wrong as often as not.
        const failure = classifyYtdlpError(stderr.trim() || 'Search failed.', true)
        done({ ok: false, error: failure.message, errorCode: failure.code })
        return
      }
      try {
        const raw = JSON.parse(stdout) as FlatPlaylist
        const results: SearchResult[] = (raw.entries || [])
          // A result is queued by its URL as-is, and the list is the site's data.
          .filter((e) => isAbsoluteUrl(e.webpage_url || e.url || '') && e.title)
          .map((e) => ({
            id: e.id || e.url || e.webpage_url || '',
            title: e.title || 'Untitled',
            url: e.webpage_url || e.url || '',
            thumbnail: thumbnailOf(e, service),
            duration: e.duration,
            uploader: e.uploader || e.channel,
            viewCount: e.view_count,
            service
          }))
        done({ ok: true, results })
      } catch {
        done({ ok: false, error: 'Could not parse search results.' })
      }
    })
  })
}

/** Search one service by title. */
async function searchOne(query: string, service: SearchService, limit: number): Promise<SearchResponse> {
  const cap = Math.max(1, Math.min(30, limit))
  const api = API_SEARCH[service]
  if (api) {
    try {
      return await api(query, cap)
    } catch (err) {
      // An answer that is not the JSON asked for says nothing useful in its own words.
      if (err instanceof SyntaxError) return { ok: false, error: 'Could not parse search results.' }
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Search failed.',
        // A host that cannot be reached is said in the user's language.
        errorCode: unreachableCode(err)
      }
    }
  }
  const prefix = PREFIX[service]
  if (prefix) return ytdlpSearch(`${prefix}${cap}:${query}`, service, cap)
  const urlFor = URL_SEARCH[service]
  if (urlFor) return ytdlpSearch(urlFor(query), service, cap)
  return { ok: false, error: `Unsupported search service: ${service}` }
}

/** Round-robin merge so no single service dominates the top of the grid. */
function interleave(lists: SearchResult[][]): SearchResult[] {
  const out: SearchResult[] = []
  const seen = new Set<string>()
  const longest = Math.max(0, ...lists.map((l) => l.length))
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      const item = list[i]
      if (!item) continue
      if (seen.has(item.url)) continue
      seen.add(item.url)
      out.push(item)
    }
  }
  return out
}

/**
 * Search a single service — or every supported service in parallel when the
 * scope is 'all'. Partial failures are fine: as long as one service answers,
 * the user gets results.
 */
export async function searchVideos(
  query: string,
  scope: SearchScope = 'all',
  limit = 12
): Promise<SearchResponse> {
  const q = query.trim()
  if (!q) return { ok: false, error: 'Empty search query.' }
  /*
    Hiding the pill is the window's half of the setting; this is the half that
    holds. The separate search window reads the settings once when it opens,
    so it can still offer a service that was switched off since.
  */
  const showAdult = getSettings().showAdultServices
  if (scope !== 'all' && !showAdult && ADULT_SEARCH_SERVICES.includes(scope)) {
    return {
      ok: false,
      error: 'Adult sites are turned off for search. Turn them on in Settings → Detection.',
      errorCode: 'adultHidden'
    }
  }
  const engineFailure = await engineUnavailable()
  if (engineFailure) return engineFailure

  if (scope !== 'all') return searchOne(q, scope, limit)

  // In 'all' mode the limit applies per service, so the grid stays balanced.
  const perService = Math.max(3, Math.min(12, limit))
  const services = allowedSearchServices(SEARCH_ALL_SERVICES, showAdult)
  const settled = await Promise.all(services.map((s) => searchOne(q, s, perService)))
  const successes = settled.filter((r) => r.ok && r.results?.length).map((r) => r.results!)
  if (!successes.length) {
    const firstFailure = settled.find((r) => !r.ok)
    return {
      ok: false,
      error: firstFailure?.error || 'No results on any service.',
      errorCode: firstFailure?.errorCode
    }
  }
  return { ok: true, results: interleave(successes) }
}
