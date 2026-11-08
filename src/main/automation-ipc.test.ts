import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/ipc'

/* The bridge's end of "Send to Share…": what it does before it goes anywhere near a file. */
const h = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  fromApp: true,
  send: vi.fn(),
  file: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => '', getName: () => 'test', getVersion: () => '0', isPackaged: false },
  ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => h.handlers.set(channel, fn) },
  dialog: {},
  BrowserWindow: { getAllWindows: () => [] },
  net: { isOnline: () => true },
  powerMonitor: { on: () => undefined },
  shell: {},
  session: {}
}))
vi.mock('./services/navigation', () => ({ fromRenderer: () => h.fromApp }))
vi.mock('./services/share-send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./services/share-send')>()),
  sendToShare: h.send
}))
vi.mock('./services/downloader', () => ({ getDownload: () => ({ filepath: h.file() }), relocateItem: vi.fn() }))
vi.mock('./services/library', () => ({ entryFile: vi.fn(), followEntry: vi.fn() }))
vi.mock('./services/settings', () => ({ getSettings: () => ({ smbTargets: [] }) }))
vi.mock('./services/automation/store', () => ({ watchEvents: { on: vi.fn() } }))
vi.mock('./services/automation/watcher', () => ({}))
vi.mock('./services/automation/pipeline', () => ({}))
vi.mock('./services/automation/smb', () => ({}))
vi.mock('./services/automation/telegram', () => ({}))
vi.mock('./services/automation/detect', () => ({}))
vi.mock('./services/secrets', () => ({ SECRET: {} }))
vi.mock('./services/log', () => {
  const quiet = vi.fn()
  return { log: { info: quiet, warn: quiet, error: quiet, debug: quiet }, logFilePath: () => '' }
})

const event = { sender: { isDestroyed: () => false, send: vi.fn() } }
const good = { id: 'row', targetId: 'nas', folder: 'video' }
const call = (raw: unknown): Promise<unknown> => h.handlers.get(IPC.shareSend)!(event, raw)

beforeEach(async () => {
  h.fromApp = true
  h.send.mockReset()
  h.send.mockResolvedValue({ status: 'exists', name: 'a.mp4' })
  h.file.mockReset()
  h.file.mockReturnValue(__filename)
  if (!h.handlers.size) (await import('./automation-ipc')).registerAutomationIpc()
})

describe('Send to Share over the bridge', () => {
  it('goes through for the app', async () => {
    await expect(call(good)).resolves.toEqual({ status: 'exists', name: 'a.mp4' })
    expect(h.send).toHaveBeenCalledTimes(1)
  })

  it('refuses a page that is not the app before looking at anything', async () => {
    h.fromApp = false
    await expect(call(good)).rejects.toThrow(/only available to the app/)
    expect(h.file).not.toHaveBeenCalled()
    expect(h.send).not.toHaveBeenCalled()
  })

  it.each([
    ['a climb out of the folder', { ...good, folder: '../other' }],
    ['a dot segment', { ...good, folder: 'a/./b' }],
    ['no id', { targetId: 'nas', folder: '' }],
    ['no request at all', undefined]
  ])('fails on %s without sending', async (_name, raw) => {
    await expect(call(raw)).resolves.toMatchObject({ status: 'failed', kind: 'path' })
    expect(h.send).not.toHaveBeenCalled()
  })
})
