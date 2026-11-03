import { nativeTheme, type BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { IPC } from '@shared/ipc'
import { WINDOW_BACKGROUND, paintedTheme, themeArgument } from '@shared/theme-boot'

const isMac = process.platform === 'darwin'

/**
 * The frame for a window that draws its own title bar.
 *
 * Every app window does: a 48px rule holding the logo, the window's controls
 * and, on Windows and Linux, the caption buttons. On macOS the traffic lights
 * stay native and sit inset in that rule; everywhere else there is no system
 * frame at all.
 *
 * The built-in browser's shell used to be left with the default frame, so on
 * Windows it showed the system title bar and the app menu above its own bar -
 * two sets of minimise, maximise and close, one under the other.
 */
export function chromeOptions(): Pick<
  BrowserWindowConstructorOptions,
  'frame' | 'titleBarStyle' | 'trafficLightPosition'
> {
  return {
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 18 } : undefined
  }
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
    win.webContents.send(IPC.evtNativeTheme)
  }
}
