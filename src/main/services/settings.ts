import { app } from 'electron'
import { homedir } from 'os'
import { join } from 'path'
import { LEGACY_THEMES, THEMES, type AppSettings, type ThemeId } from '@shared/types'
import { isSafeTemplate } from '@shared/filename'
import { normaliseRate } from '@shared/rate'
import { normaliseSmbTarget } from '@shared/automation'
import { proxyUser, splitProxyPassword } from '@shared/proxy'
import { log } from './log'
import { deleteSecret, SECRET, secretsPersist, setSecret } from './secrets'
import {
  failure,
  isRecord,
  noteRefusedWrite,
  ReadFailure,
  readJsonStore,
  writeJsonAtomic
} from './json-store'

export { isSafeTemplate }

const SETTINGS_FILE = (): string => join(app.getPath('userData'), 'settings.json')

/**
 * Kept out of `defaults()` so `migrate` stays free of Electron, and testable.
 * Exported so an error report can say whether the template was changed
 * without saying what to.
 */
export const DEFAULT_TEMPLATE = '%(title)s [%(id)s].%(ext)s'

/**
 * Where downloads go until the user says otherwise.
 *
 * Electron throws "Failed to get downloads path" when the Windows Downloads
 * folder is broken or redirected somewhere that has gone. This runs inside the
 * very first `getSettings()`, before the log or the window exist, so the throw
 * stopped the app from starting at all, with nothing on screen to say why.
 */
function defaultDownloadDir(): string {
  try {
    return app.getPath('downloads')
  } catch {
    return join(homedir(), 'Downloads')
  }
}

function defaults(): AppSettings {
  return {
    downloadDir: defaultDownloadDir(),
    concurrentDownloads: 3,
    defaultMode: 'video',
    defaultQuality: 'best',
    audioFormat: 'mp3',
    embedThumbnail: true,
    embedSubtitles: false,
    embedMetadata: true,
    embedChapters: true,
    writeSubtitles: false,
    subtitleLanguages: 'en,ru',
    sponsorBlock: false,
    restrictFilenames: false,
    preferCompatible: true,
    automationEnabled: false,
    autostart: false,
    smbTargets: [],
    telegramChatId: '',
    logVerbose: false,
    filenameTemplate: DEFAULT_TEMPLATE,
    createSubfolders: false,
    speedLimit: '',
    playlistLimit: 500,
    playlistNumbering: true,
    playlistFolder: true,
    autoUpdate: true,
    resumeOnLaunch: true,
    keepFinished: 0,
    theme: 'night',
    language: 'auto',
    notifications: true,
    clipboardWatch: false,
    trayEnabled: false,
    universalFallback: true,
    proxy: '',
    cookiesFromBrowser: '',
    cookiesFile: '',
    errorReports: 'ask'
  }
}

/**
 * Older builds stored settings this one no longer understands.
 *
 * The redesign collapsed four palettes into two and dropped the accent picker
 * entirely, so an existing config will name a theme that isn't there any more.
 * Map it onto the nearest survivor rather than resetting to the default — a
 * user who chose `daylight` wants a light window, not a dark one.
 */
