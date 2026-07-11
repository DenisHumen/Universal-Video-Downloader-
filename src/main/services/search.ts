import { spawn } from 'child_process'
import { ytdlpBinaryPath, ytdlpSpawnOptions, ensureYtdlp } from './ytdlp'
import { getSettings } from './settings'
import { humanizeYtdlpError } from './options'
import { SEARCH_SERVICES } from '@shared/types'
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

const PREFIX: Record<SearchService, string> = {
  youtube: 'ytsearch',
  soundcloud: 'scsearch',
  bilibili: 'bilisearch',
  niconico: 'nicosearch'
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

/** Search one service with the engine's flat search extractor. */
function searchOne(query: string, service: SearchService, limit: number): Promise<SearchResponse> {
  const settings = getSettings()
  const args = ['-J', '--flat-playlist', '--no-warnings', '--no-progress', '--ignore-config']
  // Proxy matters for reachability; skip cookies here — extracting them per
  // search would slow every roundtrip for no benefit.
  if (settings.proxy) args.push('--proxy', settings.proxy)
  args.push(`${PREFIX[service]}${Math.max(1, Math.min(30, limit))}:${query}`)

  return new Promise((resolve) => {
    const child = spawn(ytdlpBinaryPath(), args, ytdlpSpawnOptions())
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill()
      resolve({ ok: false, error: 'Search timed out. Check your connection and try again.' })
    }, 45_000)

    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', (err) => {
      clearTimeout(timeout)
      resolve({ ok: false, error: err.message })
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code !== 0 || !stdout.trim()) {
        resolve({ ok: false, error: humanizeYtdlpError(stderr.trim() || 'Search failed.', true) })
        return
      }
      try {
        const raw = JSON.parse(stdout) as FlatPlaylist
        const results: SearchResult[] = (raw.entries || [])
          .filter((e) => e.url || e.webpage_url)
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
        resolve({ ok: true, results })
      } catch {
        resolve({ ok: false, error: 'Could not parse search results.' })
      }
    })
  })
}

/** Round-robin merge so no single service dominates the top of the grid. */
function interleave(lists: SearchResult[][]): SearchResult[] {
  const out: SearchResult[] = []
  const longest = Math.max(0, ...lists.map((l) => l.length))
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      if (i < list.length) out.push(list[i])
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
  await ensureYtdlp()

  if (scope !== 'all') {
    return searchOne(q, scope, limit)
  }

  // In 'all' mode the limit applies per service, so the grid stays balanced.
  const perService = Math.max(3, Math.min(12, limit))
  const settled = await Promise.all(SEARCH_SERVICES.map((s) => searchOne(q, s, perService)))
  const successes = settled.filter((r) => r.ok && r.results?.length).map((r) => r.results!)
  if (!successes.length) {
    const firstError = settled.find((r) => !r.ok)?.error
    return { ok: false, error: firstError || 'No results on any service.' }
  }
  return { ok: true, results: interleave(successes) }
}
