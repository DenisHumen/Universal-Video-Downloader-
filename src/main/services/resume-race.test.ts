import { EventEmitter } from 'events'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PassThrough } from 'stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadItem } from '@shared/types'
import { listDownloads, pauseDownload, resumeDownload, startDownload } from './downloader'

/*
  Pause and resume while a download is still resolving its link.

  The same stand-ins as output-names.test.ts: the engine, the settings, the
  resolver and Electron's userData are played back, the queue is real.
*/
const spawn = vi.hoisted(() => vi.fn())
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  spawn
}))
vi.mock('electron', async () => {
  const fs = await import('fs')
  const os = await import('os')
  const path = await import('path')
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'uvd-race-data-'))
  return { app: { getPath: () => userData } }
})
vi.mock('./settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./settings')>()),
  getSettings: () => ({
    concurrentDownloads: 3,
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

spawn.mockImplementation(() => {
  // An engine that never finishes: the test only cares how many were started.
  return Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() })
})

const find = (id: string): DownloadItem | undefined => listDownloads().find((d) => d.id === id)
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** A resolve the test settles by hand, after the pause and the resume. */
function deferred(): { promise: Promise<{ url: string }>; resolve: () => void; reject: () => void } {
  let resolve!: () => void
  let reject!: () => void
  const promise = new Promise<{ url: string }>((ok, no) => {
    resolve = () => ok({ url: 'https://video.test/stream' })
    reject = () => no(new Error('Could not find a video stream on this page any more'))
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  spawn.mockClear()
  resolveUrl.mockReset()
})

describe('a queued page that needs a picker', () => {
  it('fails with a pointer to Home instead of handing the page to the engine', async () => {
    resolveUrl.mockResolvedValueOnce({ url: 'https://series.test/show', isPlaylist: true, entries: [] })
    const outputDir = mkdtempSync(join(tmpdir(), 'uvd-race-'))
    const item = await startDownload({ url: 'https://series.test/show', mode: 'video', outputDir })
    await vi.waitFor(() => expect(find(item.id)?.state).toBe('error'))
    expect(find(item.id)?.errorCode).toBe('needsPicker')
    expect(spawn).not.toHaveBeenCalled()
  })
})

describe('pause then resume while resolving', () => {
  it("does not let the first run's late abort fail the second", async () => {
    const first = deferred()
    const second = deferred()
    resolveUrl.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const outputDir = mkdtempSync(join(tmpdir(), 'uvd-race-'))
    const item = await startDownload({ url: 'https://video.test/watch?v=r1', mode: 'video', outputDir })
    await vi.waitFor(() => expect(resolveUrl).toHaveBeenCalledTimes(1))

    pauseDownload(item.id)
    resumeDownload(item.id)
    await vi.waitFor(() => expect(resolveUrl).toHaveBeenCalledTimes(2))
    expect(find(item.id)?.state).toBe('detecting')

    // The first resolve notices its abort only now.
    first.reject()
    await tick()
    expect(find(item.id)?.state).toBe('detecting')

    second.resolve()
    await vi.waitFor(() => expect(find(item.id)?.state).toBe('downloading'))
    expect(spawn).toHaveBeenCalledTimes(1)

    // The second run's controller is still on file, so a pause still stops it.
    pauseDownload(item.id)
    expect(find(item.id)?.state).toBe('paused')
  })

  it('starts one engine when the first resolve ignores the abort and succeeds late', async () => {
    const first = deferred()
    const second = deferred()
    resolveUrl.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const outputDir = mkdtempSync(join(tmpdir(), 'uvd-race-'))
    const item = await startDownload({ url: 'https://video.test/watch?v=r2', mode: 'video', outputDir })
    await vi.waitFor(() => expect(resolveUrl).toHaveBeenCalledTimes(1))

    pauseDownload(item.id)
    resumeDownload(item.id)
    await vi.waitFor(() => expect(resolveUrl).toHaveBeenCalledTimes(2))

    first.resolve()
    await tick()
    await tick()
    expect(spawn).not.toHaveBeenCalled()

    second.resolve()
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
    await tick()
    expect(spawn).toHaveBeenCalledTimes(1)
  })
})
