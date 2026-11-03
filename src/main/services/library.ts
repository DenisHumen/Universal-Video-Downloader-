import { app, shell } from 'electron'
import { access } from 'fs/promises'
import { join } from 'path'
import {
  EMPTY_LIBRARY,
  entryFromItem,
  isLibraryFile,
  listLibrary,
  normaliseLibrary,
  removeEntry,
  seedFromHistory,
  upsertEntry,
  type LibraryFile,
  type LibraryPage,
  type LibraryQuery
} from '@shared/library'
import type { DownloadItem } from '@shared/types'
import { ReadFailure, failure, noteRefusedWrite, readJsonStore, writeJsonAtomic } from './json-store'
import { log } from './log'

/*
  The Library store (plan 5.3, [v2] SE-4). Main is its only writer:
  userData/library.json, written atomically (tmp + rename, json-store),
  debounced, and flushed on the way out. The downloader does not import this
  module - and neither do clearFinished or finishedBeyond, so clearing
  Activity can never touch the Library (library.test.ts checks the imports);
  index.ts wires a finished download to `recordFinished` through the
  downloader's events.

  First run of 4.0: no library.json yet, so it is seeded from history.json's
  finished rows. history.json is only ever read here, never written ([v3]
  SE-b), so going back to 3.x still finds the queue it had.
*/

const FILE = (): string => join(app.getPath('userData'), 'library.json')
const HISTORY = (): string => join(app.getPath('userData'), 'history.json')

let lib: LibraryFile = EMPTY_LIBRARY
const unread = new ReadFailure()
let timer: NodeJS.Timeout | null = null
const listeners = new Set<() => void>()

/** Read library.json, or seed it from history.json when there is none. */
export function loadLibrary(): void {
  try {
    const read = readJsonStore(FILE(), 'library', isLibraryFile)
    if (read.status === 'unreadable') {
      unread.set()
      return
    }
    unread.clear()
    if (read.status === 'ok') {
      lib = normaliseLibrary(read.data as LibraryFile)
      return
    }
    if (read.status === 'missing') {
      const history = readJsonStore(HISTORY(), 'library', Array.isArray)
      lib = history.status === 'ok' ? seedFromHistory(history.data as unknown[]) : EMPTY_LIBRARY
      log.info('library', 'Seeded the library from history', { entries: lib.entries.length })
      flushLibrary()
      return
    }
    lib = EMPTY_LIBRARY
  } catch (err) {
    log.error('library', 'Load failed', failure(err))
  }
}

function changed(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(flushLibrary, 400)
  for (const cb of listeners) cb()
}

export function flushLibrary(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (unread.active) {
    noteRefusedWrite(FILE(), 'library')
    return
  }
  try {
    writeJsonAtomic(FILE(), lib)
  } catch (err) {
    log.error('library', 'Save failed', failure(err))
  }
}

/** A download finished: upsert its file (by path). Anything that made no file is ignored. */
export function recordFinished(item: DownloadItem): void {
  const entry = entryFromItem(item)
  if (!entry) return
  const next = upsertEntry(lib, entry)
  if (next === lib) return
  lib = next
  changed()
}

export function queryLibrary(q: LibraryQuery): LibraryPage {
  return listLibrary(lib, q)
}

/** Which of these files are gone from disk. Asked in batches when the view opens; never stored. */
export async function missingFiles(paths: string[]): Promise<string[]> {
  const gone: string[] = []
  await Promise.all(
    paths.slice(0, 200).map(async (p) => {
      try {
        await access(p)
      } catch {
        gone.push(p)
      }
    })
  )
  return gone
}

/** "Delete file" ([v2] SE-2): to the system trash, never unlinked; then out of the library. */
export async function trashEntry(id: string): Promise<boolean> {
  const entry = lib.entries.find((e) => e.id === id)
  if (!entry) return false
  try {
    await shell.trashItem(entry.filepath)
  } catch (err) {
    log.warn('library', 'Could not move a file to the trash', failure(err))
    return false
  }
  lib = removeEntry(lib, id)
  changed()
  return true
}

/** Forget an entry whose file is gone (the file is not touched). */
export function forgetEntry(id: string): void {
  const next = removeEntry(lib, id)
  if (next.entries.length === lib.entries.length) return
  lib = next
  changed()
}

export function onLibraryChanged(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Tests only. */
export function __resetLibrary(): void {
  lib = EMPTY_LIBRARY
  unread.clear()
}
