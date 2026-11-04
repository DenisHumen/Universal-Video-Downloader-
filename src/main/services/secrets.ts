import { app, safeStorage } from 'electron'
import { join } from 'path'
import { log } from './log'
import {
  failure,
  isRecord,
  noteRefusedWrite,
  ReadFailure,
  readJsonStore,
  writeJsonAtomic
} from './json-store'

/**
 * The passwords and tokens the automation and the proxy need, kept apart from
 * everything else.
 *
 * An SMB password, a Telegram bot token and a proxy password are not settings.
 * They live in their own file, encrypted with the key the operating system
 * holds for this app — Keychain on macOS, DPAPI on Windows, the desktop keyring
 * on Linux — so settings.json and watches.json stay ordinary readable JSON that
 * a user can inspect, copy between machines, and attach to a bug report without
 * handing over their credentials at the same time.
 *
 * The renderer is never told a value. It is told whether one is set, which is
 * all a settings screen needs to draw the difference between "not configured"
 * and "configured", and all a password field should ever know.
 *
 * Electron 45 deprecated the synchronous safeStorage calls (46 removes them),
 * so the file is decrypted once, by `initSecrets` at startup, into memory;
 * reads answer from there and stay synchronous. Writes update memory at once
 * and seal and save on one serial chain, so two saves never interleave and the
 * last one asked for is the one on disk. Blobs sealed by the synchronous calls
 * open with the asynchronous ones, so nothing is migrated.
 */

const FILE = (): string => join(app.getPath('userData'), 'secrets.dat')

/** Encrypted blobs, base64, keyed by what they are for: what secrets.dat holds. */
let cache: Record<string, string> | null = null

/**
 * Every secret this session knows, in clear, in memory only.
 *
 * With no OS key store (Linux without a running keyring) this is all there is.
 * The alternative would be writing the password to disk in clear text, which
 * is worse than losing it on quit: a file that looks encrypted but is not is
 * the kind of thing people find out about afterwards. So the secret works for
 * this session and the user is told, once, why they will be asked again.
 */
const plain = new Map<string, string>()
let warned = false

/** Whether secrets reach disk; settled by `initSecrets`. */
let persistent = false

/** secrets.dat is there but could not be read: when to look again. */
const unread = new ReadFailure()

function load(): Record<string, string> {
  if (cache) return cache
  // Every save asks; one slow failed read is enough.
  if (unread.active && !unread.due()) return {}
  try {
    /*
      A corrupt secret file must not take the app down with it, and must not be
      silently replaced either — the user is about to be asked for a password
      they thought they had already given, and deserves the reason in the log.
      json-store keeps the damaged file aside and says so. There is no backup to
      recover from: one would only hold more sealed blobs, and a password is
      cheaper to type again than a second copy of every one is to keep around.
    */
    const read = readJsonStore(FILE(), 'secrets', isRecord)
    if (read.status === 'unreadable') {
      /*
        There but locked. Not cached, so a later call reads again; and with no
        cache, `persist` refuses - a password saved now would be written over
        every other one in a file that is very probably fine.
      */
      unread.set()
      return {}
    }
    unread.clear()
    cache = read.status === 'ok' ? (read.data as Record<string, string>) : {}
  } catch (err) {
    log.error('secrets', 'Could not read the secret store; treating it as empty', failure(err))
    return {}
  }
  return cache
}

/** Written through json-store, like every other store here. True once it is on disk. */
function persist(): boolean {
  if (!cache) {
    noteRefusedWrite(FILE(), 'secrets')
    return false
  }
  try {
    writeJsonAtomic(FILE(), cache, { backup: false })
    return true
  } catch (err) {
    log.error('secrets', 'Could not save the secret store', failure(err))
    return false
  }
}

/** The tail of the write chain, and how many writes are on it. */
let chain: Promise<unknown> = Promise.resolve()
let queued = 0

/** Run `job` after every write before it. Never rejects: a failure is logged and is `fallback`. */
function enqueue<T>(job: () => Promise<T> | T, fallback: T): Promise<T> {
  queued++
  const run = chain
    .then(job)
    .catch((err) => {
      log.error('secrets', 'Could not save the secret store', failure(err))
      return fallback
    })
    .finally(() => {
      queued--
    })
  chain = run
  return run
}

async function seal(value: string): Promise<string> {
  return (await safeStorage.encryptStringAsync(value)).toString('base64')
}

let markReady: () => void = () => undefined
/**
 * Settles once secrets.dat has been opened (or found unusable). Startup waits
 * on it for a few seconds at most (`initSecretsWithin`); anything that needs
 * a secret after that awaits this instead of holding the window back.
 */
export const secretsReady: Promise<void> = new Promise((resolve) => {
  markReady = resolve
})
let ready = false

