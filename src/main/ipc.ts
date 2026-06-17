import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppSettings, DownloadRequest } from '@shared/types'
import { detect } from './services/detector'
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

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  const send = (channel: string, payload: unknown): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }

  // ---- Media detection ----
  ipcMain.handle(IPC.detect, async (_e, url: string) => {
    await ensureYtdlp()
    return detect(url)
  })

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
  ipcMain.handle(IPC.windowMinimize, () => getWindow()?.minimize())
  ipcMain.handle(IPC.windowMaximize, () => {
    const win = getWindow()
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })
  ipcMain.handle(IPC.windowClose, () => getWindow()?.close())
  ipcMain.handle(IPC.windowIsMaximized, () => getWindow()?.isMaximized() ?? false)

  // ---- Forward service events to the renderer ----
  downloadEvents.on('progress', (p) => send(IPC.evtDownloadProgress, p))
  downloadEvents.on('updated', (item) => send(IPC.evtDownloadUpdated, item))
  downloadEvents.on('removed', (id) => send(IPC.evtDownloadUpdated, { id, removed: true }))
  ytdlpEvents.on('status', (s) => send(IPC.evtYtdlpStatus, s))
  updateEvents.on('status', (s) => send(IPC.evtUpdateStatus, s))
}
