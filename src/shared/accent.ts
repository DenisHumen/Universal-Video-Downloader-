/**
 * The accent: one saturated colour, now the user's choice (UVD 4.0, plan 2.2).
 *
 * 3.x carried a single blue after the redesign collapsed seven accents that
 * had never been designed per theme. 4.0 brings a choice back, but each accent
 * is a designed triple per theme rather than one hex: the *fill* (primary
 * buttons, selected states), the *ink* (accent-coloured text on a plane, a
 * lighter or darker cut of the same hue, because no fill clears 4.5:1 as text
 * on every plane), and the *label* set on the fill. index.css holds the values
 * under `[data-accent]`; scripts/check-contrast.mjs gates every one of them.
 *
 * `system` follows the OS accent (Windows and macOS report one) through
 * `deriveAccent`, which clamps it until it passes the same gate at runtime,
 * and falls back to Blue when it cannot.
 */

/** GNOME's nine accents (A1), with Ubuntu's Yaru orange in the orange slot and as the default (Y1). */
export const ACCENTS = ['orange', 'blue', 'teal', 'green', 'yellow', 'red', 'pink', 'purple', 'slate'] as const
export const DEFAULT_ACCENT = 'orange' as const

/** 4.0-alpha accents that GNOME's set renamed. */
export const RENAMED_ACCENTS: Record<string, AccentId> = { violet: 'purple', graphite: 'slate' }
export type AccentId = (typeof ACCENTS)[number]
export type AccentChoice = AccentId | 'system'
export const ACCENT_CHOICES: readonly AccentChoice[] = [...ACCENTS, 'system']

/** A stored accent as this build reads it: a renamed one is mapped, an unknown one is null. */
export function migrateAccent(value: unknown): AccentChoice | null {
  if (isAccentChoice(value)) return value
  return typeof value === 'string' ? (RENAMED_ACCENTS[value] ?? null) : null
}

export function isAccentChoice(value: unknown): value is AccentChoice {
  return typeof value === 'string' && (ACCENT_CHOICES as readonly string[]).includes(value)
}

export type Rgb = [number, number, number]

const lin = (c: number): number => {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}
export const luminance = ([r, g, b]: Rgb): number => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = luminance(a) >= luminance(b) ? [a, b] : [b, a]
  return (luminance(hi) + 0.05) / (luminance(lo) + 0.05)
}
const mix = (a: Rgb, b: Rgb, t: number): Rgb => a.map((c, i) => Math.round(c + (b[i] - c) * t)) as Rgb

/** `#rrggbb`, `rrggbbaa` (Electron's getAccentColor) or `r g b`, or null. */
export function parseColor(input: string | undefined | null): Rgb | null {
  if (!input) return null
  const s = input.trim()
  const triple = s.match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/)
  if (triple) return triple.slice(1, 4).map(Number) as Rgb
  const hex = s.replace(/^#/, '')
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return null
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb
}

export interface AccentTokens {
  fill: Rgb
  ink: Rgb
  fg: Rgb
}

const AA = 4.5
const WHITE: Rgb = [255, 255, 255]
const BLACK: Rgb = [0, 0, 0]

/**
 * Turn an arbitrary OS accent into a fill / ink / label triple that passes the
 * gate on this theme's planes, or null when it cannot be done without turning
 * it into a different colour (it then falls back to Blue).
 *
 * The label is white or `dark` (the theme's near-black), whichever reads
 * better; the fill is then nudged, a step at a time, away from the label until
 * the pair clears 4.5:1. The ink starts from the fill and moves towards white
 * in Night or black in Day until it clears 4.5:1 on every plane.
 */
export function deriveAccent(source: Rgb, planes: Rgb[], dark: Rgb, night: boolean): AccentTokens | null {
  if (!planes.length) return null
  const fg = contrast(source, WHITE) >= contrast(source, dark) ? WHITE : dark
  const away = fg === WHITE ? BLACK : WHITE
  let fill = source
  for (let step = 0; contrast(fill, fg) < AA; step++) {
    if (step > 20) return null
    fill = mix(source, away, (step + 1) * 0.03)
  }
  const toward = night ? WHITE : BLACK
  let ink = source
  for (let step = 0; Math.min(...planes.map((p) => contrast(ink, p))) < AA; step++) {
    if (step > 30) return null
    ink = mix(source, toward, (step + 1) * 0.03)
  }
  return { fill, ink, fg }
}
