import { EventEmitter } from 'events'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PassThrough } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadItem } from '@shared/types'
import {
  cancelDownload,
  isEngineBusy,
  listDownloads,
  loadHistory,
  pauseDownload,
  removeDownload,
  resumeDownload,
  resumeInterrupted,
  shutdownDownloads,
  startDownload
} from './downloader'
import { PROGRESS_PREFIX } from './downloader'
import { markInterrupted } from './resume'
import { killTree } from './process'

/*
  A row waiting for a premiere: the same stand-ins as resume-race.test.ts, with
  one download at a time, because what this is about is that slot.
*/
const spawn = vi.hoisted(() => vi.fn())
const h = vi.hoisted(() => ({ userData: '' }))
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  spawn
}))
vi.mock('electron', async () => {
  const fs = await import('fs')
  const os = await import('os')
  const path = await import('path')
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'uvd-wait-data-'))
  h.userData = userData
  return { app: { getPath: () => userData } }
})
vi.mock('./settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./settings')>()),
  getSettings: () => ({
    concurrentDownloads: 1,
    audioFormat: 'mp3',
    filenameTemplate: '%(title)s [%(id)s].%(ext)s',
    subtitleLanguages: '',
    speedLimit: '',
    proxy: '',
    cookiesFile: '',
    cookiesFromBrowser: '',
    universalFallback: false,
    createSubfolders: false
  })
}))
vi.mock('./ytdlp', () => ({
  ensureYtdlp: () => Promise.resolve('yt-dlp'),
  ytdlpBinaryPath: () => 'yt-dlp',
  ytdlpSpawnOptions: () => ({ windowsHide: true, env: {} })
}))
vi.mock('./process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./process')>()),
  killTree: vi.fn()
}))
const resolveUrl = vi.hoisted(() => vi.fn())
vi.mock('../resolvers', () => ({ resolveUrl }))

type Engine = EventEmitter & { stdout: PassThrough; stderr: PassThrough }
const engines: Engine[] = []

const find = (id: string): DownloadItem | undefined => listDownloads().find((d) => d.id === id)
const outputDir = (): string => mkdtempSync(join(tmpdir(), 'uvd-wait-'))

