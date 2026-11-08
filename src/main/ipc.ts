import { buttonLayout, systemAccent } from './services/desktop'
import {
  countMissing,
  forgetEntry,
  forgetMissing,
  libraryEntry,
  locateFile,
  locateInFolder,
  missingFiles,
  onLibraryChanged,
  queryLibrary,
  trashEntry,
  trashFile
} from './services/library'
import type { LibraryQuery, LocateResult } from '@shared/library'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
  shell,
  type IpcMainInvokeEvent
} from 'electron'
import { dirname } from 'path'
import { IPC } from '@shared/ipc'
import type {
  AppSettings,
  DetectOptions,
  DetectResult,
  DetectStage,
  DownloadItem,
  DownloadRequest,
  EngineUpdateResult,
  MediaJobRequest,
  SearchScope
} from '@shared/types'
import { readClipboardText } from './services/clipboard'
import { detect } from './services/detector'
import { fetchOembed } from './services/oembed'
import { searchVideos } from './services/search'
import { probeMedia } from './services/ffmpeg'
import { fetchThumbnail } from './services/thumbnails'
import { registerBrowserIpc } from './services/browser'
import { acquireAwake, releaseAwake } from './services/awake'
import { mt } from './services/locale'
import { ACTION_LABEL, planNotification } from './services/notify-plan'
import {
  applyHistoryLimit,
  cancelDownload,
  clearFinished,
  clearFailed,
  downloadEvents,
  getDownload,
  listDownloads,
  relocateItem,
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
import { getSettings, proxyPasswordSaved, resetSettings, setSettings } from './services/settings'
import { exportBackup, importBackup } from './services/backup'
import type { ExportOutcome, ImportOutcome } from '@shared/backup'
import { forgetFailures, previewReport, sendReport } from './services/report'
import { getCliStatus, installCli } from './services/cli-install'
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
  ipcMain.handle(IPC.detect, async (event, url: string, requestId?: string, options?: DetectOptions): Promise<DetectResult> => {
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
        event.sender.send(IPC.evtDetectStatus, { stage, url, requestId })
      }
    }
    /*
      The card's top half, from the site itself, while the engine is still
      starting: a title and a poster in a few hundred ms instead of a
      skeleton for several seconds. Fire-and-forget, cancelled with the
      detect, and silent when it has nothing.
    */
    void fetchOembed(url, controller.signal).then((preview) => {
      if (preview && !controller.signal.aborted && !event.sender.isDestroyed()) {
        event.sender.send(IPC.evtDetectPreview, { ...preview, url, requestId })
      }
    })
    try {
      // A missing or broken engine is said in words, not thrown across IPC.
      const engineFailure = await engineUnavailable()
      if (engineFailure) return engineFailure
      if (controller.signal.aborted) return { ok: false, error: 'Detection canceled.', errorCode: 'canceled' }
      return await detect(url, report, controller.signal, { prefetch: options?.prefetch === true })
    } finally {
      if (requestId) detections.delete(requestId)
      // Every exit ends the narration, not only the ones the detector marks 'done'.
      report('done')
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
  ipcMain.handle(IPC.downloadClearFailed, () => clearFailed())
  ipcMain.handle(IPC.downloadList, () => listDownloads())

  // ---- Library (plan 5.3) ----
  ipcMain.handle(IPC.libraryList, (_e, q: LibraryQuery) => queryLibrary(q ?? {}))
  ipcMain.handle(IPC.libraryMissing, (event, paths: unknown) => {
    requireRenderer(event, IPC.libraryMissing)
    return missingFiles(Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : [])
  })
  ipcMain.handle(IPC.libraryTrash, (event, id: string) => {
    requireRenderer(event, IPC.libraryTrash)
    return trashEntry(String(id))
  })
  ipcMain.handle(IPC.libraryTrashFile, (event, filepath: string) => {
    requireRenderer(event, IPC.libraryTrashFile)
    return trashFile(String(filepath))
  })
  ipcMain.handle(IPC.libraryForget, (event, id: string) => {
    requireRenderer(event, IPC.libraryForget)
    return forgetEntry(String(id))
  })
  ipcMain.handle(IPC.libraryCountMissing, (event) => {
    requireRenderer(event, IPC.libraryCountMissing)
    return countMissing()
  })
  ipcMain.handle(IPC.libraryForgetMissing, (event) => {
    requireRenderer(event, IPC.libraryForgetMissing)
    return forgetMissing()
  })
  /*
    "Locate…". The renderer names the entry and nothing else: the path only ever
    comes out of this dialog, so a page in the window cannot point an entry - and
    with it Play and Delete File - at a file the person did not pick.
  */
  let lastLocateFolder: string | undefined
  ipcMain.handle(IPC.libraryLocate, async (event, id: unknown, how: unknown): Promise<LocateResult> => {
    requireRenderer(event, IPC.libraryLocate)
    const entry = libraryEntry(String(id))
    if (!entry) return { status: 'failed' }
    const byFile = how === 'file'
    const win = BrowserWindow.fromWebContents(event.sender) ?? getWindow() ?? undefined
    const picked = await dialog.showOpenDialog(win!, {
      defaultPath: lastLocateFolder ?? (getSettings().downloadDir || undefined),
      properties: byFile ? ['openFile'] : ['openDirectory']
    })
    if (picked.canceled || !picked.filePaths.length) return { status: 'canceled' }
    const path = picked.filePaths[0]
    lastLocateFolder = byFile ? dirname(path) : path
    const result = byFile ? await locateFile(entry.id, path) : await locateInFolder(entry.id, path)
    // A row still on the queue for this file follows it, or its Play goes on opening the old path.
    if (result.status === 'found' && getDownload(entry.id)?.filepath === entry.filepath) {
      relocateItem(entry.id, { filepath: result.path })
    }
    return result
  })
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
  /*
    The one way a change of settings takes effect, whether it came from the
    settings screen or from an imported backup - so an import reaches the tray,
    the watcher and the queue exactly as the switches on that screen do.
  */
  const changeSettings = async (partial: Partial<AppSettings>): Promise<AppSettings> => {
    const next = setSettings(partial)
    // A proxy password lifted out of the address is on disk before this answers.
    await proxyPasswordSaved()
    onSettingsChanged(next)
    // Reports off: drop the failures already kept for one, not just the offer.
    if (next.errorReports === 'off') forgetFailures()
    // The concurrency limit is read when the queue is pumped, and nothing
    // pumped it on a settings change — so raising it did nothing visible until
    // something happened to finish.
    kickQueue()
    // A lower limit applies now, not when the next download happens to finish.
    if (partial?.keepFinished !== undefined) applyHistoryLimit()
    return next
  }
  ipcMain.handle(IPC.settingsGet, () => getSettings())
  ipcMain.handle(IPC.settingsSet, (event, partial: Partial<AppSettings>) => {
    requireRenderer(event, IPC.settingsSet)
    return changeSettings(partial)
  })
  ipcMain.handle(IPC.settingsReset, async (event) => {
    requireRenderer(event, IPC.settingsReset)
    const next = resetSettings()
    await proxyPasswordSaved()
    onSettingsChanged(next)
    return next
  })

  // ---- Backup ----
  // An import rewrites the settings and the watch list, and an export writes them out.
  ipcMain.handle(IPC.backupExport, (event): Promise<ExportOutcome> => {
    requireRenderer(event, IPC.backupExport)
    return exportBackup(BrowserWindow.fromWebContents(event.sender) ?? getWindow() ?? undefined)
  })
  ipcMain.handle(IPC.backupImport, (event): Promise<ImportOutcome> => {
    requireRenderer(event, IPC.backupImport)
    return importBackup(
      BrowserWindow.fromWebContents(event.sender) ?? getWindow() ?? undefined,
      changeSettings
    )
  })

  // ---- Shell / dialogs ----
  /*
    Since Electron 43 a dialog without `defaultPath` opens in Downloads rather
    than wherever the OS last left it, so each picker starts from what it is
    about to replace.
  */
  ipcMain.handle(IPC.chooseDirectory, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? getWindow() ?? undefined
    const result = await dialog.showOpenDialog(win!, {
      defaultPath: getSettings().downloadDir || undefined,
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })
  ipcMain.handle(IPC.chooseCookiesFile, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? getWindow() ?? undefined
    const current = getSettings().cookiesFile
    const result = await dialog.showOpenDialog(win!, {
      defaultPath: current ? dirname(current) : undefined,
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
  ipcMain.handle(IPC.clipboardRead, () => readClipboardText())

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

  // ---- Terminal command ----
  ipcMain.handle(IPC.cliStatus, () => getCliStatus())
  // It writes outside the app's own folders, on a Mac as administrator.
  ipcMain.handle(IPC.cliInstall, (event) => {
    requireRenderer(event, IPC.cliInstall)
    return installCli()
  })

  // ---- App / window ----
  ipcMain.handle(IPC.appInfo, async () => ({
    version: app.getVersion(),
    name: app.getName(),
    platform: process.platform,
    arch: process.arch,
    locale: app.getLocale(),
    manualUpdates: isManualPlatform(),
    ytdlp: getYtdlpStatus(),
    update: getUpdateStatus(),
    // One-shot, time-limited desktop reads (services/desktop.ts, A1.2 E2/E6).
    systemAccent: await systemAccent(),
    buttonLayout: await buttonLayout()
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
  // Coalesced per turn, so a bulk action is one message, and progress per
  // PROGRESS_FLUSH_MS, so many downloads are one tick message; see queue-events.ts.
  forwardQueueEvents(downloadEvents, {
    changed: (batch) => send(IPC.evtDownloadsChanged, batch),
    progress: (batch) => send(IPC.evtDownloadProgress, batch),
    notify: maybeNotify,
    forget: forgetNotified,
    syncOs: () => syncOsState(getWindow)
  })
  onLibraryChanged(() => send(IPC.evtLibraryChanged, null))
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

/**
 * Notifications still on screen. Nothing else refers to one once `show()` has
 * returned, so the garbage collector could take it - and its click handler
 * with it - while it was still waiting to be clicked.
 */
const shown = new Set<Notification>()

export function forgetNotified(id: string): void {
  notified.delete(id)
}

function maybeNotify(item: DownloadItem): void {
  const terminal = item.state === 'completed' || item.state === 'error'
  if (terminal && !notified.has(item.id)) {
    notified.add(item.id)
    if (getSettings().notifications && Notification.isSupported()) {
      const plan = planNotification(process.platform, item)
      const n = new Notification({
        title: mt(plan.title),
        body: item.title,
        silent: false,
        actions: plan.actions.map((a) => ({ type: 'button' as const, text: mt(ACTION_LABEL[a]) }))
      })
      shown.add(n)
      // Everywhere: a click focuses the app on that row (6.4).
      n.on('click', () => {
        shown.delete(n)
        focusRow(item.id)
      })
      // macOS only: the buttons planNotification gave it.
      n.on('action', (_e, index) => {
        shown.delete(n)
        const action = plan.actions[index]
        if (action === 'play' && item.filepath) void shell.openPath(item.filepath)
        else if (action === 'showInFolder' && item.filepath) shell.showItemInFolder(item.filepath)
        else focusRow(item.id)
      })
      n.on('close', () => shown.delete(n))
      /*
        Since Electron 42 macOS posts through UNNotification, which refuses an
        app without a real signature (the ad-hoc sealed builds) and says so
        here instead of showing anything.
      */
      n.on('failed', (_e, error) => {
        shown.delete(n)
        log.warn('app', 'A notification could not be shown', { why: error })
      })
      n.show()
    }
  }
  if (item.state === 'downloading' || item.state === 'queued') notified.delete(item.id)
}

/** Raise the window and show the row a notification was about (Activity, with the row in view). */
function focusRow(id: string): void {
  const win = getWindowForNotification()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.webContents.send(IPC.evtFocusRow, id)
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

