import { app, BrowserWindow, shell, nativeImage } from 'electron'
import { join } from 'path'
import { IPC } from '@shared/ipc'
import { registerIpc } from './ipc'
import { getSettings } from './services/settings'
import { ensureYtdlp } from './services/ytdlp'
import { checkForUpdates, initUpdater } from './services/updater'
import { loadHistory } from './services/downloader'

const isMac = process.platform === 'darwin'
let mainWindow: BrowserWindow | null = null
let searchWindow: BrowserWindow | null = null

function resolveIcon(): string {
  // Used on Linux/Windows where the window icon is set explicitly.
  return join(__dirname, '../../build/icon.png')
}

/** Shared hardening for every app window. */
function wireWindow(win: BrowserWindow): void {
  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
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
    backgroundColor: '#0a0a14',
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 18 } : undefined,
    icon: isMac ? undefined : nativeImage.createFromPath(resolveIcon()),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({ ...windowOptions(1200, 800), minWidth: 960, minHeight: 640 })
  wireWindow(mainWindow)

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/** Open (or focus) the title-search window, seeded with a query. */
export function openSearchWindow(query: string): void {
  if (searchWindow && !searchWindow.isDestroyed()) {
    if (searchWindow.isMinimized()) searchWindow.restore()
    searchWindow.focus()
    searchWindow.webContents.send(IPC.evtSearchQuery, query)
    return
  }
  searchWindow = new BrowserWindow(windowOptions(1020, 780))
  wireWindow(searchWindow)

  const hash = `/search?q=${encodeURIComponent(query)}`
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    searchWindow.loadURL(`${devUrl}#${hash}`)
  } else {
    searchWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  }

  searchWindow.on('closed', () => {
    searchWindow = null
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.denishumen.universalvideodownloader')
    }

    registerIpc(() => mainWindow, openSearchWindow)
    loadHistory()
    initUpdater()
    createWindow()

    // Prepare the download engine in the background.
    ensureYtdlp().catch((err) => console.error('yt-dlp ensure failed:', err))

    // Check for app updates a few seconds after launch.
    setTimeout(() => {
      if (getSettings().autoUpdate && app.isPackaged) {
        checkForUpdates().catch(() => undefined)
      }
    }, 5000)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })
}
