import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppSettings, DownloadItem, DownloadRequest, SearchScope } from '@shared/types'
import { detect } from './services/detector'
import { searchVideos } from './services/search'
import {
  cancelDownload,
  clearFinished,
  downloadEvents,
  listDownloads,
  pauseDownload,
  removeDownload,
  resumeDownload,
  retryDownload,
  startDownload
} from './services/downloader'
import { getSettings, setSettings } from './services/settings'
import { ensureYtdlp, getYtdlpStatus, updateYtdlp, ytdlpEvents } from './services/ytdlp'
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateStatus,
  quitAndInstall,
  updateEvents
} from './services/updater'

export function registerIpc(
  getWindow: () => BrowserWindow | null,
  openSearchWindow: (query: string) => void
): void {
  const send = (channel: string, payload: unknown): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }

  // ---- Media detection & search ----
  ipcMain.handle(IPC.detect, async (_e, url: string) => {
    await ensureYtdlp()
    return detect(url)
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

  // ---- Settings ----
  ipcMain.handle(IPC.settingsGet, () => getSettings())
  ipcMain.handle(IPC.settingsSet, (_e, partial: Partial<AppSettings>) => setSettings(partial))

  // ---- Shell / dialogs ----
  ipcMain.handle(IPC.chooseDirectory, async () => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })
  ipcMain.handle(IPC.openPath, (_e, path: string) => shell.openPath(path))
  ipcMain.handle(IPC.showInFolder, (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle(IPC.openExternal, (_e, url: string) => shell.openExternal(url))

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

  // ---- App / window ----
  ipcMain.handle(IPC.appInfo, () => ({
    version: app.getVersion(),
    name: app.getName(),
    platform: process.platform,
    arch: process.arch,
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

  // ---- Forward service events to the renderer ----
  downloadEvents.on('progress', (p) => {
    send(IPC.evtDownloadProgress, p)
    updateTaskbarProgress(getWindow)
  })
  downloadEvents.on('updated', (item: DownloadItem) => {
    send(IPC.evtDownloadUpdated, item)
    maybeNotify(item)
    updateTaskbarProgress(getWindow)
  })
  downloadEvents.on('removed', (id) => {
    send(IPC.evtDownloadUpdated, { id, removed: true })
    updateTaskbarProgress(getWindow)
  })
  ytdlpEvents.on('status', (s) => send(IPC.evtYtdlpStatus, s))
  updateEvents.on('status', (s) => send(IPC.evtUpdateStatus, s))
}

const notified = new Set<string>()

function maybeNotify(item: DownloadItem): void {
  if (item.state === 'completed' && !notified.has(item.id)) {
    notified.add(item.id)
    if (Notification.isSupported()) {
      const n = new Notification({
        title: 'Download complete',
        body: item.title,
        silent: false
      })
      n.on('click', () => {
        if (item.filepath) shell.showItemInFolder(item.filepath)
      })
      n.show()
    }
  }
  if (item.state === 'downloading') notified.delete(item.id)
}

function updateTaskbarProgress(getWindow: () => BrowserWindow | null): void {
  const win = getWindow()
  if (!win || win.isDestroyed()) return
  const active = listDownloads().filter((d) => d.state === 'downloading' || d.state === 'processing')
  if (!active.length) {
    win.setProgressBar(-1)
    return
  }
  const avg = active.reduce((sum, d) => sum + (d.percent || 0), 0) / active.length / 100
  win.setProgressBar(Math.max(0.02, Math.min(1, avg)))
}
