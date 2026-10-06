import { net, powerMonitor } from 'electron'
import { log } from '../log'
import { backoffMinutes, settleFailedCheck } from './backoff'
import { checkWatch } from './detect'
import { alertChannel, recordOutcome, runEpisode } from './pipeline'
import { findRun, getWatch, listWatches, updateWatch } from './store'
import { composeCheckFailure, sendNotification } from './telegram'
import {
  attemptsAt,
  episodeKey,
  isFinalAttempt,
  MAX_ATTEMPTS,
  upcomingDelayMinutes,
  type CheckSummary,
  type EpisodeRef,
  type RetryAnswer,
  type Run,
  type Watch
} from '@shared/automation'

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

/**
 * Pages being read at once, so fifty watches do not arrive at a site together.
 *
 * Only the reading. The slot used to be held until every episode a check found
 * had been downloaded and uploaded, so two series working through a backlog -
 * or two automated downloads paused and forgotten - stopped every other series
 * being checked for hours, or until a restart. Downloads already have the
 * queue's own limit.
 */
const CONCURRENCY = 2

/*
  How long after waking, and after launch, before the first look. Wi-Fi takes a
  while to come back after sleep, and a check that runs before it does can only
  fail; the app may also be starting at login, alongside everything else that
  wants the network first.
*/
const RESUME_DELAY_MS = 45_000
const LAUNCH_DELAY_MS = 30_000

/**
 * A watch may enqueue at most this many episodes from one check.
 *
 * A detection bug spends bandwidth and disk while nobody is watching, and the
 * shape it would take is "the site renumbered and now everything looks new".
 * A first check of a finished series legitimately finds a whole season, so this
 * is not a small number — but it is a number.
 */
const MAX_PER_CHECK = 25

/**
 * Failed checks in a row before anybody is told.
 *
 * One is a site having a bad minute and two can be a short outage; three, with
 * the backoff in between, is hours of a page that cannot be read. Compared for
 * equality, not "at least": the count only climbs during a streak and a good
 * check resets it, so this is one message per streak rather than one per
 * backoff step for as long as the site stays broken.
 */
const REPORT_AFTER_FAILURES = 3

let timer: NodeJS.Timeout | null = null
let running = 0
/** Watches being checked, or still working through what their check found. */
const inFlight = new Set<string>()

function jitter(): number {
  // Up to two minutes, so watches added together do not stay in lockstep.
  return Math.floor(Math.random() * 120_000)
}

/** When this watch should next be looked at. */
export function nextDue(watch: Watch, at = Date.now()): number {
  return at + backoffMinutes(watch.intervalMinutes, watch.failures) * 60_000 + jitter()
}

/** What reading a page left to do. */
interface Found {
  summary: CheckSummary
  todo: EpisodeRef[]
  title: string
}

/**
 * Read one watch's page and record what it said.
 *
 * Every outcome, failure included, is written to the watch here, and nothing
 * is thrown: what is left for the caller is the episodes to fetch. `read` is
 * called the moment the site has answered, either way.
 */
async function look(watch: Watch, manual: boolean, read: () => void): Promise<Found> {
  const nothing = (summary: CheckSummary): Found => ({ summary, todo: [], title: watch.title })
  try {
    const result = await checkWatch(watch).finally(read)

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
      return nothing({ notOut: true, releaseAt })
    }

    /*
      Out at last: from here on this is an ordinary watch on the dub it
      adopted. Or the dub it followed moved to a new id; `fresh` is already
      worked out against the new one.
    */
    if (result.adopt) {
      if (!watch.pending) {
        log.info('watcher', 'The translation this watch follows moved; following it there', {
          id: watch.id.slice(0, 8),
          series: result.title,
          dub: result.adopt.translatorName
        })
      }
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

    const todo = result.fresh.slice(0, MAX_PER_CHECK)
    if (todo.length < result.fresh.length) {
      log.warn(
        'watcher',
        `Found ${result.fresh.length} new episodes at once, which is more than expected; ` +
          `taking ${todo.length} this time`,
        { id: watch.id.slice(0, 8), series: result.title }
      )
    }

    // Paused or deleted while the page was being read: found, but not fetched.
    const paused = !getWatch(watch.id)?.enabled
    return {
      summary: { fresh: result.fresh.length, queued: paused ? 0 : todo.length, paused },
      todo: paused ? [] : todo,
      title: result.title
    }
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err)
    const { kind, patch } = settleFailedCheck(watch, {
      why,
      online: net.isOnline(),
      manual,
      now: Date.now(),
      jitter: jitter()
    })
    updateWatch(watch.id, patch)
    const tags = { id: watch.id.slice(0, 8), series: watch.title }

    if (kind === 'offline') {
      log.info('watcher', `Check failed while offline; trying again shortly: ${why}`, tags)
      return nothing({ error: why })
    }
    if (kind === 'manual') {
      log.warn('watcher', `Check failed: ${why}`, { ...tags, by: 'check now' })
      return nothing({ error: why })
    }

    const failures = patch.failures ?? watch.failures
    log.warn('watcher', `Check failed: ${why}`, { ...tags, attempt: failures })

    /*
      A page that has stopped parsing used to fail silently for weeks: the only
      symptom of a check that finds nothing is the absence of news. After the
      bookkeeping, and with its own catch, so a Telegram that is down cannot
      undo the backoff. Re-read first, because a watch deleted or paused while
      it was being checked is nobody's news.
    */
    const current = getWatch(watch.id)
    if (failures === REPORT_AFTER_FAILURES && current?.enabled) {
      const channel = alertChannel(current)
      if (channel) {
        await sendNotification(
          channel.token,
          channel.chatId,
          composeCheckFailure(current.title, failures, why)
        ).catch(() => undefined)
      }
    }
    return nothing({ error: why })
  }
}

