import { app, net, shell } from 'electron'
import { EventEmitter } from 'events'
import pkg from 'electron-updater'
import { isNewerVersion } from '@shared/version'
import type { UpdateStatus } from '@shared/types'

const { autoUpdater } = pkg

export const updateEvents = new EventEmitter()

export const RELEASES_PAGE = 'https://github.com/DenisHumen/Universal-Video-Downloader-/releases/latest'
const RELEASES_API =
  'https://api.github.com/repos/DenisHumen/Universal-Video-Downloader-/releases/latest'

let currentStatus: UpdateStatus = { state: 'idle' }

function emit(status: UpdateStatus): void {
  currentStatus = { ...status, manual: status.manual ?? isManualPlatform() }
  updateEvents.emit('status', currentStatus)
}

export function getUpdateStatus(): UpdateStatus {
  return currentStatus
}

/**
 * Platforms where electron-updater can't install for us:
 *
 *  - **macOS**: Squirrel.Mac refuses to apply an update to an app that isn't
 *    signed with a Developer ID, and our CI builds are unsigned. Trying anyway
 *    just produces a confusing "Could not get code signature" error.
 *  - **Linux .deb/.rpm**: only AppImage installs can self-update; a packaged
 *    install belongs to the system package manager.
 *
 * On those we still *check* for updates — we just hand the user the download
 * page instead of pretending we can restart into a new version.
 */
export function isManualPlatform(): boolean {
  if (!app.isPackaged) return false
  if (process.platform === 'darwin') return true
  if (process.platform === 'linux' && !process.env.APPIMAGE) return true
  return false
}

let initialised = false

export function initUpdater(): void {
  if (initialised) return
  initialised = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false

  if (!app.isPackaged) {
    // Lets us exercise the update flow in development without a build.
    autoUpdater.forceDevUpdateConfig = true
  }

  autoUpdater.on('checking-for-update', () => {
    emit({ state: 'checking' })
  })
  autoUpdater.on('update-available', (info) => {
    emit({
      state: 'available',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      releaseDate: info.releaseDate,
      downloadUrl: RELEASES_PAGE
    })
  })
  autoUpdater.on('update-not-available', (info) => {
    emit({ state: 'not-available', version: info?.version })
  })
  autoUpdater.on('download-progress', (p) => {
    emit({ state: 'downloading', percent: p.percent, bytesPerSecond: p.bytesPerSecond })
  })
  autoUpdater.on('update-downloaded', (info) => {
    emit({
      state: 'downloaded',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      releaseDate: info.releaseDate
    })
  })
  autoUpdater.on('error', (err) => {
    emit({ state: 'error', message: err == null ? 'unknown' : err.message || String(err) })
  })
}

// ---- Manual (GitHub REST) check, used where self-install isn't possible ----

interface GhRelease {
  tag_name?: string
  name?: string
  body?: string
  published_at?: string
  html_url?: string
  draft?: boolean
  prerelease?: boolean
}

function fetchJson(url: string): Promise<GhRelease> {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, redirect: 'follow' })
    req.setHeader('Accept', 'application/vnd.github+json')
    req.setHeader('User-Agent', 'UniversalVideoDownloader')
    const timer = setTimeout(() => {
      reject(new Error('Update check timed out'))
      try {
        req.abort()
      } catch {
        /* already gone */
      }
    }, 15_000)
    req.on('response', (res) => {
      let data = ''
      res.on('data', (c: Buffer) => (data += c.toString()))
      res.on('end', () => {
        clearTimeout(timer)
        try {
          resolve(JSON.parse(data) as GhRelease)
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Bad response'))
        }
      })
      res.on('error', (err: Error) => {
        clearTimeout(timer)
        reject(err)
      })
    })
    req.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    req.end()
  })
}

async function checkViaGitHub(): Promise<UpdateStatus> {
  emit({ state: 'checking' })
  try {
    const release = await fetchJson(RELEASES_API)
    const tag = (release.tag_name || release.name || '').trim()
    if (!tag || release.draft) {
      emit({ state: 'not-available', version: app.getVersion() })
      return currentStatus
    }
    const version = tag.replace(/^v/i, '')
    if (isNewerVersion(version, app.getVersion())) {
      emit({
        state: 'available',
        version,
        releaseNotes: release.body?.slice(0, 4000),
        releaseDate: release.published_at,
        manual: true,
        downloadUrl: release.html_url || RELEASES_PAGE
      })
    } else {
      emit({ state: 'not-available', version })
    }
  } catch (err) {
    emit({ state: 'error', message: err instanceof Error ? err.message : String(err) })
  }
  return currentStatus
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (isManualPlatform()) return checkViaGitHub()
  initUpdater()
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    emit({ state: 'error', message: err instanceof Error ? err.message : String(err) })
  }
  return currentStatus
}

export async function downloadUpdate(): Promise<void> {
  if (isManualPlatform()) {
    await shell.openExternal(currentStatus.downloadUrl || RELEASES_PAGE)
    return
  }
  initUpdater()
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    emit({ state: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

export function quitAndInstall(): void {
  if (isManualPlatform()) {
    void shell.openExternal(currentStatus.downloadUrl || RELEASES_PAGE)
    return
  }
  // isSilent=false to show progress, isForceRunAfter=true to relaunch after install.
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
}

export function openReleasesPage(): Promise<void> {
  return shell.openExternal(currentStatus.downloadUrl || RELEASES_PAGE)
}
