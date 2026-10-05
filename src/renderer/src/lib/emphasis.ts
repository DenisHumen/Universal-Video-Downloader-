import type { AppErrorCode } from '@shared/types'

/*
  Which button gets to be the loud one.

  The system allows one solid accent per screen, and several states broke it:
  with a result on Home, "get" and "download" were both solid, so the step
  already taken competed with the one still to take; the error card put the
  built-in browser and the retry on equal footing whatever the failure; and
  the Telegram save in Settings stayed solid and armed with nothing to save.
  The decisions live here so each one is a line in a test, not a ternary
  buried in a view.
*/

export interface DetectButtonState {
  /** What the link field holds now. */
  url: string
  /** The link the result or error on screen came from. */
  detectedUrl: string
  /** A result card or an error card is showing. */
  showing: boolean
  /** The batch panel, which brings its own solid button, is open. */
  batchOpen: boolean
}

/**
 * The detect button steps back once its job is done: the field still holds
 * the link whose result is on screen. Paste a different link and it is the
 * next step again, so it turns loud again.
 */
export function detectIsDone(state: DetectButtonState): boolean {
  if (state.batchOpen) return true
  return state.showing && state.url.trim() === state.detectedUrl.trim()
}

/** Failures a second attempt in a moment can fix: the link itself is fine. */
const TRANSIENT: ReadonlySet<AppErrorCode> = new Set<AppErrorCode>([
  'network',
  'timeout',
  'rateLimited'
])

/**
 * The error card's one solid button. For a dropped connection, a timeout or a
 * rate limit the answer is to try again; for everything else — a page the
 * engine can't read, a gate it can't pass — it is finding the video by hand in
 * the built-in browser.
 */
export function errorLead(code?: AppErrorCode): 'retry' | 'browser' {
  return code && TRANSIENT.has(code) ? 'retry' : 'browser'
}

/**
 * Whether the Telegram form holds anything to save. The token never comes back
 * to the renderer — main keeps it encrypted with the OS key store — so any
 * typed token counts as a change; the chat id is compared with the saved one
 * the way it is stored, trimmed.
 */
export function telegramChanged(saved: string | undefined, chatId: string, token: string): boolean {
  return token.trim() !== '' || chatId.trim() !== (saved ?? '')
}
