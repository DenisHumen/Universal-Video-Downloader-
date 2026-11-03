import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { systemPreferences } from 'electron'
import {
  DEFAULT_BUTTON_LAYOUT,
  parseButtonLayout,
  parsePortalAccent,
  yaruAccent,
  type ButtonLayout
} from '@shared/desktop'
import { log } from './log'

/*
  The desktop's caption order and accent (A1.2 E2, E6), read once each:
  at most one `execFile` per question, no shell, a short timeout, no
  long-lived child (no `gdbus monitor`). Any failure is the default. The
  colour scheme itself comes from nativeTheme, which follows the portal.
*/

const TIMEOUT_MS = 2000

/** Inside Flatpak or a snap the host's gsettings and portal answers are not ours to read this way. */
function sandboxed(): boolean {
  return Boolean(process.env.FLATPAK_ID || process.env.SNAP) || existsSync('/.flatpak-info')
}

function run(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
        resolve(err ? null : String(stdout))
      })
    } catch {
      resolve(null)
    }
  })
}

let layout: Promise<ButtonLayout> | null = null

/** Linux only: `org.gnome.desktop.wm.preferences button-layout`. Elsewhere the default. */
export function buttonLayout(): Promise<ButtonLayout> {
  if (!layout) {
    layout =
      process.platform !== 'linux' || sandboxed()
        ? Promise.resolve(DEFAULT_BUTTON_LAYOUT)
        : run('gsettings', ['get', 'org.gnome.desktop.wm.preferences', 'button-layout']).then(parseButtonLayout)
  }
  return layout
}

let accent: Promise<string | undefined> | null = null

/**
 * The OS accent as `rrggbb`, or undefined, which hides "System" in the accent
 * picker (E2). Windows and macOS: getAccentColor. Linux: the portal's
 * accent-color (GNOME 47+); failing that, Ubuntu's Yaru variant from the GTK
 * theme name (GNOME 46 has no accent key: the user's machine).
 */
export function systemAccent(): Promise<string | undefined> {
  if (!accent) accent = readAccent()
  return accent
}

async function readAccent(): Promise<string | undefined> {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    try {
      return systemPreferences.getAccentColor().slice(0, 6) || undefined
    } catch {
      return undefined
    }
  }
  if (process.platform !== 'linux' || sandboxed()) return undefined
  const portal = parsePortalAccent(
    await run('gdbus', [
      'call',
      '--session',
      '--dest',
      'org.freedesktop.portal.Desktop',
      '--object-path',
      '/org/freedesktop/portal/desktop',
      '--method',
      'org.freedesktop.portal.Settings.ReadOne',
      'org.freedesktop.appearance',
      'accent-color'
    ])
  )
  if (portal) return portal
  const yaru = yaruAccent(await run('gsettings', ['get', 'org.gnome.desktop.interface', 'gtk-theme']))
  if (!yaru) log.info('desktop', 'No system accent: the portal has none and the theme is not Yaru')
  return yaru ?? undefined
}
