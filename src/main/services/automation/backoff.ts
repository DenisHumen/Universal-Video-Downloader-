import { upcomingDelayMinutes, type Watch } from '@shared/automation'

/**
 * How a watch's schedule answers a check that failed, or a change of pace.
 *
 * Apart from the watcher, which needs Electron to run, so the arithmetic that
 * decides how long a series goes unchecked can be tested on its own.
 */

/** Nothing may ask a site more often than this, whatever the watch says. */
export const MIN_INTERVAL_MINUTES = 15

/** How much a failing watch backs off, in multiples of its own interval. */
const BACKOFF = [1, 2, 4, 8, 12]

/** Never back off past a day, unless the watch's own pace is slower than that. */
const CAP_MINUTES = 24 * 60

/** How soon to try again after a check that failed because this machine was offline. */
export const OFFLINE_RETRY_MINUTES = 15

/**
 * Minutes until the next look, given the failures in a row so far.
 *
 * Backing off is right: a site that is down gains nothing from being asked
 * every fifteen minutes. Backing off without a ceiling was not - twelve times a
 * daily interval left a series unchecked for twelve days after a few short
 * outages, well past the episode anybody was waiting for.
 */
export function backoffMinutes(intervalMinutes: number, failures: number): number {
  const minutes = Math.max(MIN_INTERVAL_MINUTES, intervalMinutes)
  const factor = BACKOFF[Math.min(Math.max(0, failures), BACKOFF.length - 1)] ?? 1
  return Math.min(minutes * factor, Math.max(minutes, CAP_MINUTES))
}

/**
 * When a watch whose interval has just been changed should next be looked at,
 * if that is sooner than it is due now.
 *
 * The schedule only took a new interval up after the next check, so tightening
 * a daily watch to a quarter of an hour still left it waiting most of a day,
 * with the old time on screen. Only ever closer: a looser interval applies from
 * the next check, as it always has, and a watch already due stays due. One that
 * is failing keeps its backoff, and one waiting for a release its waiting pace.
 */
export function rescheduledCheck(
  watch: Watch,
  intervalMinutes: number,
  now: number
): number | undefined {
  const minutes = watch.pending
    ? upcomingDelayMinutes(watch.releaseAt, intervalMinutes, now)
    : backoffMinutes(intervalMinutes, watch.failures)
  const sooner = now + minutes * 60_000
  return watch.nextCheckAt > sooner ? sooner : undefined
}

/*
  The codes that mean this machine has no network at all, as opposed to a site,
  a mirror or a proxy that will not answer. Refused connections, timeouts,
  certificates and proxies are deliberately absent: those are failures on the
  far side, where backing off is exactly right. A name that does not resolve is
  absent too - a dead mirror domain says the same thing - and only counts as
  offline when the machine itself says it is.
*/
const OFFLINE = /ERR_(INTERNET_DISCONNECTED|NETWORK_CHANGED|ADDRESS_UNREACHABLE)\b/

/**
 * Did this check fail because the machine was offline?
 *
 * `online` is `net.isOnline()`, whose "no" is reliable and whose "yes" only
 * means some interface is up - hence the error codes as well. A laptop that
 * wakes and checks before its Wi-Fi is back is the case this exists for.
 */
export function isOfflineFailure(why: string, online: boolean): boolean {
  return !online || OFFLINE.test(why)
}

export interface FailedCheck {
  why: string
  online: boolean
  /** Somebody pressed "check now"; the schedule did not ask. */
  manual: boolean
  now: number
  /** Added to a rescheduled check, so watches that failed together do not retry together. */
  jitter: number
}

/** Why a failure was or was not held against the watch. */
export type FailureKind = 'offline' | 'manual' | 'counted'

/**
 * What a failed check writes to its watch.
 *
 * Only a failure on the site's side is counted. One that happened because the
 * machine was offline used to count as well, so every overdue watch doubled its
 * wait on each wake that checked before the network came back; now it is tried
 * again shortly, with the count and the last error left as they were. A press of
 * "check now" shows its error but leaves the schedule alone: somebody trying
 * again by hand is not evidence that the site deserves less attention.
 */
export function settleFailedCheck(
  watch: Watch,
  check: FailedCheck
): { kind: FailureKind; patch: Partial<Watch> } {
  if (isOfflineFailure(check.why, check.online)) {
    return {
      kind: 'offline',
      patch: { nextCheckAt: check.now + OFFLINE_RETRY_MINUTES * 60_000 + check.jitter }
    }
  }
  if (check.manual) {
    return { kind: 'manual', patch: { lastCheckedAt: check.now, lastError: check.why } }
  }
  const failures = watch.failures + 1
  return {
    kind: 'counted',
    patch: {
      lastCheckedAt: check.now,
      lastError: check.why,
      failures,
      nextCheckAt:
        check.now + backoffMinutes(watch.intervalMinutes, failures) * 60_000 + check.jitter
    }
  }
}
