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
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { IPC } from '@shared/ipc'
import { registerIpc } from './ipc'
import { flushSettings, getSettings } from './services/settings'
import { applyProxy } from './services/proxy'
import { answerProxyLoginsForPages } from './services/proxy-auth'
import { ensureYtdlp, scheduleEngineRefresh } from './services/ytdlp'
import { initUpdater, scheduleUpdateChecks } from './services/updater'
import { flushLog, initLog, log, setLogLevel } from './services/log'
import { flushWatches } from './services/automation/store'
import { startWatcher, stopWatcher } from './services/automation/watcher'
import {
  autostartDesktopEntry,
  autostartNeedsApplying,
  HIDDEN_FLAG,
  shouldStartHidden
} from './services/autostart'
import {
  loadHistory,
  pauseAll,
  resumeAll,
  resumeInterrupted,
  shutdownDownloads,
  isEngineBusy
} from './services/downloader'
import { startClipboardWatch, stopClipboardWatch } from './services/clipboard'
import { rendererIndex, wireNavigation } from './services/navigation'
import { currentLanguage, mt, type MainLanguage } from './services/locale'
import type { AppSettings, PendingDelivery } from '@shared/types'
import { cliArgvFrom } from './cli/format'
import { startCli } from './cli/run'

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

/**
 * Shared hardening for every app window. `showWhenReady` is false only for a
 * main window that is meant to stay in the tray until somebody opens it.
 */
function wireWindow(win: BrowserWindow, showWhenReady = true): void {
  if (showWhenReady) win.on('ready-to-show', () => win.show())

  // Never let the renderer navigate away from the app's own document.
  wireNavigation(win)

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
      /*
        These are the windows holding the bridge, and they were the ones
        running without the OS sandbox while the site view and the hidden
        sniffer had it. The preload is one bundled file that needs nothing but
        `contextBridge` and `ipcRenderer`, both of which work sandboxed; the
        smoke script checks that the bridge still arrives.
      */
      sandbox: true,
      spellcheck: false
    }
  }
}

function loadRenderer(win: BrowserWindow, hash?: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    win.loadURL(hash ? `${devUrl}#${hash}` : devUrl)
  } else {
    win.loadFile(rendererIndex(), hash ? { hash } : undefined)
  }
}

/**
 * Build the main window. `hidden` loads it without showing it, for a launch at
 * login; the tray, a second launch and the dock all go through
 * `showMainWindow`, which shows it like any window hidden to the tray.
 */
function createWindow(hidden = false): void {
  mainWindow = new BrowserWindow({ ...windowOptions(1220, 820), minWidth: 940, minHeight: 640 })
  wireWindow(mainWindow, !hidden)
  loadRenderer(mainWindow)

  mainWindow.on('close', (event) => {
    /*
      With the tray enabled, closing the window just hides the app. Background
      watching keeps a tray icon too (see applySettings), so it hides as well
      rather than leaving a process with no window and no icon. Hidden is not
      the same as watching, though: without background watching, closing the
      window stops the schedules, as the switch's hint says it does.
    */
    const settings = getSettings()
    if (!quitting && (settings.trayEnabled || settings.automationEnabled) && tray) {
      event.preventDefault()
      mainWindow?.hide()
      if (!settings.automationEnabled) stopWatcher()
    }
  })

  // Schedules run whenever the window is up, however it came back: the tray,
  // a second launch, a notification, the dock.
  mainWindow.on('show', () => startWatcher())

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

/** What start-with-system was last set to this session; nothing yet at launch. */
let appliedAutostart: boolean | undefined

/**
 * The arguments the Windows login item launches with. Windows matches a query
 * against them as well as against the path, so `getLoginItemSettings` has to
 * be given the same ones or it reports a registered item as missing.
 */
const LOGIN_ARGS = [HIDDEN_FLAG]

/**
 * Whether macOS launched the app as a login item. It gives login items no
 * arguments, so this is the only way to tell; elsewhere the flag says it.
 */
function openedAtLogin(): boolean {
  if (!isMac) return false
  try {
    return app.getLoginItemSettings({ args: LOGIN_ARGS }).wasOpenedAtLogin
  } catch {
    return false
  }
}

/**
 * Start with the system, or stop doing so.
 *
 * Only meaningful in a packaged build - in development the executable is
 * Electron itself, and registering that would launch a bare Electron at every
 * login. Linux is not handled by Electron at all: `setLoginItemSettings` is an
 * empty function there, so the desktop entry is written by hand.
 */
function applyAutostart(enabled: boolean): void {
  if (!app.isPackaged) return
  try {
    if (process.platform === 'linux') {
      const dir = join(app.getPath('home'), '.config', 'autostart')
      const file = join(dir, 'universal-video-downloader.desktop')
      if (enabled) {
        /*
          An AppImage runs from a fresh /tmp/.mount_* directory each time, gone
          once it exits, so `execPath` is the one path that is certain not to
          work at the next login. APPIMAGE is the file itself - the same path
          the updater replaces.
        */
        const target = process.env.APPIMAGE || process.execPath
        mkdirSync(dir, { recursive: true })
        writeFileSync(file, autostartDesktopEntry(target), 'utf-8')
      } else if (existsSync(file)) {
        rmSync(file, { force: true })
      }
      return
    }
    /*
      `openAsHidden` was the whole hidden-start story, and it is macOS-only and
      ignored from macOS 13 on, so a Windows login opened the full window every
      time. `args` puts the flag on the Windows command line instead; macOS
      ignores it and reports a login launch through `wasOpenedAtLogin`. The
      Run value written without the flag is replaced by this one at the next
      launch, since the first apply of every session writes it.
    */
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true, args: LOGIN_ARGS })
  } catch (err) {
    log.warn('app', 'Could not change the start-with-system setting', {
      why: err instanceof Error ? err.message : String(err)
    })
  }
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
    // Background watching relies on the tray to keep a closed window findable.
    log.error('app', 'Tray unavailable', { error: String(err) })
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
  // The app's own requests follow the proxy too, not only the engine's.
  void applyProxy(settings)
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

  /*
    Background watching implies the tray. Without it, turning that on and
    closing the window left a process running with no window and no icon -
    nothing to reopen it with and nothing to quit it from, short of logging out.
  */
  if (settings.trayEnabled || settings.automationEnabled) buildTray()
  else destroyTray()

  if (settings.clipboardWatch) {
    startClipboardWatch((url) => deliver(IPC.evtClipboardLink, 'link', url))
  } else {
    stopClipboardWatch()
  }

  /*
    These three were read once at launch, so each switch did nothing until the
    next one. Turning background watching on mid-session and closing the window
    left a process with no watcher at all, and "detailed log" never worked: the
    level was fixed when the file opened.

    Turning background watching off stops nothing here. Schedules run while the
    window is open either way; the switch only decides what closing it does.
  */
  if (settings.automationEnabled) startWatcher()
  setLogLevel(settings.logVerbose ? 'debug' : 'info')
  if (autostartNeedsApplying(settings.autostart, appliedAutostart)) {
    applyAutostart(settings.autostart)
    appliedAutostart = settings.autostart
  }
}

