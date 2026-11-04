import type { AppErrorCode } from '@shared/types'
import type { TranslationKey } from '../i18n'

/*
  6.2: a failure offers the one thing most likely to fix it, mapped from the
  error code main already sends, beside Report and Copy Error (always).

    signIn / ageGate / members-only  → Use Cookies From…   (inline browser choice)
    blocked / unsupported / empty    → Open in Built-in Browser
    noFormats                        → Audio Only
    disk full / permission           → Change Folder
    rateLimited                      → Retry in 5 Min
*/

export type FixKind = 'cookies' | 'browser' | 'audioOnly' | 'changeFolder' | 'retryLater'

const BY_CODE: Partial<Record<AppErrorCode, FixKind>> = {
  // Sign-in, age gate; "members only" arrives as signIn or as a cookie hint.
  signIn: 'cookies',
  ageRestricted: 'cookies',
  // YouTube's bot check lifts for a signed-in browser's cookies; a locked browser needs another one picked.
  botCheck: 'cookies',
  cookiesLocked: 'cookies',
  // Blocked, unsupported, empty: a person in a browser can often get past it.
  forbidden: 'browser',
  geo: 'browser',
  unsupportedPlayer: 'browser',
  emptyPage: 'browser',
  needsPicker: 'browser',
  noFormats: 'audioOnly',
  diskFull: 'changeFolder',
  permission: 'changeFolder',
  rateLimited: 'retryLater'
}

/** The fix for a failure, or none: then Retry, Report and Copy Error are what is offered. */
export function fixFor(errorCode: AppErrorCode | undefined, cookieHint = false): FixKind | null {
  const byCode = errorCode ? BY_CODE[errorCode] : undefined
  if (byCode) return byCode
  // A failure that looks like an access gate while no cookies are set up.
  if (cookieHint) return 'cookies'
  return null
}

export const FIX_LABEL: Record<FixKind, TranslationKey> = {
  cookies: 'fix.cookies',
  browser: 'fix.browser',
  audioOnly: 'fix.audioOnly',
  changeFolder: 'fix.changeFolder',
  retryLater: 'fix.retryLater'
}

/** "Retry in 5 Min". */
export const RETRY_LATER_MS = 5 * 60_000

/*
  Retries waiting out a rate limit, by row. Module state: it outlives the row
  unmounting while the user looks at another view, and a second click on the
  same row does not stack a second timer.
*/
const waiting = new Map<string, { at: number; timer: ReturnType<typeof setTimeout> }>()
const listeners = new Set<() => void>()

export function scheduleRetry(id: string, run: () => void, ms = RETRY_LATER_MS, now = Date.now()): number {
  const had = waiting.get(id)
  if (had) return had.at
  const at = now + ms
  const timer = setTimeout(() => {
    waiting.delete(id)
    listeners.forEach((l) => l())
    run()
  }, ms)
  waiting.set(id, { at, timer })
  listeners.forEach((l) => l())
  return at
}

export function cancelRetry(id: string): void {
  const had = waiting.get(id)
  if (!had) return
  clearTimeout(had.timer)
  waiting.delete(id)
  listeners.forEach((l) => l())
}

/** When a scheduled retry runs, or undefined. */
export const retryAt = (id: string): number | undefined => waiting.get(id)?.at

export function subscribeRetries(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
