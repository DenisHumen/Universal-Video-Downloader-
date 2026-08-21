import { create } from 'zustand'
import type {
  AppSettings,
  DetectStatus,
  DownloadItem,
  DownloadProgress,
  UpdateStatus,
  YtDlpStatus
} from '@shared/types'
import { normalizeUrl } from '@shared/urls'
import type { AppInfo } from '../../preload/index'
import { applyAppearance } from './lib/theme'

export type ViewId = 'home' | 'search' | 'downloads' | 'settings'

const VIEWS: ViewId[] = ['home', 'search', 'downloads', 'settings']

export function isViewId(value: string): value is ViewId {
  return (VIEWS as string[]).includes(value)
}

interface AppState {
  ready: boolean
  view: ViewId
  appInfo: AppInfo | null
  settings: AppSettings | null
  downloads: DownloadItem[]
  ytdlp: YtDlpStatus
  update: UpdateStatus
  updateDismissed: boolean
  /** A link the user copied in another app, waiting to be accepted. */
  clipboardLink: string | null
  /** Live progress of the detector, so the UI can narrate the slow parts. */
  detect: DetectStatus | null
  shortcutsOpen: boolean

  init: () => Promise<void>
  setView: (view: ViewId) => void
  saveSettings: (partial: Partial<AppSettings>) => Promise<void>
  resetSettings: () => Promise<void>
  refreshDownloads: () => Promise<void>
  dismissUpdate: () => void
  dismissClipboardLink: () => void
  setShortcutsOpen: (open: boolean) => void
}

type SetState = (partial: Partial<AppState>) => void
type GetState = () => AppState

/**
 * `init` subscribes to main-process events, and those subscriptions must happen
 * exactly once. React 18 StrictMode mounts effects twice in development, which
 * would otherwise register a second set of listeners and apply every download
 * update twice.
 */
let initPromise: Promise<void> | null = null

async function runInit(set: SetState, get: GetState): Promise<void> {
  const [appInfo, settings, downloads] = await Promise.all([
    window.api.getAppInfo(),
    window.api.getSettings(),
    window.api.listDownloads()
  ])
  applyAppearance(settings, appInfo.locale)
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
      // Which half of the job is running, and whether it can say how far along
      // it is. Post-processing reports neither speed nor a percentage, so these
      // are what stop the row looking frozen.
      phase: p.phase,
      postprocess: p.postprocess,
      indeterminate: p.indeterminate,
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
      updateDismissed:
        s.state === 'available' && prev.version !== s.version ? false : get().updateDismissed
    })
  })
  window.api.onDetectStatus((s) => set({ detect: s.stage === 'done' ? null : s }))
  window.api.onClipboardLink((url) => {
    /*
      Ignore a link that's already in the queue — nothing new to offer.

      Compared in canonical form, because that is the form the queue stores. A
      video copied from a share button and the same video copied from the
      address bar are different strings and the same download; without this the
      prompt appeared for something already sitting three rows down.
    */
    const link = normalizeUrl(url)
    if (get().downloads.some((d) => normalizeUrl(d.sourceUrl || d.url) === link)) return
    set({ clipboardLink: url })
  })
  window.api.onNavigate((view) => {
    if (isViewId(view)) set({ view })
  })

  // Make sure the engine is ready.
  void window.api.ensureYtdlp().then((s) => set({ ytdlp: s }))
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
  clipboardLink: null,
  detect: null,
  shortcutsOpen: false,

  init: () => {
    if (!initPromise) initPromise = runInit(set, get)
    return initPromise
  },

  setView: (view) => set({ view }),

  saveSettings: async (partial) => {
    const next = await window.api.setSettings(partial)
    applyAppearance(next, get().appInfo?.locale ?? 'en')
    set({ settings: next })
  },

  resetSettings: async () => {
    const next = await window.api.resetSettings()
    applyAppearance(next, get().appInfo?.locale ?? 'en')
    set({ settings: next })
  },

  refreshDownloads: async () => {
    const downloads = await window.api.listDownloads()
    set({ downloads })
  },

  dismissUpdate: () => set({ updateDismissed: true }),
  dismissClipboardLink: () => set({ clipboardLink: null }),
  setShortcutsOpen: (open) => set({ shortcutsOpen: open })
}))
