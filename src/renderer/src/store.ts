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
  /*
    Work handed from one screen to another.

    This used to travel as a `window` CustomEvent, dispatched immediately after
    `setView`. React batches the state update, so the destination view had not
    mounted yet and its listener did not exist — the event went nowhere. Typing
    a title on the home screen and pressing search, which the subtitle
    advertises, landed you on an empty Search screen with the text gone; and
    "use it" on the clipboard strip, which is drawn on every screen, did
    nothing at all unless you happened to already be on Home.

    State survives the transition. The view reads it on mount and clears it.
  */
  pendingUrl: string | null
  pendingQuery: string | null
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
  /** Go to Home and detect this link. */
  requestDetect: (url: string) => void
  /** Go to Search and run this query. */
  requestSearch: (query: string) => void
  takePendingUrl: () => string | null
  takePendingQuery: () => string | null
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

  /*
    Collect anything main tried to hand us before this point. IPC does not
    buffer, and every subscription above is registered only after three awaited
    round-trips — so a link from the command line, from a second launch, or from
    the clipboard watcher while no window was open, and a view the application
    menu asked for, all arrived at a renderer that was not listening yet and
    were simply dropped. This is also what tells main the window is ready.
  */
  const missed = await window.api.takePending()
  if (missed.view && isViewId(missed.view)) set({ view: missed.view })
  if (missed.link) {
    const link = normalizeUrl(missed.link)
    if (!get().downloads.some((d) => normalizeUrl(d.sourceUrl || d.url) === link)) {
      set({ clipboardLink: missed.link })
    }
  }

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
  pendingUrl: null,
  pendingQuery: null,
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
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),

  requestDetect: (url) => set({ pendingUrl: url, view: 'home' }),
  requestSearch: (query) => set({ pendingQuery: query, view: 'search' }),
  takePendingUrl: () => {
    const url = get().pendingUrl
    if (url) set({ pendingUrl: null })
    return url
  },
  takePendingQuery: () => {
    const query = get().pendingQuery
    if (query) set({ pendingQuery: null })
    return query
  }
}))
