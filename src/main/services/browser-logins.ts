import { app, type Cookie } from 'electron'
import { spawn } from 'child_process'
import { randomBytes } from 'crypto'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'fs'
import { readdir, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { browsingSession } from '../resolvers/universal/capture'
import { getSettings } from './settings'
import { getSecret, openText, sealText, SECRET, setSecret } from './secrets'
import { log } from './log'
import { withJsRuntime } from './js-runtime'
import { ytdlpBinaryPath, ytdlpSpawnOptions } from './ytdlp'
import type { AppSettings, SignInImport } from '@shared/types'
import {
  fromNetscape,
  importFailure,
  siteCount,
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
 *    kept as a cookies.txt the engine is given a copy of whenever nothing else
 *    is set.
 *  - Nothing remembered a password. The browser now offers to, keeps them in
 *    the encrypted secret store, and fills them in on the same site later.
 */

/** The jar in the clear: as older builds left it, and as a machine with no key still keeps it. */
const JAR = (): string => join(app.getPath('userData'), 'browser-cookies.txt')
/** The jar on a machine with a key. Only the terminal reads this: the window has `jarText`. */
const SEALED_JAR = (): string => join(app.getPath('userData'), 'browser-cookies.dat')
/** One folder per engine run. All of it left over at a launch is from a crash. */
const COPIES = (): string => join(app.getPath('userData'), 'cookie-copies')

/** Cookies in the last jar written; zero means the engine is not given it. */
let jarCount = 0
/** The jar as of the last change, which each run of the engine gets a copy of. */
let jarText = ''
let jarTimer: NodeJS.Timeout | null = null
let started = false
/** Reading the jar the app left, for the terminal. */
let reading = false
/** The terminal's own copy of that jar. See `readSavedBrowserJar`. */
let privateJar: string | undefined
/** One disk write at a time, so an older jar can never land on a newer one. */
let saving: Promise<unknown> = Promise.resolve()

// Owner only: these cookies are as good as the passwords that made them.
function writeOwnerOnly(file: string, text: string): void {
  const temp = `${file}.tmp`
  writeFileSync(temp, text, { mode: 0o600 })
  try {
    chmodSync(temp, 0o600)
  } catch {
    /* Windows: the profile folder is the user's already */
  }
  renameSync(temp, file)
}

/**
 * Chromium keeps these cookies encrypted, and a cookies.txt beside them undid
 * that for anything able to read the profile. Sealed with the same key as the
 * saved passwords, the clear copy goes as soon as a sealed one is down. A machine
 * with no key (a Linux desktop with no keyring) keeps the clear file, because the
 * terminal has no other way to the sign-ins.
 */
async function saveJar(text: string): Promise<void> {
  const sealed = await sealText(text)
  if (sealed === null) {
    writeOwnerOnly(JAR(), text)
    rmSync(SEALED_JAR(), { force: true })
    return
  }
  writeOwnerOnly(SEALED_JAR(), sealed)
  rmSync(JAR(), { force: true })
}

function writeJar(cookies: Cookie[]): void {
  const text = toNetscape(cookies)
  jarText = text
  jarCount = netscapeCount(text)
  saving = saving
    .then(() => saveJar(text))
    .catch((err) => log.warn('browser', 'Could not write the browser cookie jar', { why: String(err) }))
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

function removeQuietly(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  } catch (err) {
    log.warn('browser', 'Could not remove a copy of the cookie jar', { why: String(err) })
  }
}

/** Called once the app is ready. */
export function initBrowserLogins(): void {
  if (started) return
  started = true
  void sweepAbandonedJars()
  // A crash leaves the copies its runs were using, and a sign-in import's file.
  removeQuietly(COPIES())
  try {
    for (const name of readdirSync(app.getPath('userData'))) {
      if (/^import-\d+-\d+\.txt$/.test(name)) removeQuietly(join(app.getPath('userData'), name))
    }
  } catch {
    /* nothing there yet */
  }
  const ses = browsingSession()
  ses.cookies.on('changed', (_e, cookie, _cause, removed) => {
    scheduleJar()
    if (removed || !getSettings().browserStaySignedIn) return
    const copy = persistentCopy(cookie, Date.now() / 1000)
    if (copy) void ses.cookies.set(copy).catch(() => undefined)
  })
  scheduleJar()
}

/** Whether the engine would be given a jar. A name to test, not a file to pass: see `holdJarCopy`. */
export function browserCookiesFile(): string | undefined {
  if ((!started && !reading) || !getSettings().browserStaySignedIn || jarCount === 0) return undefined
  return privateJar ?? JAR()
}

/** The jar for one run of the engine. `release` when that run is over; more than once is fine. */
export interface JarCopy {
  file?: string
  release: () => void
}

const NO_JAR: JarCopy = { release: () => undefined }

/**
 * A copy of the jar for one run of the engine, which is the only way it gets one.
 *
 * The engine rewrites its `--cookies` file as it exits, with whatever it read at
 * the start. Handed one shared jar, a download that outlasted "sign out of every
 * site" put every cookie back, and until the next change in the browser the jar on
 * disk said the person was signed in. Its own folder, owner only, gone when the run
 * is; a crash's are cleared at the next launch. Nothing when the settings name
 * cookies of their own, which is what `accessArgs` would use.
 */
export function holdJarCopy(settings: Pick<AppSettings, 'cookiesFile' | 'cookiesFromBrowser'>): JarCopy {
  if (settings.cookiesFile || settings.cookiesFromBrowser || !browserCookiesFile()) return NO_JAR
  // The terminal's own copy is already private to its one process.
  if (privateJar) return { file: privateJar, release: () => undefined }
  const folder = join(COPIES(), randomBytes(8).toString('hex'))
  try {
    mkdirSync(folder, { recursive: true, mode: 0o700 })
    const file = join(folder, 'cookies.txt')
    writeFileSync(file, jarText, { mode: 0o600, flag: 'wx' })
    return { file, release: () => removeQuietly(folder) }
  } catch (err) {
    log.warn('browser', 'Could not copy the cookie jar for the engine', { why: String(err) })
    removeQuietly(folder)
    return NO_JAR
  }
}

/** What the app last left on disk, sealed or from before it sealed anything. */
async function savedJarText(): Promise<string> {
  let sealed: string | undefined
  try {
    sealed = readFileSync(SEALED_JAR(), 'utf8')
  } catch {
    return readFileSync(JAR(), 'utf8')
  }
  return (await openText(sealed)) ?? ''
}

/**
 * Use the jar the app wrote, without starting anything that writes one.
 *
 * For `uvd`, which claims the app's cookies. It has a Chromium profile of its
 * own with no sign-ins in it, so `initBrowserLogins` there would replace the
 * app's jar with an empty one, and without either the terminal went out as a
 * stranger on a site the person had signed in to.
 *
 * A copy, for the reason in `holdJarCopy`. It is as secret as the jar: its own
 * folder, owner only, and gone again through `dropSavedBrowserJar`.
 */
export async function readSavedBrowserJar(): Promise<void> {
  reading = true
  jarCount = 0
  void sweepAbandonedJars()
  try {
    const text = await savedJarText()
    const count = netscapeCount(text)
    if (!count) return
    const file = join(mkdtempSync(join(tmpdir(), `${JAR_COPY_PREFIX}${process.pid}-`)), 'cookies.txt')
    writeFileSync(file, text, { mode: 0o600, flag: 'wx' })
    privateJar = file
    jarCount = count
  } catch {
    // The app has never written one, or there is nowhere to put a copy: nothing to pass.
  }
}

/** The terminal is finished with its copy of the jar. Safe to call more than once. */
export function dropSavedBrowserJar(): void {
  const file = privateJar
  privateJar = undefined
  jarCount = 0
  if (!file) return
  try {
    rmSync(dirname(file), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  } catch (err) {
    log.warn('browser', 'Could not remove the copy of the cookie jar', { why: String(err) })
  }
}

const JAR_COPY_PREFIX = 'uvd-cookies-'
/** A copy from before they carried a process id: older than this, nothing is still using it. */
const NAMELESS_COPY_AGE = 24 * 60 * 60 * 1000

function processRuns(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM is somebody else's process, which is still a process.
    return (err as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/**
 * Delete the copies of the jar that runs of `uvd` did not live to delete.
 *
 * `dropSavedBrowserJar` cannot cover every way out. On Windows, Ctrl-C in a
 * console ends an Electron process there and then: `process.on('SIGINT')` never
 * runs (measured on Electron 45, exit status 0xC000013A), so what the command
 * leaves is signed-in cookies in the temp folder. A closed terminal or a killed
 * process does the same anywhere. The next launch of either kind cleans up, and
 * the process id in the name leaves a run still going alone.
 */
export async function sweepAbandonedJars(dir = tmpdir(), now = Date.now()): Promise<void> {
  try {
    for (const name of await readdir(dir)) {
      if (!name.startsWith(JAR_COPY_PREFIX)) continue
      const path = join(dir, name)
      const owner = /^(\d+)-/.exec(name.slice(JAR_COPY_PREFIX.length))
      const abandoned = owner
        ? !processRuns(Number(owner[1]))
        : now - (await stat(path)).mtimeMs > NAMELESS_COPY_AGE
      if (abandoned) await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    }
  } catch (err) {
    log.warn('browser', 'Could not clean up old copies of the cookie jar', { why: String(err) })
  }
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
  // Gone from disk now, and not when a locked keyring next lets a write through.
  rmSync(JAR(), { force: true })
  rmSync(SEALED_JAR(), { force: true })
  writeJar([])
  log.info('browser', 'Signed out of every site in the built-in browser')
}

/**
 * Sign the built-in browser in wherever another browser on this computer is.
 *
 * The one way into a site that will not let an embedded browser sign in -
 * Google above all - and a quicker one into every other. The engine already
 * reads browsers' cookies for downloads, decryption and all, so it is asked to
 * write them out, and they are set here. It needs a URL to do anything, so it
 * is given one that is not a URL: it reads the browser, fails on that at once
 * without going near the network, and writes the cookies out on its way out.
 */
export async function importSignIns(browser: string): Promise<SignInImport> {
  const file = join(app.getPath('userData'), `import-${process.pid}-${Date.now()}.txt`)
  try {
    const stderr = await new Promise<string>((resolve) => {
      const child = spawn(
        ytdlpBinaryPath(),
        withJsRuntime(['--ignore-config', '--no-warnings', '--cookies-from-browser', browser, '--cookies', file, '--skip-download', 'uvd-cookie-export']),
        ytdlpSpawnOptions()
      )
      let err = ''
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (d: string) => (err += d))
      const timer = setTimeout(() => child.kill(), 120_000)
      child.on('error', (e) => {
        clearTimeout(timer)
        resolve(String(e))
      })
      child.on('close', () => {
        clearTimeout(timer)
        resolve(err)
      })
    })
    let text = ''
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      /* nothing was written: the browser could not be read */
    }
    const cookies = fromNetscape(text, Date.now() / 1000)
    if (cookies.length === 0) {
      const why = /Extracted 0 cookies/i.test(stderr) ? 'empty' : importFailure(stderr)
      log.warn('browser', 'Could not import sign-ins', { browser, why, detail: stderr.split('\n').filter((l) => l && !l.includes('uvd-cookie-export')).join(' ').slice(-400) })
      return { ok: false, why }
    }
    const ses = browsingSession()
    const set: typeof cookies = []
    for (const cookie of cookies) {
      try {
        await ses.cookies.set(cookie)
        set.push(cookie)
      } catch {
        /* Chromium turns some down - a cookie for an IP, say. The rest still count. */
      }
    }
    await flushBrowserCookies()
    scheduleJar()
    log.info('browser', 'Imported sign-ins', { browser, cookies: set.length })
    return { ok: true, sites: siteCount(set) }
  } finally {
    rmSync(file, { force: true })
  }
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
