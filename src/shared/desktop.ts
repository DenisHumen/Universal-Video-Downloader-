/**
 * What the desktop says, parsed (A1.2 E2, E6). Pure, so it can be tested
 * without a GNOME session; services/desktop.ts does the (one-shot,
 * time-limited, shell-free) reading.
 */

export type CaptionButton = 'minimize' | 'maximize' | 'close'

export interface ButtonLayout {
  /** Caption buttons at the window's start, in order. */
  start: CaptionButton[]
  /** Caption buttons at the window's end, in order. */
  end: CaptionButton[]
}

/** GNOME's and Ubuntu's default (`:minimize,maximize,close`). */
export const DEFAULT_BUTTON_LAYOUT: ButtonLayout = { start: [], end: ['minimize', 'maximize', 'close'] }

const KNOWN = new Set<CaptionButton>(['minimize', 'maximize', 'close'])

/**
 * Parse `org.gnome.desktop.wm.preferences button-layout` as gsettings prints
 * it (`'appmenu:minimize,maximize,close'`). `appmenu`, `spacer`, `icon` and
 * anything unknown are ignored; a button named twice counts once; a value
 * that cannot be read gives the default. A layout with no close button at
 * all is not trusted either: the window must always be closable.
 */
export function parseButtonLayout(raw: string | undefined | null): ButtonLayout {
  const text = (raw ?? '').trim().replace(/^'|'$/g, '')
  if (!text.includes(':')) return DEFAULT_BUTTON_LAYOUT
  const [left, right] = text.split(':', 2)
  const seen = new Set<CaptionButton>()
  const side = (part: string): CaptionButton[] =>
    part
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is CaptionButton => KNOWN.has(s as CaptionButton) && !seen.has(s as CaptionButton) && Boolean(seen.add(s as CaptionButton)))
  const layout = { start: side(left), end: side(right) }
  return seen.has('close') ? layout : DEFAULT_BUTTON_LAYOUT
}

/**
 * The portal's `org.freedesktop.appearance accent-color` as `gdbus call`
 * prints it: `(<(0.207, 0.517, 0.894)>,)`. Strict: three numbers, each in
 * 0..1, or null. Returns `rrggbb`.
 */
export function parsePortalAccent(raw: string | undefined | null): string | null {
  const m = /^\(<\(([\d.]+), ([\d.]+), ([\d.]+)\)>,\)$/.exec((raw ?? '').trim())
  if (!m) return null
  const parts = m.slice(1, 4).map(Number)
  if (parts.some((v) => !Number.isFinite(v) || v < 0 || v > 1)) return null
  return parts.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
}

/**
 * Ubuntu's Yaru accents, read from each variant's gtk-4.0 theme on 24.04
 * (theme_selected_bg_color; values only, the GPL CSS is not copied: L3).
 * GNOME 46 has no accent key in the portal, so on Ubuntu the theme name is
 * how the desktop's accent is known (E2's optional nicety).
 */
export const YARU_ACCENTS: Record<string, string> = {
  '': 'e95420',
  bark: '787859',
  blue: '0073e5',
  magenta: 'b34cb3',
  olive: '4b8501',
  prussiangreen: '308280',
  purple: '7764d8',
  red: 'da3450',
  sage: '657b69',
  viridian: '03875b'
}

/** `'Yaru-blue-dark'` → `0073e5`; anything that is not Yaru → null. */
export function yaruAccent(raw: string | undefined | null): string | null {
  const name = (raw ?? '').trim().replace(/^'|'$/g, '').replace(/-dark$/, '')
  const m = /^Yaru(?:-([a-z]+))?$/.exec(name)
  if (!m) return null
  return YARU_ACCENTS[m[1] ?? ''] ?? null
}
