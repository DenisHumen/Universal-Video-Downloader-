import type { ViewId } from '../store'
import type { TranslationKey } from '../i18n'
import { Download, FileVideo, ListVideo, Radar, Search, Settings, type IconComponent } from '../ui/icons'

/**
 * The 4.0 information architecture (plan 4.1).
 *
 *   Download · Search · Activity · Library · Watching   … (bottom) Settings
 *
 * Activity is work in progress (running, paused, queued, failed and what
 * finished today); the Library is every finished file, from its own store,
 * which clearing Activity never touches. Watching is the followed series.
 *
 * View ids stay as they were (`downloads`, `automation`): main sends them in
 * navigate events and older windows persist them, and only the names a person
 * reads have changed.
 */
export interface NavSection {
  id: ViewId
  label: TranslationKey
  icon: IconComponent
  /** Its Ctrl/⌘ key (lib/shortcuts.ts): 1..N in sidebar order; Settings is ','. */
  key: string
}

export const NAV_MAIN: NavSection[] = [
  { id: 'home', label: 'nav.home', icon: Download, key: '1' },
  { id: 'search', label: 'nav.search', icon: Search, key: '2' },
  { id: 'downloads', label: 'nav.queue', icon: ListVideo, key: '3' },
  { id: 'library', label: 'nav.library', icon: FileVideo, key: '4' },
  { id: 'automation', label: 'nav.automation', icon: Radar, key: '5' }
]

/** Pinned to the bottom of the sidebar. */
export const NAV_BOTTOM: NavSection[] = [{ id: 'settings', label: 'nav.settings', icon: Settings, key: ',' }]

export const NAV_ALL: NavSection[] = [...NAV_MAIN, ...NAV_BOTTOM]
