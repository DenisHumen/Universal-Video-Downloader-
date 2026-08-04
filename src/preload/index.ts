import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AppSettings,
  BrowserMedia,
  BrowserState,
  DetectResult,
  DetectStatus,
  DownloadItem,
  DownloadProgress,
  DownloadRequest,
  MediaJobRequest,
  MediaProbe,
  SearchResponse,
  SearchScope,
  UpdateStatus,
  YtDlpStatus
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
}

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  // Detection
  detect: (url: string, requestId?: string): Promise<DetectResult> =>
    ipcRenderer.invoke(IPC.detect, url, requestId),
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
  resumeDownload: (id: string): Promise<void> => ipcRenderer.invoke(IPC.downloadResume, id),
  cancelDownload: (id: string): Promise<void> => ipcRenderer.invoke(IPC.downloadCancel, id),
  retryDownload: (id: string): Promise<void> => ipcRenderer.invoke(IPC.downloadRetry, id),
  removeDownload: (id: string): Promise<void> => ipcRenderer.invoke(IPC.downloadRemove, id),
  clearFinished: (): Promise<void> => ipcRenderer.invoke(IPC.downloadClearFinished),
  listDownloads: (): Promise<DownloadItem[]> => ipcRenderer.invoke(IPC.downloadList),
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

  pauseAll: (): Promise<void> => ipcRenderer.invoke(IPC.downloadPauseAll),
  resumeAll: (): Promise<void> => ipcRenderer.invoke(IPC.downloadResumeAll),
  retryFailed: (): Promise<void> => ipcRenderer.invoke(IPC.downloadRetryFailed),

  // Settings
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (partial: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.settingsSet, partial),
  resetSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsReset),

  // Shell / dialogs
  chooseDirectory: (): Promise<string | null> => ipcRenderer.invoke(IPC.chooseDirectory),
  chooseCookiesFile: (): Promise<string | null> => ipcRenderer.invoke(IPC.chooseCookiesFile),
  openPath: (path: string): Promise<string> => ipcRenderer.invoke(IPC.openPath, path),
  showInFolder: (path: string): Promise<void> => ipcRenderer.invoke(IPC.showInFolder, path),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.openExternal, url),
  readClipboard: (): Promise<string> => ipcRenderer.invoke(IPC.clipboardRead),

  // Engine
  ensureYtdlp: (): Promise<YtDlpStatus> => ipcRenderer.invoke(IPC.ytdlpEnsure),
  updateYtdlp: (): Promise<string | undefined> => ipcRenderer.invoke(IPC.ytdlpUpdate),

  // App updates
  checkForUpdates: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.updateCheck),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.updateDownload),
  installUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.updateInstall),
  openReleasesPage: (): Promise<void> => ipcRenderer.invoke(IPC.updateOpenPage),

  // App / window
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.appInfo),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke(IPC.windowMinimize),
  maximizeWindow: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowMaximize),
  closeWindow: (): Promise<void> => ipcRenderer.invoke(IPC.windowClose),
  isWindowMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowIsMaximized),

  // Events
  onDownloadProgress: (cb: (p: DownloadProgress) => void) =>
    on<DownloadProgress>(IPC.evtDownloadProgress, cb),
  onDownloadUpdated: (cb: (item: DownloadItem & { removed?: boolean }) => void) =>
    on<DownloadItem & { removed?: boolean }>(IPC.evtDownloadUpdated, cb),
  onYtdlpStatus: (cb: (s: YtDlpStatus) => void) => on<YtDlpStatus>(IPC.evtYtdlpStatus, cb),
  onUpdateStatus: (cb: (s: UpdateStatus) => void) => on<UpdateStatus>(IPC.evtUpdateStatus, cb),
  onDetectStatus: (cb: (s: DetectStatus) => void) => on<DetectStatus>(IPC.evtDetectStatus, cb),
  onClipboardLink: (cb: (url: string) => void) => on<string>(IPC.evtClipboardLink, cb),
  onNavigate: (cb: (view: string) => void) => on<string>(IPC.evtNavigate, cb)
}

export type UvdApi = typeof api

contextBridge.exposeInMainWorld('api', api)
