import type { TranslationKey } from '../../i18n'
import type { IconComponent } from '../../ui/icons'
import { Alarm, Appearance, ChannelSecure, Computer, Download, Multimedia, NetworkWired, SystemSearch } from '../../ui/icons'

/**
 * Settings' routes (D8, A1.1 §2): `<panel>[/<subpage>[/<subpage>]][#<row>]`,
 * e.g. `network/proxy`, `downloads#saveLocation`, `system/about/legal`.
 * The Fix buttons, first-run, Ctrl+K and the queue's "Change folder" all
 * deep-link through this, so a row's id is part of the contract.
 */

export type PanelId =
  | 'appearance'
  | 'downloads'
  | 'processing'
  | 'watching'
  | 'detection'
  | 'access'
  | 'network'
  | 'system'

export interface Panel {
  id: PanelId
  title: TranslationKey
  icon: IconComponent
  /** GNOME separates its list into groups with a line; 1 is above it, 2 below. */
  group: 1 | 2
}

export const PANELS: Panel[] = [
  { id: 'appearance', title: 'prefs.panel.appearance', icon: Appearance, group: 1 },
  { id: 'downloads', title: 'prefs.panel.downloads', icon: Download, group: 1 },
  { id: 'processing', title: 'prefs.panel.processing', icon: Multimedia, group: 1 },
  { id: 'watching', title: 'prefs.panel.watching', icon: Alarm, group: 1 },
  { id: 'detection', title: 'prefs.panel.detection', icon: SystemSearch, group: 2 },
  { id: 'access', title: 'prefs.panel.access', icon: ChannelSecure, group: 2 },
  { id: 'network', title: 'prefs.panel.network', icon: NetworkWired, group: 2 },
  { id: 'system', title: 'prefs.panel.system', icon: Computer, group: 2 }
]

/** Subpages, by their path under the panel. */
export const SUBPAGES: Record<string, TranslationKey> = {
  'watching/shares': 'prefs.sub.shares',
  'watching/telegram': 'prefs.sub.telegram',
  'access/cookies-file': 'prefs.sub.cookiesFile',
  'access/passwords': 'prefs.sub.passwords',
  'access/import': 'prefs.sub.importSignIns',
  'network/proxy': 'prefs.sub.proxy',
  'system/startup': 'prefs.sub.startup',
  'system/updates': 'prefs.sub.updates',
  'system/backup': 'prefs.sub.backup',
  'system/logs': 'prefs.sub.logs',
  'system/about': 'prefs.sub.about',
  'system/about/troubleshooting': 'prefs.sub.troubleshooting',
  'system/about/credits': 'prefs.sub.credits',
  'system/about/legal': 'prefs.sub.legal'
}

export interface Route {
  panel: PanelId
  /** Path segments under the panel: [] for the panel itself. */
  sub: string[]
  /** A row to scroll to and pulse. */
  row?: string
}

const isPanel = (s: string): s is PanelId => PANELS.some((p) => p.id === s)

/** A route string as a Route; anything unknown falls back to the nearest page that exists. */
export function parseRoute(text: string | undefined): Route {
  const [path, row] = (text ?? '').split('#', 2)
  const [panel, ...sub] = path.split('/').filter(Boolean)
  if (!panel || !isPanel(panel)) return { panel: 'appearance', sub: [] }
  // Keep only the leading subpages that exist.
  const kept: string[] = []
  for (const seg of sub) {
    if (!SUBPAGES[[panel, ...kept, seg].join('/')]) break
    kept.push(seg)
  }
  return { panel, sub: kept, row: row || undefined }
}

export function formatRoute(r: Route): string {
  return [r.panel, ...r.sub].join('/') + (r.row ? `#${r.row}` : '')
}

/** The route one level up: a subpage's parent, or the panel itself. */
export function parentRoute(r: Route): Route {
  return { panel: r.panel, sub: r.sub.slice(0, -1) }
}

/** The title key of each page on the way down: panel, then each subpage. */
export function trail(r: Route): TranslationKey[] {
  const panel = PANELS.find((p) => p.id === r.panel)!
  return [panel.title, ...r.sub.map((_, i) => SUBPAGES[[r.panel, ...r.sub.slice(0, i + 1)].join('/')])]
}
