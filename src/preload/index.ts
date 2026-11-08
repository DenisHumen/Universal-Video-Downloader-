import type { AddedWatch, CheckSummary, RetryAnswer, Run, ShareFolderPick, SmbTarget, Watch } from '@shared/automation'
import type { ReportPreview, SendOutcome } from '@shared/report'
import type { ExportOutcome, ImportOutcome } from '@shared/backup'
import type { SeriesOffer } from '../main/automation-ipc'
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import { themeFromArgv } from '@shared/theme-boot'
import type { ButtonLayout } from '@shared/desktop'
import type { LibraryPage, LibraryQuery } from '@shared/library'
import type {
  AppSettings,
  BrowserLoginOffer,
  BrowserMedia,
  BrowserState,
  CliInstallResult,
  CliStatus,
  DetectResult,
  DetectOptions,
  DetectPreview,
  DetectStatus,
  DownloadItem,
  DownloadProgress,
  DownloadRequest,
  DownloadsChanged,
  EngineUpdateResult,
  MediaJobRequest,
  MediaProbe,
  PendingDelivery,
  SearchResponse,
  SearchScope,
  ShareSendProgress,
  ShareSendRequest,
  ShareSendResult,
  UpdateStatus,
  YtDlpStatus,
  SavedSiteLogins,
  SignInImport
} from '@shared/types'

