import type { ThemeId } from './types'

/**
 * The theme a window opens in, decided in main before the window exists.
 *
 * The renderer used to learn its theme from an async settings round-trip, so
 * a Day window painted one frame of Night first (the stylesheet's default),
 * on a window whose native background was hardcoded Night as well. Main now
 * hands the resolved theme to the sandboxed preload as a command-line switch
 * (`webPreferences.additionalArguments`: no sync IPC on the load path), the
 * preload stamps it on <html> before the document paints, and the window's
 * own `backgroundColor` is derived from the same value.
 */

export const THEME_ARG = '--uvd-theme='

/** A theme as painted: `system` is resolved by main before it gets here. */
export type PaintedTheme = 'night' | 'day'

/**
 * The window's native background per theme: `--bg` from index.css, as hex.
 * `theme-boot.test.ts` keeps these equal to the stylesheet.
 */
export const WINDOW_BACKGROUND: Record<PaintedTheme, string> = {
  night: '#0a0a0d',
  day: '#eeeef2'
}

export function themeArgument(theme: PaintedTheme): string {
  return `${THEME_ARG}${theme}`
}

/** The theme main passed in `argv`, or null when there is none (the browser preview). */
export function themeFromArgv(argv: readonly string[] | undefined): PaintedTheme | null {
  const arg = argv?.find((a) => a.startsWith(THEME_ARG))
  const value = arg?.slice(THEME_ARG.length)
  return value === 'night' || value === 'day' ? value : null
}

/** What a stored theme setting paints as, given whether the OS prefers dark. */
export function paintedTheme(theme: string | undefined, systemDark: boolean): PaintedTheme {
  if (theme === 'day' || theme === 'night') return theme
  return systemDark ? 'night' : 'day'
}