export function migrate(raw: Record<string, unknown>): Partial<AppSettings> {
  const next = { ...raw } as Partial<AppSettings> & { accent?: unknown }
  if (raw.theme !== undefined && !THEMES.includes(raw.theme as ThemeId)) {
    next.theme = LEGACY_THEMES[String(raw.theme)] ?? 'night'
  }
  delete next.accent
  if (typeof next.concurrentDownloads === 'number') {
    next.concurrentDownloads = Math.min(8, Math.max(1, Math.round(next.concurrentDownloads)))
  }
  if (typeof next.playlistLimit === 'number') {
    next.playlistLimit = Math.min(5000, Math.max(10, Math.round(next.playlistLimit)))
  }
  /*
    Zero, or anything that is not a positive number, keeps every finished row:
    a hand-edited value that cannot be read must never start deleting history.
    A real limit is held to at least ten, so one stray digit cannot empty the
    list down to the last download.
  */
  if (next.keepFinished !== undefined) {
    const keep = Math.round(Number(next.keepFinished))
    next.keepFinished = Number.isFinite(keep) && keep > 0 ? Math.min(10000, Math.max(10, keep)) : 0
  }
  /*
    Shares saved before the path box existed hold the whole path in the share
    field, which no server will accept. Repairing them here means it happens on
    the read that follows the update, without the user being asked to go and
    retype something they already typed correctly once.

    An entry that is not an object at all is dropped first: normalising `null`
    throws, and a throw here used to cost every other setting in the file.
  */
  if (Array.isArray(next.smbTargets)) {
    next.smbTargets = next.smbTargets.filter(isRecord).map(normaliseSmbTarget)
  }
  if (typeof next.filenameTemplate === 'string' && !isSafeTemplate(next.filenameTemplate)) {
    next.filenameTemplate = DEFAULT_TEMPLATE
  }
  /*
    Older builds saved the speed limit exactly as typed, and the engine refuses
    "2MB" before it downloads a byte - so one such entry failed every download
    after it. Read here, a stored value is repaired on the first launch of this
    build, and every write from the window goes through the same door. What
    cannot be read as a rate falls back to no limit, which at least downloads.
  */
  if (next.speedLimit !== undefined) {
    next.speedLimit =
      typeof next.speedLimit === 'string' ? (normaliseRate(next.speedLimit) ?? '') : ''
  }

  /*
    Only a value that is present and wrong is repaired. A file from before the
    setting existed simply lacks the key and gets the default from `defaults()`
    — and this also runs on every partial save, where filling the key in would
    switch reports back on each time any other setting changed.
  */
  if ('errorReports' in next && next.errorReports !== 'ask' && next.errorReports !== 'off') {
    next.errorReports = 'ask'
  }
  return next
}

/** Where `liftProxyPassword` puts what it takes out. */
export interface ProxyPasswordStore {
  /** True once the password will still be there after a restart. */
  keep(password: string): boolean
  forget(): void
}

/**
 * The proxy's password leaves the setting for the secret store.
 *
 * Run on the settings as read from disk and on every save, so a password that
 * was always in settings.json moves on the first launch of this version, and
 * one pasted as `http://user:pass@host` later moves before it is written. The
 * address keeps the user name, which is what says the password is needed.
 *
 * Only once the store has it for good. With no key store (Linux without a
 * keyring) it would last until the app closed, after which the proxy would
 * turn away every download - so there it stays in the address, as it always
 * has. And an address with no user name forgets the stored password: it is
 * never sent without one, and a leftover would follow the next user typed.
 */
export function liftProxyPassword<T extends Partial<Pick<AppSettings, 'proxy'>>>(
  settings: T,
  store: ProxyPasswordStore
): T {
  if (typeof settings.proxy !== 'string') return settings
  const { proxy, password } = splitProxyPassword(settings.proxy)
  if (!proxyUser(proxy)) store.forget()
  else if (password && !store.keep(password)) return settings
  return proxy === settings.proxy ? settings : { ...settings, proxy }
}

const proxyPasswordStore: ProxyPasswordStore = {
  keep: (password) => {
    try {
      return secretsPersist() && setSecret(SECRET.proxyPassword(), password)
    } catch {
      return false
    }
  },
  forget: () => deleteSecret(SECRET.proxyPassword())
}


let cache: AppSettings | null = null

/** settings.json is there but could not be read. See json-store.ts. */
const unread = new ReadFailure()

/**
 * What was changed while settings.json could not be read, to lay over it once
 * it can. Saving the whole cache instead would put a default in place of every
 * setting the file holds that this session never got to see.
 */
let interim: Partial<AppSettings> = {}

/**
 * The next save also replaces settings.json.bak.
 *
 * The backup is the version before the last save, and a save that took the
 * proxy password out of the file - or changed or removed the proxy - would
 * otherwise leave the old password sitting in it until some later save.
 */
let scrubBackup = false

/**
 * Read settings.json into the cache.
 *
 * 'unreadable' when the file is there but could not be opened: the cache then
 * holds defaults plus this session's changes, and nothing may be written.
 * 'dirty' when what is now in memory ought to be saved - a first launch, a
 * damaged file replaced, a password lifted out, or changes made while the file
 * could not be read.
 */
