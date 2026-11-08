import { EventEmitter } from 'events'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PassThrough } from 'stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadItem } from '@shared/types'
import { cancelDownload, isEngineBusy, listDownloads, pauseDownload, removeDownload, startDownload } from './downloader'
import { PROGRESS_PREFIX } from './downloader'
import { markInterrupted } from './resume'
import { killTree } from './process'

/*
  A row waiting for a premiere: the same stand-ins as resume-race.test.ts, with
  one download at a time, because what this is about is that slot.
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
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'uvd-wait-data-'))
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

  it('leaves the plain request as it was', async () => {
    const item = await startDownload({ url: 'https://video.test/h', mode: 'video', outputDir: outputDir() })
    await vi.waitFor(() => expect(find(item.id)?.state).toBe('downloading'))
    expect(spawn.mock.calls[0][1]).not.toContain('--wait-for-video')
    expect(find(item.id)?.waitForVideo).toBeUndefined()
  })
})
