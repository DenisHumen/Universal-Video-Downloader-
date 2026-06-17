import { app, BrowserWindow, shell, nativeImage } from 'electron'
import { join } from 'path'
import { registerIpc } from './ipc'
import { getSettings } from './services/settings'
import { ensureYtdlp } from './services/ytdlp'
import { checkForUpdates, initUpdater } from './services/updater'
import { loadHistory } from './services/downloader'

const isMac = process.platform === 'darwin'
let mainWindow: BrowserWindow | null = null

function resolveIcon(): string {
  // Used on Linux/Windows where the window icon is set explicitly.
  return join(__dirname, '../../build/icon.png')
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
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
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

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

    registerIpc(() => mainWindow)
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