/** A secret, once the store is open. Use this from anything that may run during startup. */
export async function getSecretWhenReady(key: string): Promise<string | undefined> {
  await secretsReady
  return plain.get(key)
}

/** Whether the store has been opened (sync callers that must not block can check). */
export function secretsAreReady(): boolean {
  return ready
}

/**
 * Open the store, but give up waiting after `ms`: a locked Linux keyring can
 * hold `isAsyncEncryptionAvailable` until someone types a password, and the
 * window must not wait for that. The open carries on; `secretsReady` settles
 * when it is done. Resolves 'ready' or 'timeout'.
 */
export function initSecretsWithin(ms: number): Promise<'ready' | 'timeout'> {
  return Promise.race([
    initSecrets().then(() => 'ready' as const),
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ms).unref?.())
  ])
}

/**
 * Open secrets.dat into memory. Called once, after the app is ready; see
 * `initSecretsWithin` and `secretsReady`.
 */
export async function initSecrets(): Promise<void> {
  try {
    await openStore()
  } finally {
    ready = true
    markReady()
  }
}

async function openStore(): Promise<void> {
  try {
    persistent = await safeStorage.isAsyncEncryptionAvailable()
  } catch {
    persistent = false
  }
  // Without the key nothing in the file can be opened; it is left as it is.
  if (!persistent) return
  const store = load()
  const stale: string[] = []
  for (const [key, blob] of Object.entries(store)) {
    try {
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(
        Buffer.from(blob, 'base64')
      )
      plain.set(key, result)
      if (shouldReEncrypt) stale.push(key)
    } catch {
      /*
        Decryption fails when the file was written by another user or moved
        from another machine — the OS key is not the one that sealed it.
        Nothing can be done about the value; saying so is the useful part.
      */
      log.warn('secrets', 'A stored secret could not be decrypted on this machine', { key })
    }
  }
  // The OS rotated its key: seal those again under the current one.
  for (const key of stale) {
    void enqueue(async () => {
      const value = plain.get(key)
      if (value === undefined) return false
      const current = load()
      current[key] = await seal(value)
      return persist()
    }, false)
  }
}

/**
 * Keep a secret. Usable at once through `getSecret`; the promise is true when
 * the value is on disk and will still be there after a restart - which is
 * what a caller about to drop its own copy needs to know first.
 */
export async function setSecret(key: string, value: string): Promise<boolean> {
  if (!value) {
    await deleteSecret(key)
    return true
  }
  // A value saved while the store is still opening would be overwritten by the old one on disk.
  if (!ready) await secretsReady
  plain.set(key, value)
  if (!persistent) {
    if (!warned) {
      warned = true
      log.warn(
        'secrets',
        'No OS key store is available, so passwords are kept in memory for this session only.' +
          ' They are deliberately not written to disk in clear text.'
      )
    }
    return false
  }
  return enqueue(async () => {
    const sealed = await seal(value)
    const store = load()
    store[key] = sealed
    return persist()
  }, false)
}

export function getSecret(key: string): string | undefined {
  return plain.get(key)
}

export async function deleteSecret(key: string): Promise<void> {
  if (!ready) await secretsReady
  plain.delete(key)
  if (!persistent) return Promise.resolve()
  return enqueue(() => {
    const store = load()
    if (key in store) {
      delete store[key]
      persist()
    }
  }, undefined)
}

/**
 * What the renderer is allowed to know: whether it is set, never what it is.
 *
 * "Stored" means "and it reads back": a blob that did not open at startup is
 * not in memory, so it does not draw a filled-in password field over an
 * empty one.
 */
export function hasSecret(key: string): boolean {
  return plain.has(key)
}

/** True when secrets survive a restart on this machine. */
export function secretsPersist(): boolean {
  return persistent
}

/** Settles once every write asked for so far, and any queued behind them, is done. */
export async function flushSecrets(): Promise<void> {
  while (queued > 0) await chain
}

let quitHeld = false

/**
 * For `before-quit`: with writes still on the chain, put the quit off until
 * they land and then ask for it again. True when it was put off. Only once:
 * the second `before-quit` goes through whatever is left.
 */
export function holdQuitForSecrets(event: { preventDefault(): void }, quit: () => void): boolean {
  if (quitHeld || queued === 0) return false
  quitHeld = true
  event.preventDefault()
  void flushSecrets().finally(quit)
  return true
}

/** Key names, in one place so a typo cannot quietly lose a password. */
export const SECRET = {
  smbPassword: (targetId: string): string => `smb.${targetId}.password`,
  telegramToken: (): string => 'telegram.token',
  proxyPassword: (): string => 'proxy.password',
  /** Passwords saved in the built-in browser, one JSON blob. */
  browserLogins: (): string => 'browser.logins'
}
