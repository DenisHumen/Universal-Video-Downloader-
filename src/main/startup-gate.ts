/**
 * What a second launch asks for before the first window exists.
 *
 * `whenReady` awaits the secret store and the OS colour scheme before it
 * creates the window. A `second-instance` in that gap used to call
 * `createWindow()` itself, and startup then made another: two windows. Until
 * startup is done, a second launch only records that it wants the window
 * focused (its link goes through the pending-delivery slot as before); the
 * request is applied once, after the window exists.
 */
export interface StartupGate {
  /** A second launch asked for the window. Runs `show` now, or once started. */
  requestShow: (show: () => void) => void
  /** The first window exists: apply what was asked for meanwhile. */
  started: () => void
  readonly isStarted: boolean
}

export function createStartupGate(): StartupGate {
  let started = false
  let pending: (() => void) | null = null
  return {
    requestShow(show) {
      if (started) show()
      else pending = show
    },
    started() {
      started = true
      const show = pending
      pending = null
      show?.()
    },
    get isStarted() {
      return started
    }
  }
}

/** How long startup waits for the secret store before showing the window anyway. */
export const SECRETS_STARTUP_CAP_MS = 3000
