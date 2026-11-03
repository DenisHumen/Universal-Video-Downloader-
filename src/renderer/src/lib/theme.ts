import type { AppSettings, ThemeId } from '@shared/types'
import { deriveAccent, parseColor, type Rgb } from '@shared/accent'
import { resolveLanguage, useI18n } from '../i18n'

/**
 * Themes live entirely in CSS variables, so switching one is a single attribute
 * change on <html> — instant, no re-render, no flash of the old palette.
 */
export function applyTheme(theme: ThemeId): void {
  document.documentElement.setAttribute('data-theme', theme)
}

const ACCENT_VARS = ['--accent', '--accent-ink', '--accent-fg'] as const
const PLANES = ['--bg', '--surface', '--surface-2', '--surface-3'] as const

/**
 * The accent is an attribute too (`[data-accent]` in index.css). `system` sets
 * the clamped OS colour inline on <html> and keeps `blue` underneath, which is
 * what shows wherever the OS reports none or its colour cannot be made to pass.
 */
export function applyAccent(accent: AppSettings['accent'] | undefined, systemAccent?: string): void {
  const root = document.documentElement
  for (const v of ACCENT_VARS) root.style.removeProperty(v)
  if (accent !== 'system') {
    root.setAttribute('data-accent', accent ?? 'blue')
    return
  }
  root.setAttribute('data-accent', 'blue')
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

/**
 * Translucent overlay material where the compositor can afford it (plan 2.4):
 * Windows and macOS. Linux stays opaque; backdrop-filter there is software.
 */
export function applyMaterial(platform: string | undefined): void {
  const translucent = platform === 'win32' || platform === 'darwin'
  document.documentElement.setAttribute('data-material', translucent ? 'translucent' : 'opaque')
}

/** Apply everything the shell derives from settings: palette, accent and language. */
export function applyAppearance(settings: AppSettings, systemLocale: string, systemAccent?: string): void {
  applyTheme(settings.theme)
  applyAccent(settings.accent, systemAccent)
  useI18n.getState().setLanguage(resolveLanguage(settings.language, systemLocale))
}
