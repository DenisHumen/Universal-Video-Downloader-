import { spawn } from 'child_process'
import { ytdlpBinaryPath, ytdlpSpawnOptions, ensureYtdlp } from './ytdlp'
import { getSettings } from './settings'
import { humanizeYtdlpError } from './options'
import type { SearchResponse, SearchResult, SearchService } from '@shared/types'

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
  soundcloud: 'scsearch'
}

function thumbnailOf(entry: FlatEntry, service: SearchService): string | undefined {
  if (entry.thumbnail) return entry.thumbnail
  if (entry.thumbnails?.length) return entry.thumbnails[entry.thumbnails.length - 1].url
  // YouTube flat entries sometimes come without thumbnails — derive one.
  if (service === 'youtube' && entry.id) return `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`
  return undefined
}

/**
 * Search a video service by title using the engine's search extractors
 * (flat mode: one fast request, no per-video probing).
 */
export async function searchVideos(
  query: string,
  service: SearchService = 'youtube',
  limit = 12
): Promise<SearchResponse> {
  const q = query.trim()
  if (!q) return { ok: false, error: 'Empty search query.' }
  await ensureYtdlp()

  const settings = getSettings()
  const args = ['-J', '--flat-playlist', '--no-warnings', '--no-progress', '--ignore-config']
  // Proxy matters for reachability; skip cookies here — extraction per search
  // would slow every keystroke-to-results roundtrip for no benefit.
  if (settings.proxy) args.push('--proxy', settings.proxy)
  args.push(`${PREFIX[service]}${Math.max(1, Math.min(30, limit))}:${q}`)

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
