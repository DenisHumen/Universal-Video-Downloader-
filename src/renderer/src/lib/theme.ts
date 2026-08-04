import type { AppSettings, ThemeId } from '@shared/types'
import { resolveLanguage, useI18n } from '../i18n'

/**
 * Themes live entirely in CSS variables, so switching one is a single attribute
 * change on <html> — instant, no re-render, no flash of the old palette.
 */
export function applyTheme(theme: ThemeId): void {
  document.documentElement.setAttribute('data-theme', theme)
}

/** Apply everything the shell derives from settings: palette + language. */
export function applyAppearance(settings: AppSettings, systemLocale: string): void {
  applyTheme(settings.theme)
  useI18n.getState().setLanguage(resolveLanguage(settings.language, systemLocale))
}
