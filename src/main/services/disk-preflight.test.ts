import { EventEmitter } from 'events'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PassThrough } from 'stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadItem } from '@shared/types'
import { listDownloads, pauseDownload, resumeDownload, retryDownload, startDownload } from './downloader'

/*
  Whether a download that cannot fit gets as far as the engine. The same stand-ins
  as resume-race.test.ts, with the disk played back too: a throwaway volume would
  need an administrator here.
*/
const spawn = vi.hoisted(() => vi.fn())
const free = vi.hoisted(() => vi.fn())
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  spawn
}))
vi.mock('electron', async () => {
  const fs = await import('fs')
  const os = await import('os')
  const path = await import('path')
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'uvd-disk-data-'))
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
vi.mock('./disk', () => ({ freeSpace: free }))
vi.mock('../resolvers', () => ({ resolveUrl: async (url: string) => ({ url }) }))

spawn.mockImplementation(() => Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() }))

const find = (id: string): DownloadItem | undefined => listDownloads().find((d) => d.id === id)
const outputDir = (): string => mkdtempSync(join(tmpdir(), 'uvd-disk-'))
let n = 0
const link = (): string => `https://video.test/watch/${++n}`
const exact = { bytes: 1_000, exact: true, merging: false }

beforeEach(() => {
  spawn.mockClear()
  free.mockReset()
})

describe('a download that will not fit', () => {
  it('fails before the engine starts, in the sentence a full disk gets', async () => {
    free.mockResolvedValue({ bytes: 999, reliable: true })
    const item = await startDownload({ url: link(), mode: 'video', outputDir: outputDir(), sizeEstimate: exact })
    await vi.waitFor(() => expect(find(item.id)?.state).toBe('error'))
    expect(find(item.id)).toMatchObject({
      errorCode: 'diskFull',
      error: 'Your disk is full — free some space and try again.'
    })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('counts both streams and the merged file when merging', async () => {
    free.mockResolvedValue({ bytes: 1_500, reliable: true })
    const item = await startDownload({ url: link(), mode: 'video', outputDir: outputDir(), sizeEstimate: { ...exact, merging: true } })
    await vi.waitFor(() => expect(find(item.id)?.state).toBe('error'))
    expect(spawn).not.toHaveBeenCalled()
  })

  it('goes ahead on a retry once there is room', async () => {
    free.mockResolvedValueOnce({ bytes: 1, reliable: true })
    const item = await startDownload({ url: link(), mode: 'video', outputDir: outputDir(), sizeEstimate: exact })
    await vi.waitFor(() => expect(find(item.id)?.state).toBe('error'))
    free.mockResolvedValue({ bytes: 5_000, reliable: true })
    retryDownload(item.id)
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
    pauseDownload(item.id)
  })
})

/*
  The check is for a download that has not started. One picked up again holds
  part of itself on this disk already, and was turned away for the room it had
  itself taken: "disk is full", on every resume once the picture was down.
*/
describe('a download picked up again', () => {
  it('is not refused for the room it has already used', async () => {
    free.mockResolvedValue({ bytes: 5_000, reliable: true })
    const dir = outputDir()
    const item = await startDownload({ url: link(), mode: 'video', outputDir: dir, sizeEstimate: { ...exact, merging: true } })
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
    spawn.mock.results[0].value.stdout.write(`[download] Destination: ${join(dir, 'Talk.f137.mp4')}\n`)
    await new Promise((r) => setImmediate(r))
    pauseDownload(item.id)
    spawn.mock.results[0].value.emit('close', null)

    free.mockResolvedValue({ bytes: 100, reliable: true })
    resumeDownload(item.id)
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2))
    expect(find(item.id)?.errorCode).toBeUndefined()
    pauseDownload(item.id)
  })
})

describe('a download that goes ahead', () => {
  const started = async (request: { sizeEstimate?: typeof exact }): Promise<void> => {
    const item = await startDownload({ url: link(), mode: 'video', outputDir: outputDir(), ...request })
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
    expect(find(item.id)?.errorCode).toBeUndefined()
    pauseDownload(item.id)
  }

  it('when it fits', async () => {
    free.mockResolvedValue({ bytes: 1_000, reliable: true })
    await started({ sizeEstimate: exact })
  })

  it('when the size is only a guess: that is a warning, not a refusal', async () => {
    free.mockResolvedValue({ bytes: 1, reliable: true })
    await started({ sizeEstimate: { ...exact, exact: false } })
  })

  it('when the disk is a share that may be reporting anything', async () => {
    free.mockResolvedValue({ bytes: 1, reliable: false })
    await started({ sizeEstimate: exact })
  })

  it('when the disk cannot be asked', async () => {
    free.mockResolvedValue(undefined)
    await started({ sizeEstimate: exact })
  })

  it('when no size is known, without asking the disk at all', async () => {
    await started({})
    expect(free).not.toHaveBeenCalled()
  })

  it('a cut is a part of the file, so the whole file\'s size is not held against it', async () => {
    free.mockResolvedValue({ bytes: 1, reliable: true })
    const item = await startDownload({ url: link(), mode: 'video', outputDir: outputDir(), sizeEstimate: exact, section: { start: 1, end: 2 } })
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
    expect(find(item.id)?.errorCode).toBeUndefined()
    pauseDownload(item.id)
  })
})
