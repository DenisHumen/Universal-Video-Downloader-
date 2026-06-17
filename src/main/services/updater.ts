import { app } from 'electron'
import { EventEmitter } from 'events'
import pkg from 'electron-updater'
import type { UpdateStatus } from '@shared/types'

const { autoUpdater } = pkg

export const updateEvents = new EventEmitter()

let currentStatus: UpdateStatus = { state: 'idle' }

function emit(status: UpdateStatus): void {
  currentStatus = status
  updateEvents.emit('status', status)
}

export function getUpdateStatus(): UpdateStatus {
  return currentStatus
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
      releaseDate: info.releaseDate
    })
  })
  autoUpdater.on('update-not-available', (info) => {
    emit({ state: 'not-available', version: info?.version })
  })
  autoUpdater.on('download-progress', (p) => {
    emit({
      state: 'downloading',
      percent: p.percent,
      bytesPerSecond: p.bytesPerSecond
    })
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
    emit({ state: 'error', message: err == null ? 'unknown' : (err.message || String(err)) })
  })
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  initUpdater()
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    emit({ state: 'error', message: err instanceof Error ? err.message : String(err) })
  }
  return currentStatus
}

export async function downloadUpdate(): Promise<void> {
  initUpdater()
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    emit({ state: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

export function quitAndInstall(): void {
  // isSilent=false to show progress, isForceRunAfter=true to relaunch after install.
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
}