/**
 * Take what a check found through the chain, one episode after another.
 *
 * Not all at once: the re-read before each episode is how pausing or deleting
 * a watch stops a backlog part-way, and a first check that finds a whole
 * season should not land on the queue in one go.
 */
async function drain(watchId: string, todo: EpisodeRef[], title: string): Promise<void> {
  for (const ref of todo) {
    // Re-read: the user may have disabled or deleted the watch mid-run.
    const live = getWatch(watchId)
    if (!live || !live.enabled) break
    await attempt(live, ref, title)
  }
}

/**
 * One go at one episode, and what it leaves on the watch.
 *
 * A failure short of the cap leaves the episode unhandled, so the next check -
 * at the watch's own interval, never in a loop - finds it again and the
 * pipeline picks up where this go stopped.
 */
async function attempt(watch: Watch, ref: EpisodeRef, title: string, previous?: Run): Promise<void> {
  const tries = attemptsAt(watch, ref) + 1
  const final = isFinalAttempt(watch, ref)
  const outcome = await runEpisode(watch, ref, title, { final, attempt: tries, previous })
  recordOutcome(watch.id, ref, outcome)
  if (outcome === 'failed') {
    log.info(
      'watcher',
      final
        ? `Gave up on ${episodeKey(ref)} after ${tries} attempt(s)`
        : `Will try ${episodeKey(ref)} again at the next check (attempt ${tries} of ${MAX_ATTEMPTS})`,
      { id: watch.id.slice(0, 8), series: title }
    )
  }
}

/**
 * Check one watch, then work through whatever it found.
 *
 * Two answers. `checked` comes as soon as the page has been read and recorded,
 * and is what "check now" waits for. `done` comes once every episode found has
 * been through the chain and its outcome written down, and the watch stays in
 * flight until then: let it go any sooner and the next tick reads the page
 * again, finds the same episodes not yet marked, and queues them a second time.
 *
 * The concurrency slot is the other way round: held for the reading alone, and
 * given back exactly once whichever way that ends - a second release would let
 * a third check through for good.
 */
function checkOne(
  watch: Watch,
  manual = false
): { checked: Promise<CheckSummary>; done: Promise<void> } {
  let answer: (summary: CheckSummary) => void = () => undefined
  const checked = new Promise<CheckSummary>((resolve) => (answer = resolve))

  inFlight.add(watch.id)
  running++
  let slotHeld = true
  const releaseSlot = (): void => {
    if (!slotHeld) return
    slotHeld = false
    running--
    // Whoever was waiting for the slot can start now, not at the next tick a minute away.
    if (timer) setImmediate(tick)
  }

  const done = (async (): Promise<void> => {
    try {
      const found = await look(watch, manual, releaseSlot)
      answer(found.summary)
      await drain(watch.id, found.todo, found.title)
    } catch (err) {
      // The page was read, so this is not a failed check and the backoff is not touched.
      const why = err instanceof Error ? err.message : String(err)
      log.warn('watcher', `Stopped part-way through new episodes: ${why}`, {
        id: watch.id.slice(0, 8),
        series: watch.title
      })
    } finally {
      releaseSlot()
      inFlight.delete(watch.id)
      // Whatever happened above, "check now" must not be left waiting for ever.
      answer({ error: 'The check stopped without an answer.' })
    }
  })()

  return { checked, done }
}