function load(): 'clean' | 'dirty' | 'unreadable' {
  const read = readJsonStore(SETTINGS_FILE(), 'settings', isRecord)
  if (read.status === 'unreadable') {
    unread.set()
    cache = { ...defaults(), ...interim }
    return 'unreadable'
  }
  unread.clear()
  const stored = read.status === 'ok' ? migrate(read.data as Record<string, unknown>) : {}
  const merged = { ...defaults(), ...stored, ...interim }
  const pending = Object.keys(interim).length > 0
  interim = {}
  cache = liftProxyPassword(merged, proxyPasswordStore)
  const lifted = cache.proxy !== merged.proxy
  if (lifted) {
    scrubBackup = true
    log.info('settings', 'The proxy password moved from settings.json to the secret store')
  }
  return read.status !== 'ok' || read.recovered || lifted || pending ? 'dirty' : 'clean'
}

export function getSettings(): AppSettings {
  if (cache && !unread.due()) return cache
  try {
    if (load() === 'dirty') persist()
  } catch (err) {
    /*
      Reaching here throws away every setting the user has ever changed — the
      download folder, the cookies, the proxy — and it runs on the first launch
      after every update, for every existing user. Silently was not good enough.
    */
    log.error('settings', 'Could not read settings; falling back to defaults', failure(err))
    cache = cache ?? defaults()
  }
  return cache!
}

/** Write through json-store, so a crash mid-write can't leave an unreadable config. */
function writeNow(): void {
  try {
    /*
      One more look before refusing: whatever kept the file from being read may
      have let go of it since, and a successful read folds this session's
      changes into what the file holds.
    */
    if (unread.active && load() === 'unreadable') {
      noteRefusedWrite(SETTINGS_FILE(), 'settings')
      return
    }
    if (!cache) return
    const target = SETTINGS_FILE()
    writeJsonAtomic(target, cache, { indent: 2, backup: !scrubBackup })
    if (scrubBackup) {
      writeJsonAtomic(`${target}.bak`, cache, { indent: 2, backup: false })
      scrubBackup = false
    }
  } catch (err) {
    log.error('settings', 'Could not save settings', failure(err))
  }
}

let writeTimer: NodeJS.Timeout | null = null

/**
 * Save, but not once per keystroke.
 *
 * Several settings are free-text — the speed limit, the filename template, the
 * subtitle languages, the proxy — and every character typed into one of them
 * came all the way through to a synchronous rewrite of settings.json. Typing
 * "500K" wrote the file four times.
 *
 * The in-memory cache is updated immediately, so nothing ever reads a stale
 * value; only the disk write waits. Same shape as the queue's history file,
 * which settled this question already.
 */
function persist(): void {
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    writeTimer = null
    writeNow()
  }, 400)
}

/**
 * Write anything still pending, now. Called on the way out — a setting changed
 * a quarter of a second before quitting is still a setting the user changed.
 */
export function flushSettings(): void {
  if (!writeTimer) return
  clearTimeout(writeTimer)
  writeTimer = null
  writeNow()
}

export function setSettings(partial: Partial<AppSettings>): AppSettings {
  const previous = getSettings()
  const patch = migrate(partial as Record<string, unknown>)
  const next = liftProxyPassword({ ...previous, ...patch }, proxyPasswordStore)
  if (next.proxy !== previous.proxy) scrubBackup = true
  if (unread.active) {
    // As saved, not as typed: a proxy password has already been lifted out of `next`.
    const changed = Object.keys(patch).map((key) => [key, next[key as keyof AppSettings]])
    interim = { ...interim, ...Object.fromEntries(changed) }
  }
  cache = next
  persist()
  return next
}

export function resetSettings(): AppSettings {
  proxyPasswordStore.forget()
  cache = defaults()
  scrubBackup = true
  // A reset is a change to every setting, and lands on the file whenever it can be read.
  if (unread.active) interim = { ...cache }
  persist()
  return cache
}
