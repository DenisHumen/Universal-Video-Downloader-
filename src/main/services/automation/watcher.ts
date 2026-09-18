import { powerMonitor } from 'electron'
import { log } from '../log'
import { checkWatch } from './detect'
import { markHandled, runEpisode } from './pipeline'
import { getWatch, listWatches, updateWatch } from './store'
import { upcomingDelayMinutes, type Watch } from '@shared/automation'

/**
 * Deciding when to look, and looking.
 *
 * The clock is the wall clock, not an elapsed timer. A `setInterval` of six
 * hours does not survive a laptop sleeping for four of them — it simply fires
 * late, or not at all — so each watch stores the moment it is next due and a
 * short tick compares that against the time of day. The same shape
 * `refreshEngineIfDue` already uses for the engine update, for the same reason.
 */

/** How often to look at the list. Not how often a watch is checked. */
const TICK_MS = 60_000

/** Checks running at once, so fifty watches do not arrive at a site together. */
const CONCURRENCY = 2

/** Nothing may ask a site more often than this, whatever the watch says. */
const MIN_INTERVAL_MINUTES = 15

/** How much a failing watch backs off, and how far it is allowed to go. */
const BACKOFF = [1, 2, 4, 8, 12]

/**
 * A watch may enqueue at most this many episodes from one check.
 *
 * A detection bug spends bandwidth and disk while nobody is watching, and the
 * shape it would take is "the site renumbered and now everything looks new".
 * A first check of a finished series legitimately finds a whole season, so this
 * is not a small number — but it is a number.
 */
const MAX_PER_CHECK = 25

let timer: NodeJS.Timeout | null = null
let running = 0
const inFlight = new Set<string>()

function jitter(): number {
  // Up to two minutes, so watches added together do not stay in lockstep.
  return Math.floor(Math.random() * 120_000)
}

/** When this watch should next be looked at. */
export function nextDue(watch: Watch, at = Date.now()): number {
  const minutes = Math.max(MIN_INTERVAL_MINUTES, watch.intervalMinutes)
  const factor = BACKOFF[Math.min(watch.failures, BACKOFF.length - 1)] ?? 1
  return at + minutes * factor * 60_000 + jitter()
}

async function checkOne(watch: Watch): Promise<void> {
  inFlight.add(watch.id)
  running++
  try {
    const result = await checkWatch(watch)

    if (result.notOut) {
      const releaseAt = result.notOut.releaseAt
      const wait = upcomingDelayMinutes(releaseAt, watch.intervalMinutes, Date.now())
      updateWatch(watch.id, {
        title: result.title || watch.title,
        thumbnail: result.thumbnail ?? watch.thumbnail,
        releaseAt,
        lastCheckedAt: Date.now(),
        lastError: undefined,
        failures: 0,
        nextCheckAt: Date.now() + wait * 60_000 + jitter()
      })
      return
    }

    // Out at last: from here on this is an ordinary watch on the dub it adopted.
    if (result.adopt) {
      updateWatch(watch.id, {
        translatorId: result.adopt.translatorId,
        translatorName: result.adopt.translatorName,
        pending: false,
        releaseAt: undefined
      })
    }

    // The site is the authority on the title and poster; a series gets renamed.
    updateWatch(watch.id, {
      title: result.title || watch.title,
      thumbnail: result.thumbnail ?? watch.thumbnail,
      translatorName: result.translatorName ?? watch.translatorName,
      lastCheckedAt: Date.now(),
      lastError: undefined,
      failures: 0,
      nextCheckAt: nextDue({ ...watch, failures: 0 })
    })

    if (!result.fresh.length) return

    const todo = result.fresh.slice(0, MAX_PER_CHECK)
    if (todo.length < result.fresh.length) {
      log.warn(
        'watcher',
        `Found ${result.fresh.length} new episodes at once, which is more than expected; ` +
          `taking ${todo.length} this time`,
        { id: watch.id.slice(0, 8), series: result.title }
      )
    }

    for (const ref of todo) {
      // Re-read: the user may have disabled or deleted the watch mid-run.
      const live = getWatch(watch.id)
      if (!live || !live.enabled) break
      await runEpisode(live, ref, result.title)
      markHandled(getWatch(watch.id) ?? live, ref)
    }
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err)
    const failures = watch.failures + 1
    updateWatch(watch.id, {
      lastCheckedAt: Date.now(),
      lastError: why,
      failures,
      nextCheckAt: nextDue({ ...watch, failures })
    })
    log.warn('watcher', `Check failed: ${why}`, {
      id: watch.id.slice(0, 8),
      series: watch.title,
      attempt: failures
    })
  } finally {
    running--
    inFlight.delete(watch.id)
  }
}

/** Look at the list and start whatever is due. */
export function tick(): void {
  const now = Date.now()
  const due = listWatches()
    .filter((w) => w.enabled && !inFlight.has(w.id) && (w.nextCheckAt || 0) <= now)
    .sort((a, b) => (a.nextCheckAt || 0) - (b.nextCheckAt || 0))

  for (const watch of due) {
    if (running >= CONCURRENCY) break
    void checkOne(watch)
  }
}

/** Check one watch now, whatever its schedule says. For the "check now" button. */
export async function checkNow(watchId: string): Promise<void> {
  const watch = getWatch(watchId)
  if (!watch || inFlight.has(watchId)) return
  await checkOne(watch)
}

export function startWatcher(): void {
  if (timer) return
  timer = setInterval(tick, TICK_MS)

  /*
    Waking up should look immediately rather than waiting out the rest of a
    tick. A machine that has been asleep is exactly the machine whose watches
    are all overdue.
  */
  powerMonitor.on('resume', () => {
    log.info('watcher', 'Woke up; checking what is overdue')
    tick()
  })

  // Nothing is due in the first moments of a launch that is not already late.
  setTimeout(tick, 5_000)
  log.info('watcher', `Watching ${listWatches().filter((w) => w.enabled).length} series`)
}

export function stopWatcher(): void {
  if (timer) clearInterval(timer)
  timer = null
}

/** True while anything is being checked or downloaded on a schedule. */
export function watcherBusy(): boolean {
  return running > 0
}