/** Look at the list and start whatever is due. */
export function tick(): void {
  /*
    Offline, every check would fail and be rescheduled for nothing. A "no" from
    `isOnline` is reliable, so nothing starts; a "yes" only means an interface
    is up, which is why a failed check is still examined for an offline cause.
  */
  if (!net.isOnline()) return

  const now = Date.now()
  const due = listWatches()
    .filter((w) => w.enabled && !inFlight.has(w.id) && (w.nextCheckAt || 0) <= now)
    .sort((a, b) => (a.nextCheckAt || 0) - (b.nextCheckAt || 0))

  for (const watch of due) {
    if (running >= CONCURRENCY) break
    void checkOne(watch).done
  }
}

/**
 * Check one watch now, whatever its schedule says. For the "check now" button.
 *
 * Answers once the page has been read; anything it found goes on downloading
 * afterwards. A watch that is already in flight says so straight away - it
 * used to return at once without checking anything, and the screen said
 * "checked" all the same.
 */
export async function checkNow(watchId: string): Promise<CheckSummary> {
  const watch = getWatch(watchId)
  if (!watch) return { error: 'This series is no longer being watched.' }
  if (inFlight.has(watchId)) return { busy: true }
  return checkOne(watch, true).checked
}

/**
 * Have another go at an episode that failed or was skipped. For "try again".
 *
 * There was no way back for a failed episode short of downloading and uploading
 * it by hand - including after fixing the password that made it fail. This goes
 * through the same chain as the schedule, picking up where the run stopped, and
 * the new run takes that one's place in the history.
 *
 * The watch is held in flight for the length of it, as a check would hold it,
 * and a watch already in flight is refused: the schedule and the button must
 * not fetch the same episode side by side.
 *
 * So is a paused one. The download step treats a paused watch as one stopped
 * mid-run, so the retry queued the episode, cancelled it at once and put a
 * skipped run in place of the failed one - while the screen said it was trying.
 */
export function retryRun(runId: string): RetryAnswer {
  const run = findRun(runId)
  if (!run) return { error: 'That episode is no longer in the history.' }
  const watch = getWatch(run.watchId)
  if (!watch) return { error: 'This series is no longer being watched.' }
  if (run.state !== 'failed' && run.state !== 'skipped') {
    return { error: 'Only an episode that failed or was skipped can be tried again.' }
  }
  if (inFlight.has(watch.id)) return { busy: true }
  if (!watch.enabled) return { paused: true }

  inFlight.add(watch.id)
  const ref: EpisodeRef = { season: run.season, episode: run.episode }
  void attempt(watch, ref, watch.title || run.title, run)
    .catch((err) => {
      log.warn('watcher', `Trying ${episodeKey(ref)} again stopped part-way: ${String(err)}`, {
        id: watch.id.slice(0, 8)
      })
    })
    .finally(() => inFlight.delete(watch.id))
  return { started: true }
}

/** A delayed tick that finds the watcher stopped does nothing. */
function tickIfRunning(): void {
  if (timer) tick()
}

/*
  Waking up should look soon rather than waiting out the rest of a tick - a
  machine that has been asleep is exactly the machine whose watches are all
  overdue - but not at once. Checked straight away, every overdue watch failed
  before the network was back and was pushed out by a whole backoff step.
*/
function onResume(): void {
  log.info('watcher', 'Woke up; checking what is overdue once the network is back')
  setTimeout(tickIfRunning, RESUME_DELAY_MS)
}

export function startWatcher(): void {
  if (timer) return
  timer = setInterval(tick, TICK_MS)
  powerMonitor.on('resume', onResume)

  // Nothing is due in the first moments of a launch that is not already late.
  setTimeout(tickIfRunning, LAUNCH_DELAY_MS)
  log.info('watcher', `Watching ${listWatches().filter((w) => w.enabled).length} series`)
}

export function stopWatcher(): void {
  if (timer) clearInterval(timer)
  timer = null
  powerMonitor.off('resume', onResume)
}

/**
 * True while anything is being checked or downloaded on a schedule.
 *
 * Not a keep-awake signal, tempting as it looks: whatever asked would have to
 * ask again when a check ends, and nothing tells it to. An episode holds the
 * machine itself, from the end of its download until it is delivered.
 */
export function watcherBusy(): boolean {
  return inFlight.size > 0
}
