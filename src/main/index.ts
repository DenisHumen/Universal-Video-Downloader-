import {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  nativeTheme,
  shell,
  Tray,
  type MenuItemConstructorOptions
} from 'electron'
import { join } from 'path'
import { IPC } from '@shared/ipc'
import { registerIpc } from './ipc'
import { flushSettings, getSettings } from './services/settings'
import { ensureYtdlp, refreshEngineIfDue } from './services/ytdlp'
import { checkForUpdates, initUpdater } from './services/updater'
import {
  loadHistory,
  pauseAll,
  resumeAll,
  resumeInterrupted,
  shutdownDownloads,
  isEngineBusy
} from './services/downloader'
import { startClipboardWatch, stopClipboardWatch } from './services/clipboard'
import { currentLanguage, mt, type MainLanguage } from './services/locale'
import type { AppSettings, PendingDelivery } from '@shared/types'

const isMac = process.platform === 'darwin'
let mainWindow: BrowserWindow | null = null
let searchWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
/** The language the OS-level menus were last built in. */
let menuLanguage: MainLanguage | null = null

/**
 * An icon the running app can actually load.
 *
 * Not `build/` and not `assets/`: the first is electron-builder's
 * buildResources directory, which makes the installer and is deliberately not
 * copied into the app, and the second is excluded from the package explicitly.
 * Every icon here used to come from `build/icon.png`, which meant that in any
 * packaged build the path did not exist — and a missing path is not an error in
 * Electron, `nativeImage` simply returns an empty image. That is why the tray
 * was a blank square.
 *
 * `resources/` ships. The same relative path works from `out/main` in
 * development and from inside the asar in production.
 */
function iconPath(name: string): string {
  return join(__dirname, '../../resources/icons', name)
}

/**
 * Load an icon, and complain if it isn't there.
 *
 * This is the part that let the bug hide for so long: `createFromPath` treats a
 * missing file as an empty image rather than an error, so a wrong path produces
 * a blank tray square and complete silence in the log. Anything that ships an
 * asset and reads it back at runtime should say so when the asset is gone.
 */
function loadIcon(name: string): Electron.NativeImage {
  const image = nativeImage.createFromPath(iconPath(name))
  if (image.isEmpty()) {
    console.error(
      `Icon "${name}" could not be loaded from ${iconPath(name)} — ` +
        'it is missing from the package. Run `npm run make:icons`.'
    )
  }
  return image
}

/** Shared hardening for every app window. */
function wireWindow(win: BrowserWindow): void {
  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Never let the renderer navigate away from the app bundle.
  win.webContents.on('will-navigate', (event, url) => {
    /*
      The dev server's own URL is the one navigation this must allow, and
      only when there is one. The previous form defaulted to a NUL character
      as a "matches nothing" sentinel — which worked, and also made this file
      binary as far as git, grep and every diff tool are concerned.
    */
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    const isDev = Boolean(devUrl) && url.startsWith(devUrl as string)
    if (!isDev && !url.startsWith('file://')) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    }
  })

  // If the renderer ever crashes (GPU/OOM/…) the window turns into a black
  // rectangle until it's reloaded — do that reload automatically.
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason !== 'clean-exit' && !win.isDestroyed()) {
      win.webContents.reload()
    }
  })
}

