import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AppSettings,
  DetectResult,
  DownloadItem,
  DownloadProgress,
  DownloadRequest,
  UpdateStatus,
  YtDlpStatus
} from '@shared/types'

export interface AppInfo {
  version: string
  name: string
  platform: NodeJS.Platform
  arch: string
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
  detect: (url: string): Promise<DetectResult> => ipcRenderer.invoke(IPC.detect, url),

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

  // Settings
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (partial: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.settingsSet, partial),

  // Shell / dialogs
  chooseDirectory: (): Promise<string | null> => ipcRenderer.invoke(IPC.chooseDirectory),
  openPath: (path: string): Promise<string> => ipcRenderer.invoke(IPC.openPath, path),
  showInFolder: (path: string): Promise<void> => ipcRenderer.invoke(IPC.showInFolder, path),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.openExternal, url),

  // Engine
  ensureYtdlp: (): Promise<YtDlpStatus> => ipcRenderer.invoke(IPC.ytdlpEnsure),
  updateYtdlp: (): Promise<string | undefined> => ipcRenderer.invoke(IPC.ytdlpUpdate),

  // App updates
  checkForUpdates: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.updateCheck),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.updateDownload),
  installUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.updateInstall),

  // App / window
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.appInfo),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke(IPC.windowMinimize),
  maximizeWindow: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowMaximize),
  closeWindow: (): Promise<void> => ipcRenderer.invoke(IPC.windowClose),
  isWindowMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowIsMaximized),

  // Events
  onDownloadProgress: (cb: (p: DownloadProgress) => void) => on(IPC.evtDownloadProgress, cb),
  onDownloadUpdated: (cb: (item: DownloadItem & { removed?: boolean }) => void) =>
    on(IPC.evtDownloadUpdated, cb),
  onYtdlpStatus: (cb: (s: YtDlpStatus) => void) => on(IPC.evtYtdlpStatus, cb),
  onUpdateStatus: (cb: (s: UpdateStatus) => void) => on(IPC.evtUpdateStatus, cb)
}

export type UvdApi = typeof api

contextBridge.exposeInMainWorld('api', api)
