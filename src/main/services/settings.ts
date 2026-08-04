import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { ACCENTS, THEMES, type AccentId, type AppSettings, type ThemeId } from '@shared/types'

const SETTINGS_FILE = (): string => join(app.getPath('userData'), 'settings.json')

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
    filenameTemplate: '%(title)s [%(id)s].%(ext)s',
    createSubfolders: false,
    speedLimit: '',
    playlistLimit: 500,
    autoUpdate: true,
    theme: 'midnight',
    accent: 'cream',
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

/** Older builds stored theme names that no longer exist. */
function migrate(raw: Record<string, unknown>): Partial<AppSettings> {
  const next = { ...raw } as Partial<AppSettings>
  if (raw.theme !== undefined && !THEMES.includes(raw.theme as ThemeId)) next.theme = 'midnight'
  if (raw.accent !== undefined && !ACCENTS.includes(raw.accent as AccentId)) next.accent = 'cream'
  if (typeof next.concurrentDownloads === 'number') {
    next.concurrentDownloads = Math.min(8, Math.max(1, Math.round(next.concurrentDownloads)))
  }
  if (typeof next.playlistLimit === 'number') {
    next.playlistLimit = Math.min(5000, Math.max(10, Math.round(next.playlistLimit)))
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
  } catch {
    cache = defaults()
  }
  return cache!
}

/** Write via a temp file so a crash mid-write can't leave an unreadable config. */
function persist(settings: AppSettings): void {
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
