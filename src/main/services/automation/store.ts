import { app } from 'electron'
import { EventEmitter } from 'events'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { log } from '../log'
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
 * reasons: written through a temp file and a rename so a crash mid-write cannot
 * leave an unreadable file, debounced so editing a field does not rewrite the
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

const empty = (): StoredWatches => ({ watches: [], runs: {} })

function read(): StoredWatches {
  if (state) return state
  try {
    const file = FILE()
    const loaded = existsSync(file)
      ? migrateWatches(JSON.parse(readFileSync(file, 'utf-8')))
      : empty()
    /*
      Here rather than when the watcher starts, so it happens whether or not
      automation is on, and before anything this launch adds a run of its own
      that could be mistaken for one the last launch left behind.
    */
    const { runs, ended } = endInterruptedRuns(loaded.runs)
    state = { ...loaded, runs }
    if (ended) {
      log.info('watcher', `Marked ${ended} run(s) the last session left unfinished as failed`)
      persist()
    }
  } catch (err) {
    log.error('watcher', 'Could not read the watch list; starting with an empty one', {
      why: err instanceof Error ? err.message : String(err)
    })
    state = empty()
  }
  return state
}

function writeNow(): void {
  if (!state) return
  try {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const target = FILE()
    const tmp = `${target}.tmp`
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8')
    renameSync(tmp, target)
  } catch (err) {
    log.error('watcher', 'Could not save the watch list', {
      why: err instanceof Error ? err.message : String(err)
    })
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
