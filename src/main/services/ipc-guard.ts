import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { log } from './log'
import { fromRenderer } from './navigation'

/*
  Every channel the window calls, with one check in front.

  A handler used to get the check only if somebody thought it reached outside the
  app. Starting a download, testing a share and listing saved logins were not on
  that list, and each is worth having to a page that gets into a window with the
  bridge. The check does not depend on what the handler does, so it is not left to
  each handler to remember. What the built-in browser's own pages send has its own
  channels, on `ipcMain.on`, and is not this.
*/
export const guardedIpc = {
  // The same shape as `ipcMain.handle`, whose arguments are whatever the other side sent.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown): void {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!fromRenderer(event)) {
        log.warn('app', 'Refused a call from a page that is not the app', { channel })
        throw new Error(`${channel} is only available to the app itself`)
      }
      return listener(event, ...args)
    })
  }
}
