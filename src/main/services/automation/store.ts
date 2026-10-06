import { app } from 'electron'
import { EventEmitter } from 'events'
import { join } from 'path'
import { log } from '../log'
import {
  failure,
  isRecord,
  noteRefusedWrite,
  ReadFailure,
  readJsonStore,
  writeJsonAtomic
} from '../json-store'
import {
  endInterruptedRuns,
  episodeKey,
  MAX_RUNS,
  migrateWatches,
  type EpisodeRef,
  type Run,
  type StoredWatches,
  type Watch
} from '@shared/automation'

/**
 * The watches, and what has happened to them.
 *
 * Same discipline as `settings.ts` and the download history, for the same
 * reasons: written through json-store so a crash mid-write cannot leave an
 * unreadable file and a damaged one is recovered from its backup rather than
 * replaced with nothing, debounced so editing a field does not rewrite the
 * disk on every keystroke, and read through a migration that tolerates a file
 * from an older build.
 *
 * The migration matters more here than elsewhere. A watch is something the user
 * built by hand — a series, a dub, a naming template, a remote path — and
 * losing the list because one entry gained a field would be a genuinely bad
 * afternoon. Anything unrecognisable is dropped on its own; the rest survives.
 */

const FILE = (): string => join(app.getPath('userData'), 'watches.json')

/**
 * Says `changed` after every write that actually changed something.
 *
 * Most writes come from the schedule, not from a button: a check recording its
 * outcome, a run moving from one step to the next. The screen used to hear only
 * about the button presses, so a check that failed at four in the morning drew
 * no mark on the tab, and a run stayed "running" on screen long after it had
 * finished, until somebody happened to click something.
 */
export const watchEvents = new EventEmitter()

const changed = (): void => {
  watchEvents.emit('changed')
}

let state: StoredWatches | null = null

/**
 * watches.json is there but could not be read. The list then starts empty in
 * memory, nothing is saved over the file, and whatever this session adds is
 * folded into it once a read succeeds. See json-store.ts.
 */
const unread = new ReadFailure()

const empty = (): StoredWatches => ({ watches: [], runs: {} })

/**
 * What the file holds, with what this session added while it could not be read.
 *
 * Only additions are possible: the watches in the file were never loaded, so
 * nothing could have changed them. A run is kept once, by id, and the history
 * stays within the usual length.
 */
export function mergeWatches(stored: StoredWatches, interim: StoredWatches): StoredWatches {
  const known = new Set(stored.watches.map((w) => w.id))
  const runs = { ...stored.runs }
  for (const [watchId, list] of Object.entries(interim.runs)) {
    const have = runs[watchId] ?? []
    const ids = new Set(have.map((r) => r.id))
    runs[watchId] = [...have, ...list.filter((r) => !ids.has(r.id))].slice(-MAX_RUNS)
  }
  return {
    watches: [...stored.watches, ...interim.watches.filter((w) => !known.has(w.id))],
    runs
  }
}

/**
 * Read watches.json into `state`.
 *
 * 'dirty' when what is now in memory ought to be saved; 'unreadable' when the
 * file is there but could not be read, and must not be written over.
 */
function load(): 'clean' | 'dirty' | 'unreadable' {
  try {
    const read = readJsonStore(FILE(), 'watcher', isRecord)
    if (read.status === 'unreadable') {
      unread.set()
      state = state ?? empty()
      return 'unreadable'
    }
    const interim = unread.active ? state : null
    unread.clear()
    const loaded = read.status === 'ok' ? migrateWatches(read.data) : empty()
    /*
      Here rather than when the watcher starts, so it happens whether or not
      automation is on, and before anything this launch adds a run of its own
      that could be mistaken for one the last launch left behind. On a late
      read, before this session's runs are folded in, for the same reason.
    */
    const { runs, ended } = endInterruptedRuns(loaded.runs)
    state = interim ? mergeWatches({ ...loaded, runs }, interim) : { ...loaded, runs }
    if (ended) log.info('watcher', `Marked ${ended} run(s) the last session left unfinished as failed`)
    if (interim) changed()
    const fresh = read.status !== 'ok' || read.recovered
    return ended || interim || fresh ? 'dirty' : 'clean'
  } catch (err) {
    /*
      Not a damaged file - json-store deals with those - but one this build
      could not make sense of. Starting empty and saving that would destroy the
      list, so it is treated like a file that could not be read.
    */
    if (!unread.active) {
      log.error('watcher', 'Could not read the watch list; not saving over it', failure(err))
    }
    unread.set()
    state = state ?? empty()
    return 'unreadable'
  }
}

