import { app, type Cookie } from 'electron'
import { chmodSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { browsingSession } from '../resolvers/universal/capture'
import { getSettings } from './settings'
import { getSecret, SECRET, setSecret } from './secrets'
import { log } from './log'
import {
  netscapeCount,
  persistentCopy,
  saveKind,
  toNetscape,
  withLogin,
  type SavedLogin
} from './browser-logins-rules'

/**
 * Signing in once in the built-in browser, and staying signed in.
 *
 * The browser's session was always on disk, but three things undid a login:
 *
 *  - Most sites sign people in with a session cookie, one with no expiry,
 *    meant to last "until the browser closes". Chromium drops those at exit,
 *    so closing the app was signing out of every one of them. They are given a
 *    month here, as "remember me" would.
 *  - The engine never saw the browser's cookies at all. Signed in here, a
 *    download from the same site still went out as a stranger. The jar is now
 *    kept as a cookies.txt the engine is given whenever nothing else is set.
 *  - Nothing remembered a password. The browser now offers to, keeps them in
 *    the encrypted secret store, and fills them in on the same site later.
 */

const JAR = (): string => join(app.getPath('userData'), 'browser-cookies.txt')

/** Cookies in the last jar written; zero means the engine is not given it. */
let jarCount = 0
let jarTimer: NodeJS.Timeout | null = null
let started = false

function writeJar(cookies: Cookie[]): void {
  const text = toNetscape(cookies)
  jarCount = netscapeCount(text)
  const file = JAR()
  const temp = `${file}.tmp`
  // Owner only: these cookies are as good as the passwords that made them.
  writeFileSync(temp, text, { mode: 0o600 })
  try {
    chmodSync(temp, 0o600)
  } catch {
    /* Windows: the profile folder is the user's already */
  }
  renameSync(temp, file)
}

/** Write the jar soon: sign-ins set a burst of cookies, and one write covers them. */
function scheduleJar(): void {
  if (jarTimer) return
  jarTimer = setTimeout(() => {
    jarTimer = null
    void browsingSession()
      .cookies.get({})
      .then(writeJar)
      .catch((err) => log.warn('browser', 'Could not write the browser cookie jar', { why: String(err) }))
  }, 1000)
  jarTimer.unref?.()
}

/** Called once the app is ready. */
export function initBrowserLogins(): void {
  if (started) return
  started = true
  const ses = browsingSession()
  ses.cookies.on('changed', (_e, cookie, _cause, removed) => {
    scheduleJar()
    if (removed || !getSettings().browserStaySignedIn) return
    const copy = persistentCopy(cookie, Date.now() / 1000)
    if (copy) void ses.cookies.set(copy).catch(() => undefined)
  })
  scheduleJar()
}

/** The jar for the engine's `--cookies`, when there is one worth passing. */
export function browserCookiesFile(): string | undefined {
  if (!started || !getSettings().browserStaySignedIn || jarCount === 0) return undefined
  return JAR()
}

/** Put the cookie store on disk now: before quitting, and when the browser closes. */
export async function flushBrowserCookies(): Promise<void> {
  if (!started) return
  try {
    await browsingSession().cookies.flushStore()
  } catch {
    /* nothing to flush */
  }
}

/** Sign out of every site: cookies, storage and saved state. Passwords are kept. */
export async function signOutOfSites(): Promise<void> {
  const ses = browsingSession()
  await ses.clearStorageData()
  await ses.clearCache()
  writeJar([])
  log.info('browser', 'Signed out of every site in the built-in browser')
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

interface Vault {
  logins: Record<string, SavedLogin[]>
  /** Sites the user said never to offer for. */
  never: string[]
}

function vault(): Vault {
  try {
    const parsed = JSON.parse(getSecret(SECRET.browserLogins()) ?? '{}') as Partial<Vault>
    return { logins: parsed.logins ?? {}, never: parsed.never ?? [] }
  } catch {
    return { logins: {}, never: [] }
  }
}

function keep(next: Vault): Promise<boolean> {
  return setSecret(SECRET.browserLogins(), JSON.stringify(next))
}

export function loginsFor(origin: string): SavedLogin[] {
  return vault().logins[origin] ?? []
}

/** Whether a login just typed is worth asking about, and how. */
export function offerFor(origin: string, typed: SavedLogin): 'new' | 'update' | undefined {
  if (!getSettings().browserSavePasswords) return undefined
  const v = vault()
  if (v.never.includes(origin)) return undefined
  const kind = saveKind(v.logins[origin] ?? [], typed)
  return kind === 'same' ? undefined : kind
}

export function saveLogin(origin: string, typed: SavedLogin): Promise<boolean> {
  const v = vault()
  return keep({ ...v, logins: { ...v.logins, [origin]: withLogin(v.logins[origin] ?? [], typed) } })
}

export function neverForSite(origin: string): Promise<boolean> {
  const v = vault()
  return keep({ ...v, never: [...new Set([...v.never, origin])] })
}

/** For Settings: which sites have what, never the passwords. */
export function listLogins(): { origin: string; usernames: string[] }[] {
  return Object.entries(vault().logins)
    .map(([origin, list]) => ({ origin, usernames: list.map((l) => l.username) }))
    .sort((a, b) => a.origin.localeCompare(b.origin))
}

export function forgetLogins(origin?: string): Promise<boolean> {
  const v = vault()
  if (!origin) return keep({ logins: {}, never: [] })
  const logins = { ...v.logins }
  delete logins[origin]
  return keep({ logins, never: v.never.filter((o) => o !== origin) })
}
