import { create } from 'zustand'
import type {
  AppSettings,
  DetectPreview,
  DetectResult,
  DetectStatus,
  DownloadItem,
  DownloadProgress,
  UpdateStatus,
  YtDlpStatus
} from '@shared/types'
import { engineKnowsHost, normalizeUrl } from '@shared/urls'
import { watchFailing } from '@shared/automation'
import type { ImportOutcome } from '@shared/backup'
import type { AppInfo } from '../../preload/index'
import { applyDownloadsChanged } from './lib/downloads'
import { accessChanged, DetectCache, InflightDetects } from './lib/detectCache'
import { isProbablyUrl } from './lib/format'
import { applyAppearance } from './lib/theme'

/** Recent successful detects; see lib/detectCache.ts. Not state: nothing renders from it. */
export const detectCache = new DetectCache()

/** Adopt new settings' effect on remembered detects: cookies or a proxy can change the answer. */
function forgetDetectsIfAccessChanged(prev: AppSettings | null, next: AppSettings): void {
  if (prev && accessChanged(prev, next)) detectCache.clear()
}
/** Speculative detects Home can adopt rather than start again. */
export const inflightDetects = new InflightDetects()

/** The last oEmbed preview of each recent detect, by request id; see onDetectPreview. */
const previews = new Map<string, DetectPreview>()

function rememberPreview(p: DetectPreview): void {
  if (!p.requestId) return
  previews.delete(p.requestId)
  previews.set(p.requestId, p)
  // A handful: only a run still waiting to be adopted ever reads one back.
  while (previews.size > 8) previews.delete(previews.keys().next().value as string)
}

export type ViewId = 'home' | 'search' | 'downloads' | 'automation' | 'settings'

export interface WatchIntent {
  url: string
  translatorId?: string
  quality?: string
  /** The series is watched already: show that watch rather than offer to add another. */
  watchId?: string
}

