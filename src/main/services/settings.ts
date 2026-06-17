import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AppSettings } from '@shared/types'

const SETTINGS_FILE = () => join(app.getPath('userData'), 'settings.json')

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
    restrictFilenames: false,
    filenameTemplate: '%(title)s [%(id)s].%(ext)s',
    autoUpdate: true,
    theme: 'midnight',
    proxy: '',
    cookiesFromBrowser: '',
    cookiesFile: ''
  }
}

let cache: AppSettings | null = null

export function getSettings(): AppSettings {
  if (cache) return cache
  try {
    const file = SETTINGS_FILE()
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf-8'))
      cache = { ...defaults(), ...parsed }
    } else {
      cache = defaults()
      persist(cache)
    }
  } catch {
    cache = defaults()
  }
  return cache!
}

function persist(settings: AppSettings): void {
  try {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2), 'utf-8')
  } catch (err) {
    console.error('Failed to persist settings', err)
  }
}

export function setSettings(partial: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...partial }
  cache = next
  persist(next)
  return next
}
