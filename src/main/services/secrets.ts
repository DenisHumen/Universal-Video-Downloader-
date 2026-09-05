import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { log } from './log'

/**
 * The passwords and tokens the automation needs, kept apart from everything
 * else.
 *
 * An SMB password and a Telegram bot token are not settings. They live in their
 * own file, encrypted with the key the operating system holds for this app —
 * Keychain on macOS, DPAPI on Windows, the desktop keyring on Linux — so
 * settings.json and watches.json stay ordinary readable JSON that a user can
 * inspect, copy between machines, and attach to a bug report without handing
 * over their credentials at the same time.
 *
 * The renderer is never told a value. It is told whether one is set, which is
 * all a settings screen needs to draw the difference between "not configured"
 * and "configured", and all a password field should ever know.
 */

const FILE = (): string => join(app.getPath('userData'), 'secrets.dat')

/** Encrypted blobs, base64, keyed by what they are for. */
let cache: Record<string, string> | null = null

/**
 * In-memory only, for when the OS has no key store to offer.
 *
 * Linux without a running keyring is the real case. The alternative would be
 * writing the password to disk in clear text, which is worse than losing it on
 * quit: a file that looks encrypted but is not is the kind of thing people find
 * out about afterwards. So the secret works for this session and the user is
 * told, once, why they will be asked again.
 */
const volatile = new Map<string, string>()
let warned = false

function available(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function load(): Record<string, string> {
  if (cache) return cache
  try {
    const file = FILE()
    cache = existsSync(file)
      ? (JSON.parse(readFileSync(file, 'utf-8')) as Record<string, string>)
      : {}
  } catch (err) {
    /*
      A corrupt secret file must not take the app down with it, and must not be
      silently replaced either — the user is about to be asked for a password
      they thought they had already given, and deserves the reason in the log.
    */
    log.error('secrets', 'Could not read the secret store; treating it as empty', {
      why: err instanceof Error ? err.message : String(err)
    })
    cache = {}
  }
  return cache
}

/** Written through a temp file, like every other store here. */
function persist(): void {
  if (!cache) return
  try {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const target = FILE()
    const tmp = `${target}.tmp`
    writeFileSync(tmp, JSON.stringify(cache), 'utf-8')
    renameSync(tmp, target)
  } catch (err) {
    log.error('secrets', 'Could not save the secret store', {
      why: err instanceof Error ? err.message : String(err)
    })
  }
}

export function setSecret(key: string, value: string): void {
  if (!value) {
    deleteSecret(key)
    return
  }
  if (!available()) {
    volatile.set(key, value)
    if (!warned) {
      warned = true
      log.warn(
        'secrets',
        'No OS key store is available, so passwords are kept in memory for this session only.' +
          ' They are deliberately not written to disk in clear text.'
      )
    }
    return
  }
  const store = load()
  store[key] = safeStorage.encryptString(value).toString('base64')
  persist()
}

export function getSecret(key: string): string | undefined {
  const held = volatile.get(key)
  if (held !== undefined) return held
  const blob = load()[key]
  if (!blob) return undefined
  try {
    return safeStorage.decryptString(Buffer.from(blob, 'base64'))
  } catch (err) {
    /*
      Decryption fails when the file was written by another user or moved from
      another machine — the OS key is not the one that sealed it. Nothing can be
      done about the value; saying so is the useful part.
    */
    log.warn('secrets', 'A stored secret could not be decrypted on this machine', { key })
    return undefined
  }
}

export function deleteSecret(key: string): void {
  volatile.delete(key)
  const store = load()
  if (key in store) {
    delete store[key]
    persist()
  }
}

/** What the renderer is allowed to know: whether it is set, never what it is. */
export function hasSecret(key: string): boolean {
  /*
    "Stored" has to mean "and it reads back". The key that sealed a value lives
    in a file Chromium flushes on a clean quit, so an app killed between saving
    a password and its first normal exit keeps a blob it can no longer open.
    Answering true for that blob draws a filled-in password field over an empty
    one, and nobody retypes what the screen says is already there.
  */
  return volatile.has(key) || getSecret(key) !== undefined
}

/** True when secrets survive a restart on this machine. */
export function secretsPersist(): boolean {
  return available()
}

/** Key names, in one place so a typo cannot quietly lose a password. */
export const SECRET = {
  smbPassword: (targetId: string): string => `smb.${targetId}.password`,
  telegramToken: (): string => 'telegram.token'
}