function windowOptions(width: number, height: number): Electron.BrowserWindowConstructorOptions {
  return {
    width,
    height,
    minWidth: 760,
    minHeight: 560,
    show: false,
    backgroundColor: '#08080a',
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 18 } : undefined,
    icon: isMac ? undefined : loadIcon('app.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  }
}

function loadRenderer(win: BrowserWindow, hash?: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    win.loadURL(hash ? `${devUrl}#${hash}` : devUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({ ...windowOptions(1220, 820), minWidth: 940, minHeight: 640 })
  wireWindow(mainWindow)
  loadRenderer(mainWindow)

  mainWindow.on('close', (event) => {
    // With the tray enabled, closing the window just hides the app.
    if (!quitting && getSettings().trayEnabled && tray) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    // The next window has to ask for what it missed; this one cannot receive.
    rendererReady = false
  })
}

/*
  Messages the window was not ready for.

  IPC does not buffer. `showMainWindow()` creates the window and returns while
  the document is still loading, and even once it has loaded the renderer only
  subscribes at the end of its init, after three IPC round-trips. Everything
  sent in between was dropped on the floor with no second attempt: a link on the
  command line ("open with") was lost every single time, the menu's Settings and
  Search items opened a window showing Home, a second launch carrying a URL did
  nothing, and a link copied while no window was open was swallowed for good —
  the clipboard watcher had already recorded it as seen, so copying it again did
  nothing either.

  Anything undeliverable is parked here and collected by the window when it is
  ready. `rendererReady` is set by that collection, so it is the renderer
  itself saying so rather than main guessing from a load event.
*/
const pending: PendingDelivery = {}
let rendererReady = false

/** Hand something to the window, or hold it until there is one listening. */
function deliver(channel: string, slot: 'link' | 'view', value: string): void {
  const wc = mainWindow?.webContents
  if (rendererReady && wc && !wc.isDestroyed()) {
    wc.send(channel, value)
    return
  }
  pending[slot] = value
}

/** Everything main tried to say while nothing was listening. Clears it. */
export function takePending(): PendingDelivery {
  rendererReady = true
  const out: PendingDelivery = { ...pending }
  delete pending.link
  delete pending.view
  return out
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
}

/** Open (or focus) the title-search window, seeded with a query. */
export function openSearchWindow(query: string): void {
  if (searchWindow && !searchWindow.isDestroyed()) {
    if (searchWindow.isMinimized()) searchWindow.restore()
    searchWindow.focus()
    searchWindow.webContents.send(IPC.evtSearchQuery, query)
    return
  }
  searchWindow = new BrowserWindow(windowOptions(1060, 800))
  wireWindow(searchWindow)
  loadRenderer(searchWindow, `/search?q=${encodeURIComponent(query)}`)

  searchWindow.on('closed', () => {
    searchWindow = null
  })
}

/**
 * A real application menu. Without one, macOS has no Edit menu — which means no
 * ⌘C/⌘V/⌘A anywhere in the app — and no standard window shortcuts.
 */
function buildMenu(): void {
  const navigate = (view: string) => (): void => {
    showMainWindow()
    deliver(IPC.evtNavigate, 'view', view)
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.getName(),
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { label: `${mt('menu.settings')}…`, accelerator: 'Cmd+,', click: navigate('settings') },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: mt('menu.file'),
      submenu: [
        { label: mt('menu.newDownload'), accelerator: 'CmdOrCtrl+N', click: navigate('home') },
        { label: mt('menu.searchByTitle'), accelerator: 'CmdOrCtrl+F', click: navigate('search') },
        { type: 'separator' },
        ...(isMac
          ? ([{ role: 'close' }] as MenuItemConstructorOptions[])
          : ([
              { label: mt('menu.settings'), accelerator: 'Ctrl+,', click: navigate('settings') },
              { type: 'separator' },
              { role: 'quit' }
            ] as MenuItemConstructorOptions[]))
      ]
    },
    {
      label: mt('menu.edit'),
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: mt('menu.downloads'),
      submenu: [
        { label: mt('menu.queue'), accelerator: 'CmdOrCtrl+3', click: navigate('downloads') },
        { type: 'separator' },
        { label: mt('menu.pauseAll'), click: () => pauseAll() },
        { label: mt('menu.resumeAll'), click: () => resumeAll() }
      ]
    },
    {
      label: mt('menu.view'),
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      role: 'window',
      submenu: isMac
        ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
        : [{ role: 'minimize' }, { role: 'close' }]
    },
    {
      role: 'help',
      submenu: [
        {
          label: mt('menu.github'),
          click: () => shell.openExternal('https://github.com/DenisHumen/Universal-Video-Downloader-')
        },
        {
          label: mt('menu.issue'),
          click: () =>
            shell.openExternal('https://github.com/DenisHumen/Universal-Video-Downloader-/issues/new')
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  menuLanguage = currentLanguage()
}

function buildTray(): void {
  if (tray) return
  try {
    tray = new Tray(trayImage())
    tray.setToolTip('Universal Video Downloader')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: mt('tray.open'), click: showMainWindow },
        { type: 'separator' },
        { label: mt('menu.pauseAll'), click: () => pauseAll() },
        { label: mt('menu.resumeAll'), click: () => resumeAll() },
        { type: 'separator' },
        {
          label: mt('tray.quit'),
          click: () => {
            quitting = true
            app.quit()
          }
        }
      ])
    )
    tray.on('click', showMainWindow)
  } catch (err) {
    console.error('Tray unavailable', err)
  }
}

/**
 * The tray glyph for the current system theme.
 *
 * The tray takes its own mark, not the app icon: the app icon is a dark rounded
 * tile with a light mark on it, which at 16px is a smudge.
 *
 * On macOS one image is enough — a template image is recoloured by the system,
 * which reads only its alpha. Windows and Linux have no such concept, so a
 * white glyph simply disappears on a light taskbar and the app has to choose
 * the cut that contrasts with the theme in use.
 *
 * No `resize`: `createFromPath` picks up the `@2x`/`@3x` files beside it, so
 * the glyph is drawn at the display's scale factor rather than squeezed down
 * from a single bitmap.
 */
function trayImage(): Electron.NativeImage {
  const light = isMac || nativeTheme.shouldUseDarkColors
  const image = loadIcon(light ? 'tray.png' : 'tray-dark.png')
  image.setTemplateImage(isMac)
  return image
}

function destroyTray(): void {
  tray?.destroy()
  tray = null
}

function applySettings(settings: AppSettings): void {
  /*
    The application menu and the tray menu are built once from a dictionary, so
    switching the interface language left both of them in the old one until the
    app was restarted — the two pieces of the app that live outside the React
    tree were the two that ignored the setting.
  */
  if (currentLanguage() !== menuLanguage) {
    buildMenu()
    if (tray) {
      destroyTray()
      buildTray()
    }
  }

  if (settings.trayEnabled) buildTray()
  else destroyTray()

  if (settings.clipboardWatch) {
    startClipboardWatch((url) => deliver(IPC.evtClipboardLink, 'link', url))
  } else {
    stopClipboardWatch()
  }
}

/** A link handed to the app on the command line (e.g. "open with"). */
function linkFromArgv(argv: string[]): string | undefined {
  return argv.find((arg) => /^https?:\/\//i.test(arg))
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    showMainWindow()
    const link = linkFromArgv(argv)
    if (link) deliver(IPC.evtClipboardLink, 'link', link)
  })

  app.whenReady().then(() => {
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.denishumen.universalvideodownloader')
    }

    // Windows lets the taskbar flip between light and dark while we run.
    nativeTheme.on('updated', () => tray?.setImage(trayImage()))

    registerIpc({
      getWindow: () => mainWindow,
      openSearchWindow,
      onSettingsChanged: applySettings
    })
    loadHistory()
    initUpdater()
    buildMenu()
    createWindow()
    applySettings(getSettings())

    // Prepare the download engine in the background.
    ensureYtdlp().catch((err) => console.error('yt-dlp ensure failed:', err))

    /*
      Pick up whatever the last shutdown cut short.

      `loadHistory` parks anything that was mid-flight as paused so the app
      never starts by talking to a process that no longer exists — but nothing
      un-parked it, so closing the window during a download quietly stalled the
      queue until somebody noticed and pressed resume. Only items the shutdown
      itself paused come back; a download the user paused on purpose stays that
      way. Waits for the engine, since a resumed item needs it immediately.
    */
    if (getSettings().resumeOnLaunch) {
      void ensureYtdlp()
        .then(() => resumeInterrupted())
        .catch(() => undefined)
    }

    // Check for app updates a few seconds after launch.
    setTimeout(() => {
      if (getSettings().autoUpdate && app.isPackaged) {
        checkForUpdates().catch(() => undefined)
      }
    }, 5000)

    /*
      Refresh the download engine once a day, well after the window is up and
      only while nothing is using it. Sites change their players constantly, so
      a stale engine is a real failure mode — but swapping the binary out from
      under a running transfer is a worse one.
    */
    setTimeout(() => void refreshEngineIfDue(isEngineBusy), 30_000)

    const initialLink = linkFromArgv(process.argv)
    if (initialLink) pending.link = initialLink

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      else showMainWindow()
    })
  })

  app.on('before-quit', () => {
    quitting = true
    stopClipboardWatch()
    // Settings are written on a short delay so typing into a text field doesn't
    // rewrite the file per keystroke; a change made just before quitting is
    // still a change the user made.
    flushSettings()
    shutdownDownloads()
  })

  app.on('window-all-closed', () => {
    if (!isMac && !getSettings().trayEnabled) app.quit()
  })
}