/** A link handed to the app on the command line (e.g. "open with"). */
function linkFromArgv(argv: string[]): string | undefined {
  return argv.find((arg) => /^https?:\/\//i.test(arg))
}

/*
  `uvd <link>` in a terminal starts this same binary with `--cli`. That run
  has no window, and must not take the single-instance lock: holding it would
  stop the app from opening, and asking for it would hand the link to an open
  window instead of downloading it here.
*/
const cliArgs = cliArgvFrom(process.argv)
const gotLock = cliArgs ? false : app.requestSingleInstanceLock()
if (cliArgs) {
  startCli(cliArgs)
} else if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    showMainWindow()
    const link = linkFromArgv(argv)
    if (link) deliver(IPC.evtClipboardLink, 'link', link)
  })

  app.whenReady().then(() => {
    /*
      First, so everything after it can be explained afterwards.
      `getPath('logs')` creates its directory as a side effect, which is why
      this cannot happen at module load.
    */
    initLog(getSettings().logVerbose ? 'debug' : 'info')

    // Before any request is made: the proxy the user set applies to our own too.
    void applyProxy(getSettings())
    answerProxyLoginsForPages()

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
    const startHidden = shouldStartHidden(process.argv, getSettings(), openedAtLogin())
    createWindow(startHidden)
    applySettings(getSettings())
    // The tray is how a hidden window is found again. Without one, show it.
    if (startHidden && !tray) showMainWindow()

    // Prepare the download engine in the background.
    ensureYtdlp().catch((err) => log.error('engine', 'Setup failed', { error: String(err) }))

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

    /*
      Check for app updates a few seconds after launch and every few hours
      after that, for as long as the app runs - it may live in the tray for
      days. The setting is read on every tick, so switching it off takes effect
      at once.
    */
    scheduleUpdateChecks(() => getSettings().autoUpdate && app.isPackaged)

    /*
      Refresh the download engine once a day, well after the window is up and
      only while nothing is using it. Sites change their players constantly, so
      a stale engine is a real failure mode — but swapping the binary out from
      under a running transfer is a worse one. Asked hourly and on waking, so a
      refresh put off by a busy engine or a dead network is not lost until the
      next launch.
    */
    scheduleEngineRefresh(isEngineBusy)

    /*
      Schedules run whenever the app is open. This used to wait for background
      watching to be switched on, which is off by default - so a new user could
      add a series and never have it checked, while the screen kept promising a
      next check in six hours. Watches the user paused stay paused: `tick`
      skips them. Start-with-system is applied by applySettings above.

      A launch that stays in the tray is a window hidden to the tray, and
      schedules treat it as one: background watching, when it is on, already
      started them in applySettings, and otherwise the window starts them when
      it is first shown.
    */
    if (!startHidden) startWatcher()

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
    flushWatches()
    shutdownDownloads()
    /*
      Last. Closing the log is final - anything logged afterwards is only
      queued, never written - and the shutdown above writes history.json,
      whose failure is exactly the kind of thing that has to reach the file.
    */
    flushLog()
  })

  app.on('window-all-closed', () => {
    /*
      Closing the window must not end the process while the app is meant to be
      watching. `trayEnabled` alone was the old condition, which meant somebody
      who turned automation on and closed the window silently stopped every
      schedule they had set up.
    */
    const settings = getSettings()
    // A process kept alive by the tray alone, or the macOS dock, is not watching.
    if (!settings.automationEnabled) stopWatcher()
    if (!isMac && !settings.trayEnabled && !settings.automationEnabled) app.quit()
  })
}
