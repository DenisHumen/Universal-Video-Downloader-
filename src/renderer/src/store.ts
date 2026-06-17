import { create } from 'zustand'
import type {
  AppSettings,
  DownloadItem,
  DownloadProgress,
  UpdateStatus,
  YtDlpStatus
} from '@shared/types'
import type { AppInfo } from '../../preload/index'

export type ViewId = 'home' | 'downloads' | 'settings'

interface AppState {
  ready: boolean
  view: ViewId
  appInfo: AppInfo | null
  settings: AppSettings | null
  downloads: DownloadItem[]
  ytdlp: YtDlpStatus
  update: UpdateStatus
  updateDismissed: boolean

  init: () => Promise<void>
  setView: (view: ViewId) => void
  saveSettings: (partial: Partial<AppSettings>) => Promise<void>
  refreshDownloads: () => Promise<void>
  dismissUpdate: () => void
}

export const useStore = create<AppState>((set, get) => ({
  ready: false,
  view: 'home',
  appInfo: null,
  settings: null,
  downloads: [],
  ytdlp: { state: 'idle' },
  update: { state: 'idle' },
  updateDismissed: false,

  init: async () => {
    const [appInfo, settings, downloads] = await Promise.all([
      window.api.getAppInfo(),
      window.api.getSettings(),
      window.api.listDownloads()
    ])
    set({
      appInfo,
      settings,
      downloads,
      ytdlp: appInfo.ytdlp,
      update: appInfo.update,
      ready: true
    })

    window.api.onDownloadUpdated((item) => {
      const list = get().downloads
      if ((item as { removed?: boolean }).removed) {
        set({ downloads: list.filter((d) => d.id !== item.id) })
        return
      }
      const idx = list.findIndex((d) => d.id === item.id)
      if (idx === -1) {
        set({ downloads: [item, ...list] })
      } else {
        const next = [...list]
        next[idx] = { ...next[idx], ...item }
        set({ downloads: next })
      }
    })

    window.api.onDownloadProgress((p: DownloadProgress) => {
      const list = get().downloads
      const idx = list.findIndex((d) => d.id === p.id)
      if (idx === -1) return
      const next = [...list]
      next[idx] = {
        ...next[idx],
        state: p.state,
        percent: p.percent,
        speed: p.speed,
        eta: p.eta,
        downloadedBytes: p.downloadedBytes,
        totalBytes: p.totalBytes
      }
      set({ downloads: next })
    })

    window.api.onYtdlpStatus((s) => set({ ytdlp: s }))
    window.api.onUpdateStatus((s) => {
      const prev = get().update
      set({
        update: s,
        updateDismissed: s.state === 'available' && prev.version !== s.version ? false : get().updateDismissed
      })
    })

    // Make sure the engine is ready.
    window.api.ensureYtdlp().then((s) => set({ ytdlp: s }))
  },

  setView: (view) => set({ view }),

  saveSettings: async (partial) => {
    const next = await window.api.setSettings(partial)
    set({ settings: next })
  },

  refreshDownloads: async () => {
    const downloads = await window.api.listDownloads()
    set({ downloads })
  },

  dismissUpdate: () => set({ updateDismissed: true })
}))