const VIEWS: ViewId[] = ['home', 'search', 'downloads', 'automation', 'settings']

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
  /**
   * A series the home screen asked to follow, carried across to the watch
   * screen the same way a link is carried to Home: state, read on mount.
   */
  pendingWatch: WatchIntent | null
  /** Watched series whose last check failed - shown as a mark on the tab. */
  watchAlerts: number
  /** Live progress of the detector, so the UI can narrate the slow parts. */
  detect: DetectStatus | null
  /** The site's own title and poster for the link being detected, when it has one. */
  detectPreview: DetectPreview | null
  shortcutsOpen: boolean
  /** The sidebar as an overlay (below 860 px, or while Settings asks for room) is showing. */
  sidebarOverlayOpen: boolean
  /** Settings at 860-1099 px folds the app sidebar away so there is never a double rail (A1.1). */
  sidebarFolded: boolean
  /** Where Settings is: `<panel>[/<subpage>][#<row>]` (views/settings/router.ts). */
  settingsRoute: string

  init: () => Promise<void>
  setView: (view: ViewId) => void
  saveSettings: (partial: Partial<AppSettings>) => Promise<void>
  resetSettings: () => Promise<void>
  /** Pick a backup and merge it in. The settings it brings are adopted the way a save's are. */
  importBackup: () => Promise<ImportOutcome>
  refreshDownloads: () => Promise<void>
  dismissUpdate: () => void
  dismissClipboardLink: () => void
  setShortcutsOpen: (open: boolean) => void
  setSidebarOverlayOpen: (open: boolean) => void
  setSidebarFolded: (folded: boolean) => void
  /** Open Settings, at `route` or where it was last (Ctrl+, , About, Fix buttons, deep links). */
  openSettings: (route?: string) => void
  setSettingsRoute: (route: string) => void
  /** Home started detecting this link: its stage starts over, from resolving. */
  beginDetect: (url: string, requestId: string) => void
  /** Home stopped waiting - a result, an error, a cancel, or it went away. */
  endDetect: () => void
  /** Start detecting a link nobody has asked for yet, silently, so it is ready if they do. */
  prefetchDetect: (url: string) => void
  /** The link was turned down: stop the engine working on it. */
  cancelPrefetch: (url: string) => void
  /** Go to Home and detect this link. */
  requestDetect: (url: string) => void
  /** Go to Search and run this query. */
  requestSearch: (query: string) => void
  /** Go to the watch screen and offer this series, dub and quality preselected. */
  requestWatch: (intent: WatchIntent) => void
  takePendingWatch: () => WatchIntent | null
  refreshWatchAlerts: () => Promise<void>
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
  applyAppearance(settings, appInfo.locale, appInfo.systemAccent)
  set({
    appInfo,
    settings,
    downloads,
    ytdlp: appInfo.ytdlp,
    update: appInfo.update,
    ready: true
  })

  // One store update per batch, however many rows a bulk action touched.
  window.api.onDownloadsChanged((change) => {
    const list = get().downloads
    const next = applyDownloadsChanged(list, change)
    if (next !== list) set({ downloads: next })
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
  /*
    Only for the detect Home is waiting on. The stage used to be cleared on
    'done' alone, which most failure exits and every cancel never send - so
    the next link opened on the last one's "opening in the browser", and a
    cancelled detect still working its way out kept narrating over the new.
  */
  window.api.onDetectStatus((s) => {
    /*
      By request id alone. The url was compared too, but the field holds what
      was typed while an adopted prefetch was asked for in the clipboard's
      spelling of the same link, so its stages never matched. Ids are unique
      per run; an event without one belongs to no detect on screen.
    */
    const current = get().detect
    if (!current?.requestId || current.requestId !== s.requestId) return
    set({ detect: s.stage === 'done' ? null : { ...s, url: current.url } })
  })
  window.api.onDetectPreview((p) => {
    // Kept even when nobody is showing it yet: a prefetch's preview arrives
    // before Home adopts the run, and would otherwise be lost to skeletons.
    rememberPreview(p)
    const current = get().detect
    if (!current?.requestId || current.requestId !== p.requestId) return
    set({ detectPreview: p })
  })
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
  /*
    A watch that fails at four in the morning must be visible from every
    screen, not only from the one nobody is looking at. The count is what
    the tab draws; the list itself stays with the screen that shows it.
  */
  window.api.onAutomationChanged(() => void get().refreshWatchAlerts())
  void get().refreshWatchAlerts()
  /*
    And again whenever the window comes back - from the tray, from behind
    another app. Main now says when the schedule changes something, but a
    window that was hidden at the time is the one place a missed message
    would leave a stale mark, and one small refetch on focus is cheap.
  */
  window.addEventListener('focus', () => void get().refreshWatchAlerts())
  window.api.onNavigate((view) => {
    if (isViewId(view)) set({ view })
  })
  // The OS switched light/dark: a "system" theme and a clamped system accent repaint (E3a).
  window.api.onNativeTheme(() => {
    const settings = get().settings
    if (settings) applyAppearance(settings, get().appInfo?.locale ?? 'en', get().appInfo?.systemAccent)
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
  pendingWatch: null,
  watchAlerts: 0,
  detect: null,
  detectPreview: null,
  shortcutsOpen: false,
  sidebarOverlayOpen: false,
  sidebarFolded: false,
  settingsRoute: 'appearance',

  init: () => {
    if (!initPromise) initPromise = runInit(set, get)
    return initPromise
  },

  // Choosing a section closes the overlay sidebar, as GNOME's split view does.
  setView: (view) => set({ view, sidebarOverlayOpen: false }),

  saveSettings: async (partial) => {
    const next = await window.api.setSettings(partial)
    forgetDetectsIfAccessChanged(get().settings, next)
    applyAppearance(next, get().appInfo?.locale ?? 'en', get().appInfo?.systemAccent)
    set({ settings: next })
  },

  resetSettings: async () => {
    const next = await window.api.resetSettings()
    forgetDetectsIfAccessChanged(get().settings, next)
    applyAppearance(next, get().appInfo?.locale ?? 'en', get().appInfo?.systemAccent)
    set({ settings: next })
  },

  /*
    A backup can bring a theme and a language with it, so its settings take the
    same route a save's do. The watches it adds reach the watch screen through
    main's own broadcast, like any other change to the list.
  */
  importBackup: async () => {
    const outcome = await window.api.importBackup()
    if (outcome.ok) {
      forgetDetectsIfAccessChanged(get().settings, outcome.settings)
      applyAppearance(outcome.settings, get().appInfo?.locale ?? 'en', get().appInfo?.systemAccent)
      set({ settings: outcome.settings })
    }
    return outcome
  },

  refreshDownloads: async () => {
    const downloads = await window.api.listDownloads()
    set({ downloads })
  },

  dismissUpdate: () => set({ updateDismissed: true }),
  dismissClipboardLink: () => set({ clipboardLink: null }),
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
  setSidebarOverlayOpen: (open) => set({ sidebarOverlayOpen: open }),
  setSidebarFolded: (folded) => set({ sidebarFolded: folded }),
  openSettings: (route) =>
    set((s) => ({ view: 'settings', settingsRoute: route ?? s.settingsRoute, sidebarOverlayOpen: false })),
  setSettingsRoute: (route) => set({ settingsRoute: route }),
  beginDetect: (url, requestId) =>
    set({ detect: { stage: 'resolving', url, requestId }, detectPreview: previews.get(requestId) ?? null }),
  endDetect: () => {
    if (get().detect || get().detectPreview) set({ detect: null, detectPreview: null })
  },
  /*
    The clipboard strip is a strong hint the link is about to be wanted, and
    it sits on screen for as long as the user takes to read it. Detecting in
    that time means "use it" opens on a finished card. The engine run is the
    same one Home would have started; nothing is downloaded, and the stage
    and preview events it sends are ignored, because no detect on screen
    carries its request id until Home adopts it.
  */
  prefetchDetect: (url) => {
    // Hosts the engine reads by name only: anywhere else a detect may scrape or browse the page.
    if (!isProbablyUrl(url) || !engineKnowsHost(url) || detectCache.get(url) || inflightDetects.has(url)) return
    const requestId = `pre-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const promise = window.api
      .detect(url, requestId, { prefetch: true })
      .catch((err: unknown): DetectResult => ({ ok: false, error: String(err) }))
      .then((res) => {
        detectCache.set(url, res)
        return res
      })
    inflightDetects.add(url, { requestId, promise })
  },
  cancelPrefetch: (url) => {
    const pending = inflightDetects.take(url)
    if (pending) void window.api.cancelDetect(pending.requestId)
  },

  requestDetect: (url) => set({ pendingUrl: url, view: 'home' }),
  requestSearch: (query) => set({ pendingQuery: query, view: 'search' }),
  takePendingUrl: () => {
    const url = get().pendingUrl
    if (url) set({ pendingUrl: null })
    return url
  },
  requestWatch: (intent) => set({ pendingWatch: intent, view: 'automation' }),
  takePendingWatch: () => {
    const intent = get().pendingWatch
    if (intent) set({ pendingWatch: null })
    return intent
  },
  refreshWatchAlerts: async () => {
    const watches = await window.api.autoList()
    set({ watchAlerts: watches.filter(watchFailing).length })
  },
  takePendingQuery: () => {
    const query = get().pendingQuery
    if (query) set({ pendingQuery: null })
    return query
  }
}))