beforeEach(() => {
  for (const item of listDownloads()) removeDownload(item.id)
  engines.length = 0
  spawn.mockReset()
  spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() })
    engines.push(child)
    return child
  })
  resolveUrl.mockReset()
  resolveUrl.mockImplementation(async (url: string) => ({ url }))
  vi.mocked(killTree).mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('waiting for a video', () => {
  it('runs the engine with the wait and says it is waiting, not downloading', async () => {
    const item = await startDownload({ url: 'https://video.test/a', mode: 'video', outputDir: outputDir(), waitForVideo: true })
    await vi.waitFor(() => expect(find(item.id)?.state).toBe('waiting'))
    expect(spawn.mock.calls[0][1]).toContain('--wait-for-video')
  })

  it('does not hold a download slot for as long as the wait takes', async () => {
    const first = await startDownload({ url: 'https://video.test/b', mode: 'video', outputDir: outputDir(), waitForVideo: true })
    await vi.waitFor(() => expect(find(first.id)?.state).toBe('waiting'))
    const next = await startDownload({ url: 'https://video.test/c', mode: 'video', outputDir: outputDir() })
    await vi.waitFor(() => expect(find(next.id)?.state).toBe('downloading'))
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('still counts as using the engine, whose binary it has loaded', async () => {
    const item = await startDownload({ url: 'https://video.test/d', mode: 'video', outputDir: outputDir(), waitForVideo: true })
    await vi.waitFor(() => expect(find(item.id)?.state).toBe('waiting'))
    expect(isEngineBusy()).toBe(true)
  })

  it('turns into a download when something comes down', async () => {
    const item = await startDownload({ url: 'https://video.test/e', mode: 'video', outputDir: outputDir(), waitForVideo: true })
    await vi.waitFor(() => expect(find(item.id)?.state).toBe('waiting'))
    engines[0].stdout.write(`${PROGRESS_PREFIX}downloading\t10\t100\tNA\t5\t9\tNA\tNA\n`)
    await vi.waitFor(() => expect(find(item.id)?.state).toBe('downloading'))
    expect(find(item.id)?.waitForVideo).toBe(true)
  })

  it('can be cancelled, which ends the waiting process', async () => {
    const item = await startDownload({ url: 'https://video.test/f', mode: 'video', outputDir: outputDir(), waitForVideo: true })
    await vi.waitFor(() => expect(find(item.id)?.state).toBe('waiting'))
    cancelDownload(item.id)
    expect(find(item.id)?.state).toBe('canceled')
    expect(killTree).toHaveBeenCalledTimes(1)
    engines[0].emit('close', 1)
    expect(find(item.id)?.state).toBe('canceled')
  })

  it('can be paused, and is picked up after a restart', async () => {
    const item = await startDownload({ url: 'https://video.test/g', mode: 'video', outputDir: outputDir(), waitForVideo: true })
    await vi.waitFor(() => expect(find(item.id)?.state).toBe('waiting'))
    expect(markInterrupted({ ...item, state: 'waiting' })).toBe(true)
    pauseDownload(item.id)
    expect(find(item.id)?.state).toBe('paused')
    expect(killTree).toHaveBeenCalledTimes(1)
  })

  it('starts what was queued behind it when it starts waiting', async () => {
    let finishResolve!: () => void
    resolveUrl.mockImplementationOnce(
      (url: string) => new Promise((ok) => (finishResolve = () => ok({ url })))
    )
    const waiter = await startDownload({ url: 'https://video.test/w1', mode: 'video', outputDir: outputDir(), waitForVideo: true })
    await vi.waitFor(() => expect(find(waiter.id)?.state).toBe('detecting'))
    // Its resolve holds the one slot, so this one is left queued behind it.
    const behind = await startDownload({ url: 'https://video.test/w2', mode: 'video', outputDir: outputDir() })
    expect(find(behind.id)?.state).toBe('queued')
    finishResolve()
    await vi.waitFor(() => expect(find(waiter.id)?.state).toBe('waiting'))
    await vi.waitFor(() => expect(find(behind.id)?.state).toBe('downloading'))
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('a waiting row and a queued one both restored after a restart: the queued one starts', async () => {
    const dir = outputDir()
    const rows: Partial<DownloadItem>[] = [
      { id: 'restored-w', url: 'https://video.test/rw', waitForVideo: true, state: 'waiting', createdAt: 1 },
      { id: 'restored-b', url: 'https://video.test/rb', state: 'queued', createdAt: 2 }
    ]
    writeFileSync(
      join(h.userData, 'history.json'),
      JSON.stringify(rows.map((row) => ({ sourceUrl: row.url, title: 'x', mode: 'video', percent: 0, kind: 'download', outputDir: dir, ...row })))
    )
    loadHistory()
    expect(find('restored-w')?.state).toBe('paused')
    expect(find('restored-b')?.state).toBe('paused')
    expect(resumeInterrupted()).toBe(2)
    await vi.waitFor(() => expect(find('restored-w')?.state).toBe('waiting'))
    await vi.waitFor(() => expect(find('restored-b')?.state).toBe('downloading'))
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('leaves the plain request as it was', async () => {
    const item = await startDownload({ url: 'https://video.test/h', mode: 'video', outputDir: outputDir() })
    await vi.waitFor(() => expect(find(item.id)?.state).toBe('downloading'))
    expect(spawn.mock.calls[0][1]).not.toContain('--wait-for-video')
    expect(find(item.id)?.waitForVideo).toBeUndefined()
  })
})

describe('a wait that loses the network', () => {
  // What the real engine says with the host unreachable, from a run against a closed port.
  const outage =
    "ERROR: [generic] Unable to download webpage: <urlopen error [WinError 10061] No connection could be made because the target machine actively refused it> (caused by TransportError('x'))\n"

  /** A row waiting, under a clock the test moves. */
  async function waitingRow(name: string): Promise<DownloadItem> {
    const item = await startDownload({ url: `https://video.test/${name}`, mode: 'video', outputDir: outputDir(), waitForVideo: true })
    await vi.waitFor(() => expect(find(item.id)?.state).toBe('waiting'))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    return item
  }

  function engineFails(engine: Engine, words: string): void {
    engine.stderr.emit('data', Buffer.from(words))
    engine.emit('close', 1)
  }

  /** Let the promises a timer started run, with the clock held still. */
  const settle = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(0)
    await new Promise((ok) => setImmediate(ok))
    await vi.advanceTimersByTimeAsync(0)
  }

  it('goes on waiting, spends no attempts, and looks again in about a minute', async () => {
    const item = await waitingRow('n1')
    for (let round = 0; round < 5; round++) {
      engineFails(engines[engines.length - 1], outage)
      expect(find(item.id)?.state).toBe('waiting')
      expect(find(item.id)?.attempts).toBe(0)
      expect(find(item.id)?.error).toBeUndefined()
      const before = spawn.mock.calls.length
      await vi.advanceTimersByTimeAsync(59_000)
      expect(spawn.mock.calls.length).toBe(before)
      await vi.advanceTimersByTimeAsync(2_000)
      await settle()
      expect(spawn.mock.calls.length).toBe(before + 1)
      expect(find(item.id)?.state).toBe('waiting')
    }
  })

  it('looks again even with every slot taken, like the stream it is waiting for', async () => {
    const item = await waitingRow('n2')
    const busy = await startDownload({ url: 'https://video.test/n2-busy', mode: 'video', outputDir: outputDir() })
    await settle()
    expect(find(busy.id)?.state).toBe('downloading')
    engineFails(engines[0], outage)
    const before = spawn.mock.calls.length
    await vi.advanceTimersByTimeAsync(61_000)
    await settle()
    expect(spawn.mock.calls.length).toBe(before + 1)
    expect(find(item.id)?.state).toBe('waiting')
  })

  it('still fails on something that is not the network', async () => {
    const item = await waitingRow('n3')
    engineFails(engines[0], 'ERROR: [youtube] abc: Private video. Sign in if you have been granted access\n')
    expect(find(item.id)?.state).toBe('error')
  })

  it('counts attempts once something has come down', async () => {
    const item = await waitingRow('n4')
    engines[0].stdout.emit('data', Buffer.from(`${PROGRESS_PREFIX}downloading\t10\t100\tNA\t5\t9\tNA\tNA\n`))
    expect(find(item.id)?.state).toBe('downloading')
    engineFails(engines[0], outage)
    expect(find(item.id)?.state).toBe('queued')
    expect(find(item.id)?.attempts).toBe(1)
  })

  it.each([
    ['pause', (id: string): void => pauseDownload(id), 'paused'],
    ['cancel', (id: string): void => cancelDownload(id), 'canceled']
  ])('%s clears the timer, and nothing starts later', async (_name, act, state) => {
    const item = await waitingRow(`n5-${state}`)
    engineFails(engines[0], outage)
    act(item.id)
    const before = spawn.mock.calls.length
    await vi.advanceTimersByTimeAsync(120_000)
    await settle()
    expect(spawn.mock.calls.length).toBe(before)
    expect(find(item.id)?.state).toBe(state)
  })

  it('resuming after a pause starts it once, with no second run from the old timer', async () => {
    const item = await waitingRow('n6')
    engineFails(engines[0], outage)
    pauseDownload(item.id)
    const before = spawn.mock.calls.length
    resumeDownload(item.id)
    await settle()
    expect(spawn.mock.calls.length).toBe(before + 1)
    await vi.advanceTimersByTimeAsync(120_000)
    await settle()
    expect(spawn.mock.calls.length).toBe(before + 1)
  })

  it('a resolve that loses the network waits too', async () => {
    const item = await waitingRow('n7')
    engineFails(engines[0], outage)
    resolveUrl.mockImplementationOnce(() => Promise.reject(new Error('Connection reset by peer')))
    const before = spawn.mock.calls.length
    await vi.advanceTimersByTimeAsync(61_000)
    await settle()
    expect(resolveUrl).toHaveBeenCalledTimes(2)
    expect(find(item.id)?.state).toBe('waiting')
    expect(spawn.mock.calls.length).toBe(before)
    expect(find(item.id)?.attempts).toBe(0)
    await vi.advanceTimersByTimeAsync(61_000)
    await settle()
    expect(spawn.mock.calls.length).toBe(before + 1)
  })

  // Last in the file: shutting down parks every row there is.
  it('shutdown clears the timer, and the row is picked up next time', async () => {
    const item = await waitingRow('n8')
    engineFails(engines[0], outage)
    shutdownDownloads()
    expect(find(item.id)?.state).toBe('paused')
    expect(find(item.id)?.interrupted).toBe(true)
    const before = spawn.mock.calls.length
    await vi.advanceTimersByTimeAsync(120_000)
    await settle()
    expect(spawn.mock.calls.length).toBe(before)
  })
})
