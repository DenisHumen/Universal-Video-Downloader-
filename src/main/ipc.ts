import { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, shell } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AppSettings,
  DetectStage,
  DownloadItem,
  DownloadRequest,
  MediaJobRequest,
  SearchScope
} from '@shared/types'
import { detect } from './services/detector'
import { searchVideos } from './services/search'
import { probeMedia } from './services/ffmpeg'
import { fetchThumbnail } from './services/thumbnails'
import { registerBrowserIpc } from './services/browser'
import { setKeepAwake } from './services/awake'
import { mt } from './services/locale'
import {
  cancelDownload,
  clearFinished,
  downloadEvents,
  listDownloads,
  pauseAll,
  pauseDownload,
  removeDownload,
  resumeAll,
  resumeDownload,
  retryDownload,
  prioritizeDownload,
  retryFailed,
  startDownload,
  startMediaJob
} from './services/downloader'
import { getSettings, resetSettings, setSettings } from './services/settings'
import { ensureYtdlp, getYtdlpStatus, updateYtdlp, ytdlpEvents } from './services/ytdlp'
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateStatus,
  isManualPlatform,
  openReleasesPage,
  quitAndInstall,
  updateEvents
} from './services/updater'

export interface IpcContext {
  getWindow: () => BrowserWindow | null
  openSearchWindow: (query: string) => void
  onSettingsChanged: (settings: AppSettings) => void
}

/** In-flight detections, so the UI can cancel a slow universal scan. */
const detections = new Map<string, AbortController>()