function read(): StoredWatches {
  if ((!state || unread.due()) && load() === 'dirty') persist()
  return state!
}

function writeNow(): void {
  if (!state) return
  try {
    // One more look first: whatever kept the file from being read may be gone.
    if (unread.active && load() === 'unreadable') {
      noteRefusedWrite(FILE(), 'watcher')
      return
    }
    writeJsonAtomic(FILE(), state, { indent: 2 })
  } catch (err) {
    log.error('watcher', 'Could not save the watch list', failure(err))
  }
}

let timer: NodeJS.Timeout | null = null

function persist(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    writeNow()
  }, 400)
}

/** Write anything pending, now. Called on the way out. */
export function flushWatches(): void {
  if (!timer) return
  clearTimeout(timer)
  timer = null
  writeNow()
}

// ---------------------------------------------------------------------------

export function listWatches(): Watch[] {
  return [...read().watches].sort((a, b) => b.createdAt - a.createdAt)
}

export function getWatch(id: string): Watch | undefined {
  return read().watches.find((w) => w.id === id)
}

export function addWatch(watch: Watch): Watch {
  read().watches.push(watch)
  persist()
  changed()
  return watch
}

/** Apply a partial change. Returns the updated watch, or undefined if it is gone. */
export function updateWatch(id: string, patch: Partial<Watch>): Watch | undefined {
  const store = read()
  const index = store.watches.findIndex((w) => w.id === id)
  if (index < 0) return undefined
  const next = { ...store.watches[index], ...patch, id }
  store.watches[index] = next
  persist()
  changed()
  return next
}

export function removeWatch(id: string): void {
  const store = read()
  const before = store.watches.length
  store.watches = store.watches.filter((w) => w.id !== id)
  delete store.runs[id]
  persist()
  if (store.watches.length !== before) changed()
}

export function listRuns(watchId: string): Run[] {
  return [...(read().runs[watchId] ?? [])].sort((a, b) => b.startedAt - a.startedAt)
}

/**
 * Add a run to its watch's history, in place of `replaces` if that is given.
 *
 * A retry takes the place of the go it retries, so an episode reads as one row
 * that says how it stands rather than a stack of failures above a success.
 */
export function addRun(run: Run, replaces?: string): Run {
  const store = read()
  const list = (store.runs[run.watchId] ?? []).filter((r) => !replaces || r.id !== replaces)
  list.push(run)
  // Oldest first in storage, so trimming from the front drops the oldest.
  store.runs[run.watchId] = list.slice(-MAX_RUNS)
  persist()
  changed()
  return run
}

export function updateRun(runId: string, patch: Partial<Run>): Run | undefined {
  const store = read()
  for (const list of Object.values(store.runs)) {
    const index = list.findIndex((r) => r.id === runId)
    if (index < 0) continue
    const next = { ...list[index], ...patch, id: runId }
    list[index] = next
    persist()
    changed()
    return next
  }
  return undefined
}

/** A run by its id, whichever watch it belongs to. */
export function findRun(runId: string): Run | undefined {
  return Object.values(read().runs)
    .flat()
    .find((r) => r.id === runId)
}

/** The latest go at one episode of one watch. */
export function lastRunFor(watchId: string, ref: EpisodeRef): Run | undefined {
  const key = episodeKey(ref)
  return listRuns(watchId).find((r) => episodeKey(r) === key)
}
