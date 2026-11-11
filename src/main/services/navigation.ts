import { app, shell, type BrowserWindow } from 'electron'
import { join } from 'path'
import { log } from './log'
import { isRendererDocument, navigationVerdict, type RendererLocation } from './navigation-rules'

/**
 * The renderer's `index.html`.
 *
 * Every main-process module is bundled into the one `out/main/index.js`, so a
 * single `__dirname` serves all of them - the windows that load this file and
 * the checks that it is still the file they are showing.
 */
export function rendererIndex(): string {
  return join(__dirname, '../renderer/index.html')
}

/**
 * The dev server's address, in development only.
 *
 * The variable used to be read in the installed app too. Whoever could set it -
 * a changed launcher, a `.desktop` file - had every window load their page
 * with the full bridge, and every caller check accept that page as the app:
 * exactly what the fuses for RunAsNode and NODE_OPTIONS are there to prevent.
 */
export function devRendererUrl(): string | undefined {
  return app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'] || undefined
}

function rendererLocation(): RendererLocation {
  return {
    devUrl: devRendererUrl(),
    indexPath: rendererIndex(),
    platform: process.platform
  }
}

function schemeOf(url: string): string {
  return /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase() ?? 'none'
}

/**
 * Keep an app window on the app's own document.
 *
 * For every window that loads the renderer: the main window, the search window
 * and the built-in browser's shell (not the site view inside it, which is
 * meant to go anywhere and has no bridge). A web link is handed to `openLink`
 * - the system browser by default - and anything else is refused. The browser
 * shell had no such lock at all, so a link dropped on its media panel loaded a
 * remote page with the full preload bridge.
 */
export function wireNavigation(
  win: BrowserWindow,
  openLink: (url: string) => void = (url) => void shell.openExternal(url)
): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) openLink(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const verdict = navigationVerdict(url, win.webContents.getURL(), rendererLocation())
    if (verdict === 'allow') return
    event.preventDefault()
    if (verdict === 'external') openLink(url)
    else log.info('app', 'Kept a window from leaving the app', { scheme: schemeOf(url) })
  })
}

/**
 * Whether an IPC call came from the app's own document.
 *
 * Navigation is locked, so this should never fail. It is the second line for
 * the handlers that reach outside the app - open a path, open a link, rewrite
 * the settings - in case something ever gets a different document into a
 * window that has the bridge.
 */
export function fromRenderer(event: Electron.IpcMainInvokeEvent): boolean {
  try {
    const url = event.senderFrame?.url
    return Boolean(url) && isRendererDocument(url as string, rendererLocation())
  } catch {
    // The frame went away mid-call; nothing to answer anyway.
    return false
  }
}