export function registerIpc({ getWindow, openSearchWindow, onSettingsChanged }: IpcContext): void {
  notificationWindow = getWindow
  const send = (channel: string, payload: unknown): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  // ---- Media detection & search ----
  ipcMain.handle(IPC.detect, async (event, url: string, requestId?: string) => {
    await ensureYtdlp()
    const controller = new AbortController()
    if (requestId) detections.set(requestId, controller)
    const report = (stage: DetectStage): void => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(IPC.evtDetectStatus, { stage, url })
      }
    }
    try {
      return await detect(url, report, controller.signal)
    } finally {
      if (requestId) detections.delete(requestId)
    }
  })
  ipcMain.handle(IPC.detectCancel, (_e, requestId: string) => {
    detections.get(requestId)?.abort()
    detections.delete(requestId)
  })
  ipcMain.handle(IPC.search, (_e, query: string, scope: SearchScope, limit?: number) =>
    searchVideos(query, scope, limit)
  )
  ipcMain.handle(IPC.searchOpenWindow, (_e, query: string) => openSearchWindow(query))

  // ---- Downloads ----
  ipcMain.handle(IPC.downloadStart, (_e, req: DownloadRequest) => startDownload(req))
  ipcMain.handle(IPC.downloadPause, (_e, id: string) => pauseDownload(id))
  ipcMain.handle(IPC.downloadResume, (_e, id: string) => resumeDownload(id))
  ipcMain.handle(IPC.downloadCancel, (_e, id: string) => cancelDownload(id))
  ipcMain.handle(IPC.downloadRetry, (_e, id: string) => retryDownload(id))
  ipcMain.handle(IPC.downloadRemove, (_e, id: string) => removeDownload(id))
  ipcMain.handle(IPC.downloadClearFinished, () => clearFinished())
  ipcMain.handle(IPC.downloadList, () => listDownloads())
  ipcMain.handle(IPC.mediaJobStart, (_e, req: MediaJobRequest) => startMediaJob(req))
  ipcMain.handle(IPC.mediaProbe, (_e, path: string) => probeMedia(path))
  ipcMain.handle(IPC.mediaThumbnail, (_e, url: string, pageUrl?: string) =>
    fetchThumbnail(url, pageUrl)
  )
  ipcMain.handle(IPC.downloadPauseAll, () => pauseAll())
  ipcMain.handle(IPC.downloadResumeAll, () => resumeAll())
  ipcMain.handle(IPC.downloadRetryFailed, () => retryFailed())
  ipcMain.handle(IPC.downloadPrioritize, (_e, id: string) => prioritizeDownload(id))

  // ---- Settings ----
  ipcMain.handle(IPC.settingsGet, () => getSettings())
  ipcMain.handle(IPC.settingsSet, (_e, partial: Partial<AppSettings>) => {
    const next = setSettings(partial)
    onSettingsChanged(next)
    return next
  })
  ipcMain.handle(IPC.settingsReset, () => {
    const next = resetSettings()
    onSettingsChanged(next)
    return next
  })

  // ---- Shell / dialogs ----
  ipcMain.handle(IPC.chooseDirectory, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? getWindow() ?? undefined
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })
  ipcMain.handle(IPC.chooseCookiesFile, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? getWindow() ?? undefined
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [
        { name: 'Cookies', extensions: ['txt'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })
  ipcMain.handle(IPC.openPath, (_e, path: string) => shell.openPath(path))
  ipcMain.handle(IPC.showInFolder, (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    if (!/^https?:\/\//i.test(url)) return Promise.resolve()
    return shell.openExternal(url)
  })
  ipcMain.handle(IPC.clipboardRead, () => {
    try {
      return clipboard.readText().trim()
    } catch {
      return ''
    }
  })

  // ---- yt-dlp engine ----
  ipcMain.handle(IPC.ytdlpEnsure, async () => {
    try {
      await ensureYtdlp()
    } catch {
      /* status already emitted */
    }
    return getYtdlpStatus()
  })
  ipcMain.handle(IPC.ytdlpUpdate, () => updateYtdlp())

  // ---- App updates ----
  ipcMain.handle(IPC.updateCheck, () => checkForUpdates())
  ipcMain.handle(IPC.updateDownload, () => downloadUpdate())
  ipcMain.handle(IPC.updateInstall, () => quitAndInstall())
  ipcMain.handle(IPC.updateOpenPage, () => openReleasesPage())

  // ---- App / window ----
  ipcMain.handle(IPC.appInfo, () => ({
    version: app.getVersion(),
    name: app.getName(),
    platform: process.platform,
    arch: process.arch,
    locale: app.getLocale(),
    manualUpdates: isManualPlatform(),
    ytdlp: getYtdlpStatus(),
    update: getUpdateStatus()
  }))
  // Window controls act on the window the call came from (main or search).
  ipcMain.handle(IPC.windowMinimize, (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.handle(IPC.windowMaximize, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })
  ipcMain.handle(IPC.windowClose, (e) => BrowserWindow.fromWebContents(e.sender)?.close())
  ipcMain.handle(
    IPC.windowIsMaximized,
    (e) => BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false
  )

  // ---- Built-in browser ----
  registerBrowserIpc()

  // ---- Forward service events to the renderer ----
  downloadEvents.on('progress', (p) => {
    send(IPC.evtDownloadProgress, p)
    syncOsState(getWindow)
  })
  downloadEvents.on('updated', (item: DownloadItem) => {
    send(IPC.evtDownloadUpdated, item)
    maybeNotify(item)
    syncOsState(getWindow)
  })
  downloadEvents.on('removed', (id: string) => {
    forgetNotified(id)
    send(IPC.evtDownloadUpdated, { id, removed: true })
    syncOsState(getWindow)
  })
  ytdlpEvents.on('status', (s) => send(IPC.evtYtdlpStatus, s))
  updateEvents.on('status', (s) => send(IPC.evtUpdateStatus, s))
}

/**
 * Ids already announced, so a re-emitted `completed` doesn't notify twice.
 *
 * Cleared when an item starts again (a retry is a fresh outcome) and when it
 * leaves the queue — without the second half this set grew for the lifetime of
 * the process, holding a string for every download ever finished.
 */
const notified = new Set<string>()

export function forgetNotified(id: string): void {
  notified.delete(id)
}

function maybeNotify(item: DownloadItem): void {
  const terminal = item.state === 'completed' || item.state === 'error'
  if (terminal && !notified.has(item.id)) {
    notified.add(item.id)
    if (getSettings().notifications && Notification.isSupported()) {
      const done = item.state === 'completed'
      const n = new Notification({
        title: done ? mt('notify.done') : mt('notify.failed'),
        body: item.title,
        silent: false
      })
      n.on('click', () => {
        if (done && item.filepath) shell.showItemInFolder(item.filepath)
        else getWindowForNotification()?.show()
      })
      n.show()
    }
  }
  if (item.state === 'downloading' || item.state === 'queued') notified.delete(item.id)
}

/** Set once IPC is registered, so a notification click can raise the window. */
let notificationWindow: () => BrowserWindow | null = () => null
function getWindowForNotification(): BrowserWindow | null {
  const win = notificationWindow()
  return win && !win.isDestroyed() ? win : null
}

/**
 * Everything the OS should know about the queue: the taskbar/dock progress bar,
 * and whether the machine is allowed to go to sleep. Both derive from the same
 * "is anything actually transferring" question, so they are answered together.
 */
function syncOsState(getWindow: () => BrowserWindow | null): void {
  const active = listDownloads().filter((d) => d.state === 'downloading' || d.state === 'processing')
  setKeepAwake(active.length > 0)

  const win = getWindow()
  if (!win || win.isDestroyed()) return
  if (!active.length) {
    win.setProgressBar(-1)
    return
  }
  const avg = active.reduce((sum, d) => sum + (d.percent || 0), 0) / active.length / 100
  win.setProgressBar(Math.max(0.02, Math.min(1, avg)))
}
