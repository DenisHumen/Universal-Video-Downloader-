import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Notification,
  shell,
  type IpcMainInvokeEvent
} from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AppSettings,
  DetectResult,
  DetectStage,
  DownloadItem,
  DownloadRequest,
  EngineUpdateResult,
  MediaJobRequest,
  SearchScope
} from '@shared/types'
import { detect } from './services/detector'
import { searchVideos } from './services/search'
import { probeMedia } from './services/ffmpeg'
import { fetchThumbnail } from './services/thumbnails'
import { registerBrowserIpc } from './services/browser'
import { acquireAwake, releaseAwake } from './services/awake'
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
  kickQueue,
  isEngineBusy,
  retryFailed,
  startDownload,
  startMediaJob
} from './services/downloader'
import { forwardQueueEvents } from './services/queue-events'
import { getSettings, resetSettings, setSettings } from './services/settings'
import { forgetFailures, previewReport, sendReport } from './services/report'
import { isReportMailto } from '@shared/report'
import {
  EngineBusyError,
  engineUnavailable,
  ensureYtdlp,
  getYtdlpStatus,
  updateYtdlp,
  ytdlpEvents
} from './services/ytdlp'
import { takePending } from './index'
import { registerAutomationIpc } from './automation-ipc'
import { fromRenderer } from './services/navigation'
import { log } from './services/log'
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

/**
 * Refuse a call that did not come from the app's own document.
 *
 * Only for the handlers that reach outside the app: opening a path or a link,
 * and rewriting the settings, which decide the proxy every request goes
 * through, where files are written and which cookies the engine is handed. A
 * rejected promise rather than a quiet no-op, so anything legitimate that ever
 * trips this shows up as an error.
 */
function requireRenderer(event: IpcMainInvokeEvent, channel: string): void {
  if (fromRenderer(event)) return
  log.warn('app', 'Refused a call from a page that is not the app', { channel })
  throw new Error(`${channel} is only available to the app itself`)
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
  ipcMain.handle(IPC.detect, async (event, url: string, requestId?: string): Promise<DetectResult> => {
    /*
      Registered before the engine check, not after it. On first launch that
      check downloads the engine, and a cancel pressed meanwhile looked up an id
      nobody had registered yet - so it was lost, and the detection the user
      had walked away from started as soon as the download finished.
    */
    const controller = new AbortController()
    if (requestId) detections.set(requestId, controller)
    const report = (stage: DetectStage): void => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(IPC.evtDetectStatus, { stage, url })
      }
    }
    try {
      // A missing or broken engine is said in words, not thrown across IPC.
      const engineFailure = await engineUnavailable()
      if (engineFailure) return engineFailure
      if (controller.signal.aborted) return { ok: false, error: 'Detection canceled.', errorCode: 'canceled' }
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
  ipcMain.handle(IPC.settingsSet, (event, partial: Partial<AppSettings>) => {
    requireRenderer(event, IPC.settingsSet)
    const next = setSettings(partial)
    onSettingsChanged(next)
    // Reports off: drop the failures already kept for one, not just the offer.
    if (next.errorReports === 'off') forgetFailures()
    // The concurrency limit is read when the queue is pumped, and nothing
    // pumped it on a settings change — so raising it did nothing visible until
    // something happened to finish.
    kickQueue()
    return next
  })
  ipcMain.handle(IPC.settingsReset, (event) => {
    requireRenderer(event, IPC.settingsReset)
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
  ipcMain.handle(IPC.openPath, (event, path: string) => {
    requireRenderer(event, IPC.openPath)
    return shell.openPath(path)
  })
  ipcMain.handle(IPC.showInFolder, (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle(IPC.openExternal, (event, url: string) => {
    requireRenderer(event, IPC.openExternal)
    // Web pages, plus the one mailto an error report falls back to.
    if (!/^https?:\/\//i.test(url) && !isReportMailto(url)) return Promise.resolve()
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
  /*
    Settings used to tell a refusal apart by matching /engineBusy/ against the
    rejection's message. Electron sends only "Error invoking remote method
    'ytdlp:update': EngineBusyError: Pause or finish…" across, and that never
    contains the word in that case - so the advice to pause first was never
    shown, only "update failed". A refusal is an answer, so it returns as one.
  */
  ipcMain.handle(IPC.ytdlpUpdate, async (): Promise<EngineUpdateResult> => {
    try {
      return { ok: true, version: await updateYtdlp(isEngineBusy) }
    } catch (err) {
      if (err instanceof EngineBusyError) return { ok: false, code: 'engineBusy' }
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Whatever main tried to hand the window before it was listening.
  ipcMain.handle(IPC.takePending, () => takePending())

  // ---- Error reports ----
  // Both take an id main handed out; the window never supplies report contents.
  ipcMain.handle(IPC.reportPreview, (_e, id: string) => previewReport(id))
  ipcMain.handle(IPC.reportSend, (_e, id: string) => sendReport(id))

  registerAutomationIpc()

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
  // Coalesced per turn, so a bulk action is one message; see queue-events.ts.
  forwardQueueEvents(downloadEvents, {
    changed: (batch) => send(IPC.evtDownloadsChanged, batch),
    progress: (p) => send(IPC.evtDownloadProgress, p),
    notify: maybeNotify,
    forget: forgetNotified,
    syncOs: () => syncOsState(getWindow)
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
 *
 * This is only the queue's hold on the machine. An automated episode takes its
 * own once its download is done, for the upload and the message after it,
 * since nothing here hears about either.
 */
function syncOsState(getWindow: () => BrowserWindow | null): void {
  const active = listDownloads().filter((d) => d.state === 'downloading' || d.state === 'processing')
  if (active.length > 0) acquireAwake('queue')
  else releaseAwake('queue')

  const win = getWindow()
  if (!win || win.isDestroyed()) return
  if (!active.length) {
    win.setProgressBar(-1)
    return
  }
  const avg = active.reduce((sum, d) => sum + (d.percent || 0), 0) / active.length / 100
  win.setProgressBar(Math.max(0.02, Math.min(1, avg)))
}