export interface AppInfo {
  version: string
  name: string
  platform: NodeJS.Platform
  arch: string
  locale: string
  /** This build can't self-install updates (unsigned macOS, .deb/.rpm). */
  manualUpdates: boolean
  ytdlp: YtDlpStatus
  update: UpdateStatus
  /** The OS accent colour as `rrggbb`, where the desktop reports one (hides "System" when absent). */
  systemAccent?: string
  /** GNOME's caption-button order (Linux; the default elsewhere). */
  buttonLayout: ButtonLayout
}

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  // Detection
  detect: (url: string, requestId?: string, options?: DetectOptions): Promise<DetectResult> =>
    ipcRenderer.invoke(IPC.detect, url, requestId, options),
  cancelDetect: (requestId: string): Promise<void> => ipcRenderer.invoke(IPC.detectCancel, requestId),

  // Title search
  searchVideos: (query: string, scope: SearchScope, limit?: number): Promise<SearchResponse> =>
    ipcRenderer.invoke(IPC.search, query, scope, limit),
  openSearchWindow: (query: string): Promise<void> => ipcRenderer.invoke(IPC.searchOpenWindow, query),
  onSearchQuery: (cb: (query: string) => void) => on<string>(IPC.evtSearchQuery, cb),

  // Downloads
  startDownload: (req: DownloadRequest): Promise<DownloadItem> =>
    ipcRenderer.invoke(IPC.downloadStart, req),
  pauseDownload: (id: string): Promise<void> => ipcRenderer.invoke(IPC.downloadPause, id),
  stopLiveRecording: (id: string): Promise<void> => ipcRenderer.invoke(IPC.downloadStopLive, id),
  downloadLog: (id: string): Promise<string> => ipcRenderer.invoke(IPC.downloadLog, id),
  shareSend: (request: ShareSendRequest): Promise<ShareSendResult> => ipcRenderer.invoke(IPC.shareSend, request),
  onShareSendProgress: (cb: (progress: ShareSendProgress) => void) =>
    on<ShareSendProgress>(IPC.evtShareSendProgress, cb),
  resumeDownload: (id: string): Promise<void> => ipcRenderer.invoke(IPC.downloadResume, id),
  cancelDownload: (id: string): Promise<void> => ipcRenderer.invoke(IPC.downloadCancel, id),
  retryDownload: (id: string): Promise<void> => ipcRenderer.invoke(IPC.downloadRetry, id),
  removeDownload: (id: string): Promise<void> => ipcRenderer.invoke(IPC.downloadRemove, id),
  clearFinished: (): Promise<void> => ipcRenderer.invoke(IPC.downloadClearFinished),
  clearFailed: (): Promise<void> => ipcRenderer.invoke(IPC.downloadClearFailed),
  listDownloads: (): Promise<DownloadItem[]> => ipcRenderer.invoke(IPC.downloadList),
  // Library (plan 5.3)
  listLibrary: (q: LibraryQuery): Promise<LibraryPage> => ipcRenderer.invoke(IPC.libraryList, q),
  libraryMissing: (paths: string[]): Promise<string[]> => ipcRenderer.invoke(IPC.libraryMissing, paths),
  trashLibraryEntry: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.libraryTrash, id),
  forgetLibraryEntry: (id: string): Promise<void> => ipcRenderer.invoke(IPC.libraryForget, id),
  onLibraryChanged: (cb: () => void) => on<null>(IPC.evtLibraryChanged, () => cb()),
  // Local media jobs (trim / convert)
  startMediaJob: (req: MediaJobRequest): Promise<DownloadItem> =>
    ipcRenderer.invoke(IPC.mediaJobStart, req),
  probeMedia: (path: string): Promise<MediaProbe> => ipcRenderer.invoke(IPC.mediaProbe, path),
  /** Re-fetch a poster with proper headers when the direct <img> load fails. */
  fetchThumbnail: (url: string, pageUrl?: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.mediaThumbnail, url, pageUrl),

  // Built-in browser
  openBrowser: (url?: string): Promise<void> => ipcRenderer.invoke(IPC.browserOpen, url),
  browserNavigate: (url: string): Promise<void> => ipcRenderer.invoke(IPC.browserNavigate, url),
  browserBack: (): Promise<void> => ipcRenderer.invoke(IPC.browserBack),
  browserForward: (): Promise<void> => ipcRenderer.invoke(IPC.browserForward),
  browserReload: (): Promise<void> => ipcRenderer.invoke(IPC.browserReload),
  browserStop: (): Promise<void> => ipcRenderer.invoke(IPC.browserStop),
  browserSetBounds: (bounds: { x: number; y: number; width: number; height: number }): Promise<void> =>
    ipcRenderer.invoke(IPC.browserSetBounds, bounds),
  browserSetPick: (enabled: boolean): Promise<void> => ipcRenderer.invoke(IPC.browserSetPick, enabled),
  browserClearMedia: (): Promise<void> => ipcRenderer.invoke(IPC.browserClearMedia),
  browserDownload: (target: { mediaId?: string; url?: string }): Promise<DownloadItem | null> =>
    ipcRenderer.invoke(IPC.browserDownload, target),
  browserRefreshState: (): Promise<void> => ipcRenderer.invoke(IPC.browserState),
  onBrowserState: (cb: (state: BrowserState) => void) => on<BrowserState>(IPC.evtBrowserState, cb),
  onBrowserMedia: (cb: (media: BrowserMedia[]) => void) => on<BrowserMedia[]>(IPC.evtBrowserMedia, cb),
  onBrowserQueued: (cb: () => void) => on<void>(IPC.evtBrowserQueued, () => cb()),
  onBrowserLoginOffer: (cb: (offer: BrowserLoginOffer) => void) =>
    on<BrowserLoginOffer>(IPC.evtBrowserLoginOffer, cb),
  browserLoginAnswer: (answer: 'save' | 'never' | 'dismiss'): Promise<void> =>
    ipcRenderer.invoke(IPC.browserLoginAnswer, answer),
  browserLogins: (): Promise<SavedSiteLogins[]> => ipcRenderer.invoke(IPC.browserLogins),
  /** One site's saved passwords, or every site's with no origin. */
  browserForgetLogins: (origin?: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.browserForgetLogins, origin),
  browserSignOut: (): Promise<void> => ipcRenderer.invoke(IPC.browserSignOut),
  browserImportSignIns: (browser: string): Promise<SignInImport> =>
    ipcRenderer.invoke(IPC.browserImportSignIns, browser),

  pauseAll: (): Promise<void> => ipcRenderer.invoke(IPC.downloadPauseAll),
  resumeAll: (): Promise<void> => ipcRenderer.invoke(IPC.downloadResumeAll),
  retryFailed: (): Promise<void> => ipcRenderer.invoke(IPC.downloadRetryFailed),
  prioritizeDownload: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC.downloadPrioritize, id),

  // Settings
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (partial: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.settingsSet, partial),
  resetSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsReset),
  /** Both open a file dialog in main; `canceled` is what closing it answers. */
  exportBackup: (): Promise<ExportOutcome> => ipcRenderer.invoke(IPC.backupExport),
  importBackup: (): Promise<ImportOutcome> => ipcRenderer.invoke(IPC.backupImport),

  // Shell / dialogs
  chooseDirectory: (): Promise<string | null> => ipcRenderer.invoke(IPC.chooseDirectory),
  chooseCookiesFile: (): Promise<string | null> => ipcRenderer.invoke(IPC.chooseCookiesFile),
  openPath: (path: string): Promise<string> => ipcRenderer.invoke(IPC.openPath, path),
  showInFolder: (path: string): Promise<void> => ipcRenderer.invoke(IPC.showInFolder, path),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.openExternal, url),
  readClipboard: (): Promise<string> => ipcRenderer.invoke(IPC.clipboardRead),

  // Engine
  ensureYtdlp: (): Promise<YtDlpStatus> => ipcRenderer.invoke(IPC.ytdlpEnsure),
  updateYtdlp: (): Promise<EngineUpdateResult> => ipcRenderer.invoke(IPC.ytdlpUpdate),
  takePending: (): Promise<PendingDelivery> => ipcRenderer.invoke(IPC.takePending),

  // Error reports — by id; null when main no longer holds that failure.
  reportPreview: (id: string): Promise<ReportPreview | null> => ipcRenderer.invoke(IPC.reportPreview, id),
  reportSend: (id: string): Promise<SendOutcome> => ipcRenderer.invoke(IPC.reportSend, id),

  // ---- Automation ----
  autoDescribe: (url: string): Promise<SeriesOffer> => ipcRenderer.invoke(IPC.autoDescribe, url),
  autoList: (): Promise<Watch[]> => ipcRenderer.invoke(IPC.autoList),
  autoRuns: (watchId: string): Promise<Run[]> => ipcRenderer.invoke(IPC.autoRuns, watchId),
  autoAdd: (watch: Omit<Watch, 'id' | 'createdAt'>): Promise<AddedWatch> =>
    ipcRenderer.invoke(IPC.autoAdd, watch),
  autoUpdate: (id: string, patch: Partial<Watch>): Promise<Watch | undefined> =>
    ipcRenderer.invoke(IPC.autoUpdate, id, patch),
  autoRemove: (id: string): Promise<void> => ipcRenderer.invoke(IPC.autoRemove, id),
  autoCheckNow: (id: string): Promise<CheckSummary> => ipcRenderer.invoke(IPC.autoCheckNow, id),
  autoRetryRun: (runId: string): Promise<RetryAnswer> => ipcRenderer.invoke(IPC.autoRetryRun, runId),
  autoTestSmb: (target: SmbTarget, password: string): Promise<string> =>
    ipcRenderer.invoke(IPC.autoTestSmb, target, password),
  /** The system folder dialog, answered with the share the folder is on. */
  autoChooseShareFolder: (current: SmbTarget, title: string): Promise<ShareFolderPick> =>
    ipcRenderer.invoke(IPC.autoChooseShareFolder, current, title),
  /** The folders under one folder of a share, by the app's own SMB connection. */
  autoListShareFolders: (target: SmbTarget, password: string, folder: string): Promise<string[]> =>
    ipcRenderer.invoke(IPC.autoListShareFolders, target, password, folder),
  /** Make a folder on a share; answers with its share-relative path. */
  autoCreateShareFolder: (target: SmbTarget, password: string, parent: string, name: string): Promise<string> =>
    ipcRenderer.invoke(IPC.autoCreateShareFolder, target, password, parent, name),
  autoTestTelegram: (token: string, chatId: string): Promise<string> =>
    ipcRenderer.invoke(IPC.autoTestTelegram, token, chatId),
  /** One way. There is no channel that reads a secret back. */
  autoSetSecret: (kind: 'smb' | 'telegram' | 'proxy', id: string, value: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.autoSetSecret, kind, id, value),
  autoSecretState: (): Promise<{
    telegram: boolean
    smb: Record<string, boolean>
    proxy: boolean
    persists: boolean
  }> => ipcRenderer.invoke(IPC.autoSecretState),
  getLogPath: (): Promise<string> => ipcRenderer.invoke(IPC.logPath),
  onAutomationChanged: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on(IPC.evtAutoChanged, handler)
    return () => ipcRenderer.removeListener(IPC.evtAutoChanged, handler)
  },

  // App updates
  checkForUpdates: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.updateCheck),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.updateDownload),
  installUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.updateInstall),
  openReleasesPage: (): Promise<void> => ipcRenderer.invoke(IPC.updateOpenPage),

  // Terminal command
  cliStatus: (): Promise<CliStatus> => ipcRenderer.invoke(IPC.cliStatus),
  /** May show the system's password prompt on a Mac; resolves once it is answered. */
  cliInstall: (): Promise<CliInstallResult> => ipcRenderer.invoke(IPC.cliInstall),

  // App / window
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.appInfo),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke(IPC.windowMinimize),
  maximizeWindow: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowMaximize),
  closeWindow: (): Promise<void> => ipcRenderer.invoke(IPC.windowClose),
  isWindowMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowIsMaximized),
  /** Every maximise and restore, including the ones the caption button did not cause. */
  onMaximizedChange: (cb: (maximized: boolean) => void) => on<boolean>(IPC.evtWindowState, cb),
  /** The OS switched light/dark (main's nativeTheme). */
  onNativeTheme: (cb: () => void) => on<void>(IPC.evtNativeTheme, cb),

  // Events
  /** The latest tick of every download that moved, one message per ~120 ms (queue-events.ts). */
  onDownloadProgress: (cb: (batch: DownloadProgress[]) => void) =>
    on<DownloadProgress[]>(IPC.evtDownloadProgress, cb),
  /** Updated and removed entries, one message per turn of the main process. */
  onDownloadsChanged: (cb: (change: DownloadsChanged) => void) =>
    on<DownloadsChanged>(IPC.evtDownloadsChanged, cb),
  onYtdlpStatus: (cb: (s: YtDlpStatus) => void) => on<YtDlpStatus>(IPC.evtYtdlpStatus, cb),
  onUpdateStatus: (cb: (s: UpdateStatus) => void) => on<UpdateStatus>(IPC.evtUpdateStatus, cb),
  onDetectStatus: (cb: (s: DetectStatus) => void) => on<DetectStatus>(IPC.evtDetectStatus, cb),
  onDetectPreview: (cb: (p: DetectPreview) => void) => on<DetectPreview>(IPC.evtDetectPreview, cb),
  onClipboardLink: (cb: (url: string) => void) => on<string>(IPC.evtClipboardLink, cb),
  onAutoDownload: (cb: (title: string) => void) => on<string>(IPC.evtAutoDownload, cb),
  onPasteLink: (cb: (url: string) => void) => on<string>(IPC.evtPasteLink, cb),
  onNavigate: (cb: (view: string) => void) => on<string>(IPC.evtNavigate, cb),
  onFocusRow: (cb: (id: string) => void) => on<string>(IPC.evtFocusRow, cb)
}

export type UvdApi = typeof api

contextBridge.exposeInMainWorld('api', api)

/*
  The theme, before first paint. Main resolved it and passed it as a switch
  (see theme-boot.ts); the stylesheet's default is Night, so without this a
  Day window flashed dark until the async settings call came back.
*/
const bootTheme = themeFromArgv(process.argv)
if (bootTheme) {
  const stamp = (): void => document.documentElement?.setAttribute('data-theme', bootTheme)
  stamp()
  // The preload can run before <html> exists; stamp again as soon as it does.
  document.addEventListener('readystatechange', stamp, { once: true })
}
