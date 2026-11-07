import { app, shell } from 'electron'
import { readFileSync } from 'fs'
import { access } from 'fs/promises'
import { join } from 'path'
import {
  EMPTY_LIBRARY,
  entryFromItem,
  isLibraryFile,
  isNewerLibrary,
  listLibrary,
  normaliseLibrary,
  noteRemote,
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

type HistoryRead = { status: 'ok'; data: unknown[] } | { status: 'missing' } | { status: 'bad' }

/**
 * history.json, strictly read-only: no restore from `.bak`, no set-aside, and
 * none of json-store's per-file state touched (that belongs to history.ts,
 * the file's owner). A damaged file falls back to a read-only parse of the
 * backup; failing that it is "bad", and the library does not seed from it.
 */
export function readHistoryReadOnly(file: string): HistoryRead {
  let sawFile = false
  for (const path of [file, `${file}.bak`]) {
    let text: string
    try {
      text = readFileSync(path, 'utf-8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') continue
      sawFile = true
      continue
    }
    sawFile = true
    try {
      const data: unknown = JSON.parse(text)
      if (Array.isArray(data)) return { status: 'ok', data }
    } catch {
      /* try the backup */
    }
  }
  return sawFile ? { status: 'bad' } : { status: 'missing' }
}

/*
  Seeding could not read history.json: the library lives in memory for this
  session and library.json is not written, so the next launch seeds again
  instead of finding an empty library and never looking at history.
*/
let seedPending = false

/** Read library.json, or seed it from history.json when there is none. */
export function loadLibrary(): void {
  try {
    seedPending = false
    const read = readJsonStore(FILE(), 'library', isLibraryFile)
    if (read.status === 'unreadable') {
      unread.set()
      return
    }
    unread.clear()
    if (read.status === 'ok') {
      lib = normaliseLibrary(read.data as LibraryFile)
      /*
        Written by a newer version: shown, but never written back. Saving it
        would downgrade it to this version's shape and lose what it added.
      */
      if (isNewerLibrary(read.data)) {
        unread.set()
        log.warn('library', 'library.json is from a newer version; reading it, not saving over it')
      }
      return
    }
    if (read.status === 'missing') {
      const history = readHistoryReadOnly(HISTORY())
      if (history.status === 'bad') {
        lib = EMPTY_LIBRARY
        seedPending = true
        log.warn('library', 'history.json could not be read; the library is not saved until it can be seeded')
        return
      }
      lib = history.status === 'ok' ? seedFromHistory(history.data) : EMPTY_LIBRARY
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
  if (seedPending) return
  try {
    writeJsonAtomic(FILE(), lib)
  } catch (err) {
    log.error('library', 'Save failed', failure(err))
  }
}

/** A download finished: upsert its file (by path). Anything that made no file is ignored. */
export function recordFinished(item: DownloadItem): void {
  const entry = entryFromItem(item)
  if (!entry) {
    // Uploaded and deleted here: no file left, but the entry should say where it went.
    if (item.state === 'completed' && item.remotePath) {
      const next = noteRemote(lib, item.id, item.remotePath)
      if (next !== lib) {
        lib = next
        changed()
      }
    }
    return
  }
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
  // Only paths the library holds: the renderer cannot probe arbitrary files through this.
  const known = new Set(lib.entries.map((e) => e.filepath))
  await Promise.all(
    paths.filter((p) => known.has(p)).slice(0, 200).map(async (p) => {
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
  seedPending = false
}
