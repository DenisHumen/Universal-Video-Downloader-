import { nativeTheme, type BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { IPC } from '@shared/ipc'
import {
  HEADER_HEIGHT,
  WINDOW_BACKGROUND,
  WINDOW_FOREGROUND,
  paintedTheme,
  themeArgument
} from '@shared/theme-boot'

const isMac = process.platform === 'darwin'

/**
 * The frame for a window that draws its own header bar (A1.2 E6).
 *
 *  - Linux: no system frame; the app draws GNOME's round caption buttons in
 *    the order `button-layout` gives (services/desktop.ts). Never
 *    titleBarOverlay here.
 *  - Windows: `titleBarStyle: 'hidden'` + `titleBarOverlay` in the header's
 *    colours and height, so the system draws the caption buttons and Snap
 *    Layouts keep working; the renderer reserves the space with
 *    env(titlebar-area-*). Re-coloured on every theme change (followNativeTheme).
 *  - macOS: the native traffic lights, inset in the sidebar's header.
 */
export function chromeOptions(
  theme?: string
): Pick<BrowserWindowConstructorOptions, 'frame' | 'titleBarStyle' | 'trafficLightPosition' | 'titleBarOverlay'> {
  if (isMac) return { frame: true, titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 15 } }
  if (process.platform === 'win32') {
    return { titleBarStyle: 'hidden', titleBarOverlay: titleBarOverlay(theme) }
  }
  return { frame: false, titleBarStyle: 'default' }
}

/** Windows' caption overlay in the header's colours. */
export function titleBarOverlay(theme?: string): { color: string; symbolColor: string; height: number } {
  const painted = paintedTheme(theme, nativeTheme.shouldUseDarkColors)
  return { color: WINDOW_BACKGROUND[painted], symbolColor: WINDOW_FOREGROUND[painted], height: HEADER_HEIGHT }
}

/**
 * Tell the window's renderer whenever it is maximised or restored, however
 * that happened.
 *
 * The maximise button only learned the state from its own click, so a window
 * maximised by double-clicking the title bar, Win+Up or Snap kept offering to
 * maximise, with the matching glyph and label.
 */
export function forwardMaximized(win: BrowserWindow): void {
  const send = (): void => {
    if (!win.isDestroyed()) win.webContents.send(IPC.evtWindowState, win.isMaximized())
  }
  win.on('maximize', send)
  win.on('unmaximize', send)
}

/**
 * The theme a new window opens in: its native background, and the switch the
 * preload reads to stamp `data-theme` before first paint (see theme-boot.ts).
 * Spread `additionalArguments` into the window's `webPreferences`.
 */
export function themeOptions(theme: string | undefined): {
  backgroundColor: string
  additionalArguments: string[]
} {
  const painted = paintedTheme(theme, nativeTheme.shouldUseDarkColors)
  return { backgroundColor: WINDOW_BACKGROUND[painted], additionalArguments: [themeArgument(painted)] }
}

/** How long start-up waits for the OS colour scheme to arrive (E3a). */
export const THEME_SETTLE_MS = 200

/**
 * Wait, on Linux, for the colour scheme to be known before the first window
 * is made (plan amendment E3a).
 *
 * Under Electron 45 on GNOME, `nativeTheme.shouldUseDarkColors` is still false
 * at `whenReady` and turns true about 70 ms later, when the portal answers. A
 * window made in between opened in Day on a dark desktop: wrong background,
 * wrong boot theme. So start-up waits for that first `updated`, never longer
 * than `cap` (a desktop with no portal never sends one). Elsewhere the value
 * is right at `whenReady` and nothing waits.
 */
export function settleNativeTheme(
  source: { once(event: 'updated', cb: () => void): unknown; removeListener(event: 'updated', cb: () => void): unknown },
  platform: NodeJS.Platform,
  cap = THEME_SETTLE_MS
): Promise<void> {
  if (platform !== 'linux') return Promise.resolve()
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      source.removeListener('updated', done)
      resolve()
    }
    const timer = setTimeout(done, cap)
    source.once('updated', done)
  })
}

/**
 * Everything that follows the OS scheme, re-applied on each `updated`: every
 * window's native background, and a nudge to its renderer, which repaints a
 * "system" theme (and a clamped system accent) from it.
 */
export function followNativeTheme(
  windows: () => BrowserWindow[],
  theme: () => string | undefined
): void {
  const { backgroundColor } = themeOptions(theme())
  for (const win of windows()) {
    if (win.isDestroyed()) continue
    win.setBackgroundColor(backgroundColor)
    if (process.platform === 'win32') {
      try {
        win.setTitleBarOverlay(titleBarOverlay(theme()))
      } catch {
        /* a window made without an overlay */
      }
    }
    win.webContents.send(IPC.evtNativeTheme)
  }
}
