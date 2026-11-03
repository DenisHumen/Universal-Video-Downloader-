import type { DownloadItem } from './types'

/**
 * The Library (plan 5.3, [v2] SE-4): every finished file, kept in its own
 * store (userData/library.json) that "clear finished" in Activity never
 * touches. Pure, so the store's rules are tested without Electron; the
 * service in main (services/library.ts) is the only writer.
 */

export const LIBRARY_VERSION = 1

export interface LibraryEntry {
  id: string
  /** Unique: one entry per file on disk. */
  filepath: string
  /** Where an upload step put it (a share). */
  remotePath?: string
  url: string
  sourceUrl?: string
  title: string
  extractor?: string
  seriesId?: string
  /** Seconds. */
  duration?: number
  sizeBytes?: number
  /** The file's extension, lower case. */
  container?: string
  /** A poster for it: the download's thumbnail address. */
  thumb?: string
  finishedAt: number
}

export interface LibraryFile {
  version: number
  entries: LibraryEntry[]
}

export const EMPTY_LIBRARY: LibraryFile = { version: LIBRARY_VERSION, entries: [] }

const extOf = (path: string): string | undefined => /\.([a-z0-9]{1,5})$/i.exec(path)?.[1]?.toLowerCase()

/** A finished queue row as a library entry, or null when it produced no file (a failure, a cancel, an upload-only job). */
export function entryFromItem(item: DownloadItem): LibraryEntry | null {
  if (item.state !== 'completed' || !item.filepath) return null
  return {
    id: item.id,
    filepath: item.filepath,
    remotePath: item.remotePath,
    url: item.url,
    sourceUrl: item.sourceUrl,
    title: item.title,
    extractor: item.extractor,
    duration: item.duration,
    sizeBytes: item.totalBytes,
    container: extOf(item.filepath),
    thumb: item.thumbnail,
    finishedAt: item.finishedAt ?? item.createdAt
  }
}

/** Whether parsed JSON can be read as a library at all. */
export function isLibraryFile(raw: unknown): raw is LibraryFile {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    typeof (raw as LibraryFile).version === 'number' &&
    Array.isArray((raw as LibraryFile).entries)
  )
}

function isEntry(raw: unknown): raw is LibraryEntry {
  const e = raw as LibraryEntry
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof e.id === 'string' &&
    typeof e.filepath === 'string' &&
    e.filepath.length > 0 &&
    typeof e.title === 'string' &&
    typeof e.url === 'string' &&
    typeof e.finishedAt === 'number'
  )
}

/** A file read back: bad entries dropped, duplicates by file path collapsed (the newest wins), newest first. */
export function normaliseLibrary(raw: LibraryFile): LibraryFile {
  const byPath = new Map<string, LibraryEntry>()
  for (const e of raw.entries) {
    if (!isEntry(e)) continue
    const had = byPath.get(e.filepath)
    if (!had || had.finishedAt <= e.finishedAt) byPath.set(e.filepath, e)
  }
  return { version: LIBRARY_VERSION, entries: sortNewest([...byPath.values()]) }
}

const sortNewest = (entries: LibraryEntry[]): LibraryEntry[] => entries.sort((a, b) => b.finishedAt - a.finishedAt)

/** Add or replace an entry (by file path). Returns the same object when nothing changed. */
export function upsertEntry(lib: LibraryFile, entry: LibraryEntry): LibraryFile {
  const at = lib.entries.findIndex((e) => e.filepath === entry.filepath)
  if (at >= 0 && JSON.stringify(lib.entries[at]) === JSON.stringify(entry)) return lib
  const entries = at >= 0 ? lib.entries.map((e, i) => (i === at ? entry : e)) : [entry, ...lib.entries]
  return { version: LIBRARY_VERSION, entries: sortNewest(entries) }
}

export function removeEntry(lib: LibraryFile, id: string): LibraryFile {
  return { version: LIBRARY_VERSION, entries: lib.entries.filter((e) => e.id !== id) }
}

/**
 * The first library, seeded from history.json's finished rows (SE-4). Pure and
 * idempotent: the same history gives the same library, deduped by file path.
 * History itself is never written ([v3] SE-b), so a downgrade to 3.x still
 * finds it as it was.
 */
export function seedFromHistory(history: unknown[]): LibraryFile {
  const entries: LibraryEntry[] = []
  for (const raw of history) {
    const entry = entryFromItem(raw as DownloadItem)
    if (entry) entries.push(entry)
  }
  return normaliseLibrary({ version: LIBRARY_VERSION, entries })
}

export type LibraryGroup = 'date' | 'site' | 'series'

export interface LibraryQuery {
  query?: string
  group?: LibraryGroup
  offset?: number
  limit?: number
}

export interface LibraryPage {
  entries: LibraryEntry[]
  total: number
}

/** A page of the library, newest first, filtered by title words. Grouping is the view's (it only orders). */
export function listLibrary(lib: LibraryFile, q: LibraryQuery = {}): LibraryPage {
  const words = (q.query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  let list = lib.entries.filter((e) => words.every((w) => e.title.toLowerCase().includes(w)))
  if (q.group === 'site') list = [...list].sort((a, b) => (a.extractor ?? '').localeCompare(b.extractor ?? '') || b.finishedAt - a.finishedAt)
  if (q.group === 'series') list = [...list].sort((a, b) => (a.seriesId ?? '').localeCompare(b.seriesId ?? '') || b.finishedAt - a.finishedAt)
  const offset = Math.max(0, q.offset ?? 0)
  const limit = Math.min(500, Math.max(1, q.limit ?? 100))
  return { entries: list.slice(offset, offset + limit), total: list.length }
}
