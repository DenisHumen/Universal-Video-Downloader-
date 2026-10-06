import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '@shared/types'

/*
  The updater as it is, with a pretend electron-updater and a pretend GitHub
  around it. What matters here is what a check nobody asked for may do: never
  take a "restart to install" away, and never turn a failed attempt into a red
  strip the user did not ask for.
*/

const h = vi.hoisted(() => ({
  request: null as unknown as (...args: unknown[]) => unknown,
  open: vi.fn(async () => undefined),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: () => '3.24.0', runningUnderARM64Translation: false },
  net: { request: (...args: unknown[]) => h.request(...args), isOnline: () => true },
  powerMonitor: { on: vi.fn(), off: vi.fn() },
  shell: { openExternal: h.open }
}))
vi.mock('electron-updater', async () => {
  const { EventEmitter: Emitter } = await import('events')
  const autoUpdater = Object.assign(new Emitter(), {
    checkForUpdates: vi.fn(async () => null),
    downloadUpdate: vi.fn(async () => []),
    quitAndInstall: vi.fn()
  })
  return { default: { autoUpdater } }
})
vi.mock('./log', () => ({ log: h.log }))
vi.mock('./proxy-auth', () => ({ withProxyAuth: <T>(req: T) => req }))

type FakeUpdater = EventEmitter & {
  checkForUpdates: ReturnType<typeof vi.fn>
  downloadUpdate: ReturnType<typeof vi.fn>
}

const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
const realArch = Object.getOwnPropertyDescriptor(process, 'arch')!

function onPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  // An Intel Mac, wherever the tests run.
  Object.defineProperty(process, 'arch', { value: 'x64', configurable: true })
}

async function load(platform: NodeJS.Platform) {
  onPlatform(platform)
  const updater = await import('./updater')
  const au = (await import('electron-updater')).default.autoUpdater as unknown as FakeUpdater
  const seen: UpdateStatus[] = []
  updater.updateEvents.on('status', (s: UpdateStatus) => seen.push(s))
  updater.initUpdater()
  return { updater, au, seen }
}

/** A GitHub that answers every request with `status` and `body`. */
function github(status: number, body: unknown): void {
  h.request = () => {
    const req = Object.assign(new EventEmitter(), { setHeader: vi.fn(), abort: vi.fn(), end: vi.fn() })
    req.end.mockImplementation(() => {
      const res = Object.assign(new EventEmitter(), { statusCode: status })
      queueMicrotask(() => {
        req.emit('response', res)
        res.emit('data', Buffer.from(JSON.stringify(body)))
        res.emit('end')
      })
    })
    return req
  }
}

const offline = new Error('net::ERR_INTERNET_DISCONNECTED')

function failingCheck(au: FakeUpdater): void {
  au.checkForUpdates.mockImplementation(async () => {
    au.emit('checking-for-update')
    au.emit('error', offline)
    throw offline
  })
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

afterEach(() => {
  Object.defineProperty(process, 'platform', realPlatform)
  Object.defineProperty(process, 'arch', realArch)
})

describe('backgroundCheck', () => {
  it.each([
    ['downloaded', (au: FakeUpdater) => au.emit('update-downloaded', { version: '3.25.0' })],
    ['downloading', (au: FakeUpdater) => au.emit('download-progress', { percent: 40, bytesPerSecond: 1 })],
    ['checking', (au: FakeUpdater) => au.emit('checking-for-update')]
  ])('leaves a %s state alone', async (state, put) => {
    const { updater, au } = await load('win32')
    put(au)
    expect(updater.getUpdateStatus().state).toBe(state)

    await updater.backgroundCheck()

    expect(au.checkForUpdates).not.toHaveBeenCalled()
    expect(updater.getUpdateStatus().state).toBe(state)
  })

  it('keeps the status it found when the check fails, and shows no spinner', async () => {
    const { updater, au, seen } = await load('win32')
    au.emit('update-available', { version: '3.25.0' })
    const before = updater.getUpdateStatus()
    seen.length = 0
    failingCheck(au)

    await updater.backgroundCheck()

    expect(au.checkForUpdates).toHaveBeenCalledOnce()
    expect(updater.getUpdateStatus()).toEqual(before)
    expect(seen).toEqual([])
    expect(h.log.warn).toHaveBeenCalledWith(
      'updater',
      'Scheduled update check failed',
      expect.objectContaining({ error: offline.message })
    )
  })

  it('shows what it finds', async () => {
    const { updater, au } = await load('win32')
    au.checkForUpdates.mockImplementation(async () => {
      au.emit('checking-for-update')
      au.emit('update-available', { version: '3.25.0' })
      return null
    })

    await updater.backgroundCheck()

    expect(updater.getUpdateStatus()).toMatchObject({ state: 'available', version: '3.25.0' })
  })

  it('does not run while a download the user asked for is starting', async () => {
    const { updater, au } = await load('win32')
    au.emit('update-available', { version: '3.25.0' })
    let finish = (): void => undefined
    au.downloadUpdate.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)))

    const download = updater.downloadUpdate()
    await updater.backgroundCheck()
    finish()
    await download

    expect(au.checkForUpdates).not.toHaveBeenCalled()
  })

  it('stays quiet on a refusal from GitHub too, and logs its status', async () => {
    const { updater } = await load('darwin')
    github(403, { message: 'API rate limit exceeded for 192.168.1.10' })

    await updater.backgroundCheck()

    expect(updater.getUpdateStatus().state).toBe('idle')
    expect(h.log.warn).toHaveBeenCalledWith(
      'updater',
      'Scheduled update check failed',
      expect.objectContaining({ status: 403 })
    )
  })
})

describe('checkForUpdates', () => {
  it('still reports a failure when somebody asked', async () => {
    const { updater, au } = await load('win32')
    failingCheck(au)

    await updater.checkForUpdates()

    expect(updater.getUpdateStatus()).toMatchObject({ state: 'error', message: offline.message })
  })

  it('points a Mac at its own disk image, and keeps the page for "open the downloads page"', async () => {
    const { updater } = await load('darwin')
    const base = 'https://github.com/DenisHumen/Universal-Video-Downloader-/releases/download/v3.25.0'
    const page = 'https://github.com/DenisHumen/Universal-Video-Downloader-/releases/tag/v3.25.0'
    github(200, {
      tag_name: 'v3.25.0',
      html_url: page,
      assets: ['mac-x64.zip', 'mac-arm64.dmg', 'mac-x64.dmg.blockmap', 'mac-x64.dmg'].map((end) => ({
        name: `Universal-Video-Downloader-3.25.0-${end}`,
        browser_download_url: `${base}/Universal-Video-Downloader-3.25.0-${end}`
      }))
    })

    await updater.checkForUpdates()

    const status = updater.getUpdateStatus()
    expect(status).toMatchObject({ state: 'available', version: '3.25.0', manual: true })
    expect(status.downloadUrl).toBe(`${base}/Universal-Video-Downloader-3.25.0-mac-x64.dmg`)

    await updater.openReleasesPage()
    expect(h.open).toHaveBeenLastCalledWith(page)
  })

  it('falls back to the release page when no file matches', async () => {
    const { updater } = await load('darwin')
    const page = 'https://github.com/DenisHumen/Universal-Video-Downloader-/releases/tag/v3.25.0'
    github(200, { tag_name: 'v3.25.0', html_url: page, assets: [] })

    await updater.checkForUpdates()

    expect(updater.getUpdateStatus().downloadUrl).toBe(page)
  })
})
