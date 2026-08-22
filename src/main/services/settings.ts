import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { LEGACY_THEMES, THEMES, type AppSettings, type ThemeId } from '@shared/types'
import { isSafeTemplate } from '@shared/filename'

export { isSafeTemplate }

const SETTINGS_FILE = (): string => join(app.getPath('userData'), 'settings.json')

/** Kept out of `defaults()` so `migrate` stays free of Electron, and testable. */
const DEFAULT_TEMPLATE = '%(title)s [%(id)s].%(ext)s'

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
    filenameTemplate: DEFAULT_TEMPLATE,
    createSubfolders: false,
    speedLimit: '',
    playlistLimit: 500,
    autoUpdate: true,
    resumeOnLaunch: true,
    theme: 'night',
    language: 'auto',
    notifications: true,
    clipboardWatch: false,
    trayEnabled: false,
    universalFallback: true,
    proxy: '',
    cookiesFromBrowser: '',
    cookiesFile: ''
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
  if (typeof next.filenameTemplate === 'string' && !isSafeTemplate(next.filenameTemplate)) {
    next.filenameTemplate = DEFAULT_TEMPLATE
  }
  return next
}


let cache: AppSettings | null = null

export function getSettings(): AppSettings {
  if (cache) return cache
  try {
    const file = SETTINGS_FILE()
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>
      cache = { ...defaults(), ...migrate(parsed) }
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
    console.error('Could not read settings; falling back to defaults', err)
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
    console.error('Failed to persist settings', err)
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
  const next = { ...getSettings(), ...migrate(partial as Record<string, unknown>) }
  cache = next
  persist(next)
  return next
}

export function resetSettings(): AppSettings {
  cache = defaults()
  persist(cache)
  return cache
}
