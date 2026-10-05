/**
 * The watcher's heartbeat: a tick on an interval, one early tick after it
 * starts, and one more whenever the machine wakes up.
 *
 * Kept apart from `watcher.ts`, and free of Electron, because the part that
 * went wrong was the starting and stopping rather than the checking. The
 * watcher could be started once and never stopped: the wake-up listener was an
 * anonymous function nobody could remove, so a stop followed by a start would
 * have left two of them, and every wake would then have run two ticks — two
 * sets of checks against the same sites, two downloads of the same episode.
 * The early tick had no handle either, and fired after a stop all the same.
 */

/** The part of Electron's `powerMonitor` this needs, so a test can hand it an emitter. */
export interface WakeSource {
  on(event: 'resume', listener: () => void): unknown
  removeListener(event: 'resume', listener: () => void): unknown
}

export interface TickerOptions {
  tick: () => void
  /** How often to tick while running. */
  everyMs: number
  /** The early tick after a start. */
  firstAfterMs: number
  wake: WakeSource
  /** Called on a wake, just before the tick it causes. */
  onWake?: () => void
}

export interface Ticker {
  /** False when it was already running, which makes calling it again harmless. */
  start(): boolean
  /** False when it was not running. */
  stop(): boolean
  running(): boolean
}

export function createTicker(options: TickerOptions): Ticker {
  let interval: ReturnType<typeof setInterval> | null = null
  let first: ReturnType<typeof setTimeout> | null = null

  // One function for the ticker's whole life, so the listener it adds is the
  // listener it can take away again.
  const onResume = (): void => {
    if (!interval) return
    options.onWake?.()
    options.tick()
  }

  return {
    start() {
      if (interval) return false
      interval = setInterval(options.tick, options.everyMs)
      first = setTimeout(() => {
        first = null
        options.tick()
      }, options.firstAfterMs)
      options.wake.on('resume', onResume)
      return true
    },
    stop() {
      if (!interval) return false
      clearInterval(interval)
      interval = null
      if (first) clearTimeout(first)
      first = null
      options.wake.removeListener('resume', onResume)
      return true
    },
    running: () => interval !== null
  }
}
