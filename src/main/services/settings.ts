import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { LEGACY_THEMES, THEMES, type AppSettings, type ThemeId } from '@shared/types'
import { isSafeTemplate } from '@shared/filename'
import { normaliseRate } from '@shared/rate'
import { normaliseSmbTarget } from '@shared/automation'
import { proxyUser, splitProxyPassword } from '@shared/proxy'
import { log } from './log'
import { deleteSecret, SECRET, secretsPersist, setSecret } from './secrets'

export { isSafeTemplate }

const SETTINGS_FILE = (): string => join(app.getPath('userData'), 'settings.json')

/**
 * Kept out of `defaults()` so `migrate` stays free of Electron, and testable.
 * Exported so an error report can say whether the template was changed
 * without saying what to.
 */
export const DEFAULT_TEMPLATE = '%(title)s [%(id)s].%(ext)s'

function defaults(): AppSettings {
  return {
    downloadDir: app.getPath('downloads'),
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
    theme: 'night',
    language: 'auto',
    notifications: true,
    clipboardWatch: false,
    trayEnabled: false,
    universalFallback: true,
    showAdultServices: false,
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
    Shares saved before the path box existed hold the whole path in the share
    field, which no server will accept. Repairing them here means it happens on
    the read that follows the update, without the user being asked to go and
    retype something they already typed correctly once.
  */
  if (Array.isArray(next.smbTargets)) {
    next.smbTargets = next.smbTargets.map(normaliseSmbTarget)
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

/**
 * What kind of failure it was, and nothing of what it said.
 *
 * A JSON parse error quotes the text it choked on, and this text is the
 * settings file: the proxy with its password, the cookies file's path, the
 * Telegram chat. The name and the system error code (EACCES, ENOSPC) are what
 * tell a corrupt file from a locked one, and they quote nothing.
 */
function failure(err: unknown): Record<string, string | undefined> {
  if (!(err instanceof Error)) return { error: typeof err }
  return { error: err.name, code: (err as NodeJS.ErrnoException).code }
}

export function getSettings(): AppSettings {
  if (cache) return cache
  try {
    const file = SETTINGS_FILE()
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>
      const read = { ...defaults(), ...migrate(parsed) }
      cache = liftProxyPassword(read, proxyPasswordStore)
      if (cache.proxy !== read.proxy) {
        persist(cache)
        log.info('settings', 'The proxy password moved from settings.json to the secret store')
      }
    } else {
      cache = defaults()
      persist(cache)
    }
  } catch (err) {
    /*
      Reaching here throws away every setting the user has ever changed — the
      download folder, the cookies, the proxy — and it runs on the first launch
      after every update, for every existing user. Silently was not good enough.
    */
    log.error('settings', 'Could not read settings; falling back to defaults', failure(err))
    cache = defaults()
  }
  return cache!
}

/** Write via a temp file so a crash mid-write can't leave an unreadable config. */
function writeNow(settings: AppSettings): void {
  try {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const target = SETTINGS_FILE()
    const tmp = `${target}.tmp`
    writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf-8')
    renameSync(tmp, target)
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
function persist(settings: AppSettings): void {
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    writeTimer = null
    writeNow(settings)
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
  if (cache) writeNow(cache)
}

export function setSettings(partial: Partial<AppSettings>): AppSettings {
  const next = liftProxyPassword(
    { ...getSettings(), ...migrate(partial as Record<string, unknown>) },
    proxyPasswordStore
  )
  cache = next
  persist(next)
  return next
}

export function resetSettings(): AppSettings {
  proxyPasswordStore.forget()
  cache = defaults()
  persist(cache)
  return cache
}
