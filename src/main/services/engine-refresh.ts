/**
 * When the download engine is next refreshed, and what counts as having done it.
 *
 * Apart from `ytdlp.ts`, which owns the file, the process and the download and
 * needs Electron for all three, so the part that decides whether a refresh
 * happened at all can be tested on its own. That part is where the old code
 * went wrong: it wrote "refreshed" to disk whatever `yt-dlp -U` answered, so a
 * rate-limited or offline attempt counted as a good one for the next 24 hours.
 */

/** How long a good refresh lasts. Sites change their players often, not hourly. */
export const REFRESH_INTERVAL = 24 * 60 * 60 * 1000

/**
 * How often the scheduler asks whether a refresh is due.
 *
 * Cheap, because the answer is a timestamp read from disk. It used to be asked
 * once, thirty seconds after launch, and downloads resumed at launch are
 * usually still running then - so the one attempt of the session was skipped
 * as busy, and an app that lives in the tray for days ran a stale engine for
 * all of them.
 */
export const REFRESH_TICK = 60 * 60 * 1000

/** The first look after launch, once the window and any resumed downloads are up. */
export const REFRESH_LAUNCH_DELAY = 30_000

/**
 * The first look after the machine wakes up. Not at once: Wi-Fi takes a while
 * to come back, and an attempt made before it does can only fail.
 */
export const REFRESH_RESUME_DELAY = 60_000

const HOUR = 60 * 60 * 1000

/** What engine.json remembers between launches. */
export interface RefreshState {
  /** The last time the engine was really brought up to date, or 0. */
  lastRefresh: number
  /** The last attempt that failed since then, or 0. */
  lastFailure: number
  /** Failed attempts in a row since the last good one. */
  failures: number
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Read engine.json's contents, whatever shape they are in.
 *
 * Builds before this one wrote `{ lastRefresh }` alone, which reads here as a
 * record with no failures - exactly what it was.
 */
export function parseRefreshState(raw: unknown): RefreshState {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    lastRefresh: count(r.lastRefresh),
    lastFailure: count(r.lastFailure),
    failures: Math.floor(count(r.failures))
  }
}

/**
 * How long to leave the engine alone after `failures` failed attempts in a row.
 *
 * The hourly tick would otherwise retry a refresh that cannot succeed - GitHub
 * refusing this address, a proxy that blocks it - twenty-four times a day, and
 * each failed `-U` is followed by a thirty-megabyte download attempt. Two hours
 * after the first failure, then four, keeps a broken network quiet without
 * leaving a fixed one waiting long.
 */
export function retryDelay(failures: number): number {
  if (failures <= 0) return 0
  return failures === 1 ? 2 * HOUR : 4 * HOUR
}

/**
 * Whether `at` lies within `span` before `now`.
 *
 * A timestamp in the future means the clock was moved back since it was
 * written. Treating it as recent would hold the refresh off until the clock
 * caught up again, possibly for months, so it counts as long ago instead.
 */
function within(now: number, at: number, span: number): boolean {
  const since = now - at
  return since >= 0 && since < span
}

/** Whether a refresh is due at `now`. */
export function refreshDue(state: RefreshState, now: number): boolean {
  if (state.lastRefresh && within(now, state.lastRefresh, REFRESH_INTERVAL)) return false
  if (state.failures > 0 && within(now, state.lastFailure, retryDelay(state.failures))) return false
  return true
}

/** The record after a refresh that really happened. */
export function afterSuccess(now: number): RefreshState {
  return { lastRefresh: now, lastFailure: 0, failures: 0 }
}

/**
 * The record after a refresh that failed.
 *
 * Offline, nothing is counted: the attempt says nothing about whether the next
 * one can work, and the tick will not even try one until a network is back.
 * The last good refresh is never touched, so a failure can only make the next
 * attempt come sooner than a success would have, never later.
 */
export function afterFailure(state: RefreshState, now: number, online: boolean): RefreshState {
  if (!online) return state
  return { ...state, lastFailure: now, failures: state.failures + 1 }
}

export interface RefreshSteps {
  /** `yt-dlp -U`; resolves to its exit code and never rejects. */
  selfUpdate: () => Promise<number>
  /** A fresh copy of the binary over the old one; rejects when that cannot be done. */
  download: () => Promise<void>
  /** True while a download is running from the binary. */
  isBusy: () => boolean
}

export type RefreshOutcome =
  | { kind: 'done'; via: 'self-update' | 'fresh download' }
  /**
   * A download was using the engine, so nothing was replaced. `code` is the
   * exit code of a `-U` that failed before the download started, and absent
   * when one was already running and `-U` never ran.
   */
  | { kind: 'busy'; code?: number }
  | { kind: 'failed'; code: number; error: string }

/**
 * One refresh: the self-update, and a fresh download only when that fails.
 *
 * Done means done. Exit code 0 from `-U` covers both "updated" and "already
 * current"; anything else - no network, GitHub's rate limit, a build that
 * cannot update itself - is a failure until the fallback has actually put a
 * new binary in place.
 *
 * `isBusy` is asked again before the fallback, because `-U` takes a few
 * seconds and a download may have started in them. Replacing the file then is
 * the very thing the busy check exists to prevent: on Windows the rename fails
 * outright while the executable is loaded.
 *
 * It is asked first as well. `-U` replaces the same file, and both callers had
 * to remember to ask just before calling this; the button in Settings asked
 * once and then waited minutes for the scheduled refresh, long enough for a
 * download to start. Here no caller can forget.
 */
export async function runRefresh(steps: RefreshSteps): Promise<RefreshOutcome> {
  if (steps.isBusy()) return { kind: 'busy' }
  const code = await steps.selfUpdate()
  if (code === 0) return { kind: 'done', via: 'self-update' }
  if (steps.isBusy()) return { kind: 'busy', code }
  try {
    await steps.download()
    return { kind: 'done', via: 'fresh download' }
  } catch (err) {
    return { kind: 'failed', code, error: err instanceof Error ? err.message : String(err) }
  }
}
