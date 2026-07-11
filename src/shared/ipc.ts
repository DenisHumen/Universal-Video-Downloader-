// Centralised IPC channel names, shared between main and preload.

export const IPC = {
  // invoke/handle
  detect: 'media:detect',
  search: 'media:search',
  searchOpenWindow: 'search:open-window',
  downloadStart: 'download:start',
  downloadPause: 'download:pause',
  downloadResume: 'download:resume',
  downloadCancel: 'download:cancel',
  downloadRetry: 'download:retry',
  downloadRemove: 'download:remove',
  downloadClearFinished: 'download:clear-finished',
  downloadList: 'download:list',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  chooseDirectory: 'dialog:choose-directory',
  openPath: 'shell:open-path',
  showInFolder: 'shell:show-in-folder',
  openExternal: 'shell:open-external',
  ytdlpEnsure: 'ytdlp:ensure',
  ytdlpUpdate: 'ytdlp:update',
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateInstall: 'update:install',
  appInfo: 'app:info',
  windowMinimize: 'window:minimize',
  windowMaximize: 'window:maximize',
  windowClose: 'window:close',
  windowIsMaximized: 'window:is-maximized',

  // events (main -> renderer)
  evtDownloadProgress: 'event:download-progress',
  evtDownloadUpdated: 'event:download-updated',
  evtYtdlpStatus: 'event:ytdlp-status',
  evtUpdateStatus: 'event:update-status',
  evtWindowState: 'event:window-state',
  evtSearchQuery: 'event:search-query'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
