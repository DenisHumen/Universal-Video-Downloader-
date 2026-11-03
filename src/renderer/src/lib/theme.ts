import type { AppSettings, ThemeId } from '@shared/types'
import { DEFAULT_ACCENT, deriveAccent, parseColor, type Rgb } from '@shared/accent'
import { paintedTheme } from '@shared/theme-boot'
import { resolveLanguage, useI18n } from '../i18n'

const DARK = '(prefers-color-scheme: dark)'
/** The listener that keeps `system` in step with the OS while it is chosen. */
let followSystem: (() => void) | null = null
let lastAccent: { accent: AppSettings['accent'] | undefined; system?: string } = { accent: undefined }

/**
 * Themes live entirely in CSS variables, so switching one is a single attribute
 * change on <html> — instant, no re-render, no flash of the old palette.
 *
 * `system` paints Night or Day from `prefers-color-scheme`, which Electron
 * drives from the OS (nativeTheme), and repaints when the OS switches.
 */
export function applyTheme(theme: ThemeId): void {
  const media = window.matchMedia(DARK)
  if (followSystem) {
    media.removeEventListener?.('change', followSystem)
    followSystem = null
  }
  const paint = (): void => {
    document.documentElement.setAttribute('data-theme', paintedTheme(theme, media.matches))
    // A clamped system accent depends on the planes it sits on.
    if (lastAccent.accent === 'system') applyAccent('system', lastAccent.system)
  }
  paint()
  if (theme === 'system') {
    followSystem = paint
    media.addEventListener?.('change', paint)
  }
}

const ACCENT_VARS = ['--accent', '--accent-ink', '--accent-fg'] as const
const PLANES = ['--bg', '--surface', '--surface-3', '--card', '--sidebar', '--sidebar-2'] as const

/**
 * The accent is an attribute too (`[data-accent]` in index.css). `system` sets
 * the clamped OS colour inline on <html> and keeps `blue` underneath, which is
 * what shows wherever the OS reports none or its colour cannot be made to pass.
 * Under 'system' that fallback is the default accent, Yaru orange.
 */
export function applyAccent(accent: AppSettings['accent'] | undefined, systemAccent?: string): void {
  lastAccent = { accent, system: systemAccent }
  const root = document.documentElement
  for (const v of ACCENT_VARS) root.style.removeProperty(v)
  if (accent !== 'system') {
    root.setAttribute('data-accent', accent ?? DEFAULT_ACCENT)
    return
  }
  root.setAttribute('data-accent', DEFAULT_ACCENT)
  const source = parseColor(systemAccent)
  if (!source) return
  const style = getComputedStyle(root)
  const planes = PLANES.map((p) => parseColor(style.getPropertyValue(p))).filter(Boolean) as Rgb[]
  const dark = parseColor(style.getPropertyValue('--bg')) ?? [10, 10, 13]
  const night = root.getAttribute('data-theme') !== 'day'
  const tokens = deriveAccent(source, planes, night ? dark : [12, 12, 16], night)
  if (!tokens) return
  root.style.setProperty('--accent', tokens.fill.join(' '))
  root.style.setProperty('--accent-ink', tokens.ink.join(' '))
  root.style.setProperty('--accent-fg', tokens.fg.join(' '))
}

/** Apply everything the shell derives from settings: palette, accent and language. */
export function applyAppearance(settings: AppSettings, systemLocale: string, systemAccent?: string): void {
  applyTheme(settings.theme)
  applyAccent(settings.accent, systemAccent)
  useI18n.getState().setLanguage(resolveLanguage(settings.language, systemLocale))
}
