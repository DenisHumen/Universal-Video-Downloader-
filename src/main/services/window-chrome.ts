import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'
import { IPC } from '@shared/ipc'

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
