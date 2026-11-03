import type { ViewId } from '../store'
import type { TranslationKey } from '../i18n'
import { Download, ListVideo, Radar, Search, Settings, type IconComponent } from '../ui/icons'

/**
 * The 4.0 information architecture (plan 4.1).
 *
 *   Download · Search · Activity · Library · Watching   … (bottom) Settings
 *
 * Activity is the old "queue": work in progress. Watching is the old "watch"
 * (followed series). Library, every finished file from a persistent index,
 * arrives with its store in 5.3; until then it is not shown, and Activity
 * keeps its "done" filter (plan [v2] UX-3), so nothing is unreachable.
 *
 * View ids stay as they were (`downloads`, `automation`): main sends them in
 * navigate events and older windows persist them, and only the names a person
 * reads have changed.
 */
export interface NavSection {
  id: ViewId
  label: TranslationKey
  icon: IconComponent
  /** The digit of its Ctrl/⌘ shortcut (lib/shortcuts.ts). */
  key: string
}

export const NAV_MAIN: NavSection[] = [
  { id: 'home', label: 'nav.home', icon: Download, key: '1' },
  { id: 'search', label: 'nav.search', icon: Search, key: '2' },
  { id: 'downloads', label: 'nav.queue', icon: ListVideo, key: '3' },
  { id: 'automation', label: 'nav.automation', icon: Radar, key: '4' }
]

/** Pinned to the bottom of the sidebar. */
export const NAV_BOTTOM: NavSection[] = [{ id: 'settings', label: 'nav.settings', icon: Settings, key: '5' }]

export const NAV_ALL: NavSection[] = [...NAV_MAIN, ...NAV_BOTTOM]
