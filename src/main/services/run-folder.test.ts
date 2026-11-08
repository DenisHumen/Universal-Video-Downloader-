import { EventEmitter } from 'events'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PassThrough } from 'stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadItem } from '@shared/types'
import { listDownloads, loadHistory, pauseDownload, removeDownload, resumeDownload, resumeInterrupted, startDownload } from './downloader'

/*
  Which folder a row writes to, on its first run and on every run after it. The
  same stand-ins as wait-for-video.test.ts, with a folder per site switched on.
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
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'uvd-folder-data-'))
  h.userData = userData
  return { app: { getPath: () => userData } }
})
vi.mock('./settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./settings')>()),
  getSettings: () => ({
    concurrentDownloads: 3,
    audioFormat: 'mp3',
    filenameTemplate: '%(title)s.%(ext)s',
    subtitleLanguages: '',
    speedLimit: '',
    proxy: '',
    cookiesFile: '',
    cookiesFromBrowser: '',
    universalFallback: false,
    createSubfolders: true
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

const find = (id: string): DownloadItem | undefined => listDownloads().find((d) => d.id === id)
const newDir = (): string => mkdtempSync(join(tmpdir(), 'uvd-folder-'))
/** The folder the engine was last told to write to. */
const lastOutput = (): string => {
  const args = spawn.mock.calls[spawn.mock.calls.length - 1][1] as string[]
  return args[args.indexOf('-o') + 1]
}

function restore(row: Partial<DownloadItem> & { id: string; url: string; outputDir: string }): void {
  writeFileSync(
    join(h.userData, 'history.json'),
    JSON.stringify([{ sourceUrl: row.url, title: 'x', mode: 'video', percent: 0, kind: 'download', state: 'downloading', createdAt: 1, ...row }])
  )
  loadHistory()
}

beforeEach(() => {
  for (const item of listDownloads()) removeDownload(item.id)
  spawn.mockReset()
  spawn.mockImplementation(() => Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() }))
  resolveUrl.mockReset()
  resolveUrl.mockImplementation(async (url: string) => ({ url }))
})

describe('the folder a row writes to', () => {
  it('is settled on the first run and said on the row', async () => {
    const dir = newDir()
    const item = await startDownload({ url: 'https://media.example/a', mode: 'video', outputDir: dir })
    await vi.waitFor(() => expect(find(item.id)?.state).toBe('downloading'))
    expect(find(item.id)?.runDir).toBe(join(dir, 'media.example'))
    expect(lastOutput().startsWith(join(dir, 'media.example'))).toBe(true)
  })

  it('stays when a later run would name it differently', async () => {
    const dir = newDir()
    const item = await startDownload({ url: 'https://media.example/b', mode: 'video', outputDir: dir })
    await vi.waitFor(() => expect(find(item.id)?.state).toBe('downloading'))
    pauseDownload(item.id)
    ;(spawn.mock.results[0].value as EventEmitter).emit('close', 1)
    // The resolve has now learned the site's name, which would give another folder.
    resolveUrl.mockImplementation(async (url: string) => ({ url, extractor: 'MediaExample' }))
    resumeDownload(item.id)
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2))
    expect(find(item.id)?.extractor).toBe('MediaExample')
    expect(lastOutput().startsWith(join(dir, 'media.example'))).toBe(true)
  })

  it('a restored row keeps the folder it has on record, even if that is gone', async () => {
    const dir = newDir()
    const kept = join(dir, 'kept-folder')
    restore({ id: 'kept', url: 'https://www.youtube.com/watch?v=abc', outputDir: dir, log: 'x', runDir: kept })
    resumeInterrupted()
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
    expect(lastOutput().startsWith(kept)).toBe(true)
    expect(existsSync(join(dir, 'YouTube'))).toBe(false)
  })

  it('a row from before goes back to the folder the old rule gave it, by host', async () => {
    const dir = newDir()
    mkdirSync(join(dir, 'youtube.com'))
    writeFileSync(join(dir, 'youtube.com', 'x.mp4.part'), 'partial')
    restore({ id: 'old-host', url: 'https://www.youtube.com/watch?v=abc', outputDir: dir, log: 'ran before' })
    resumeInterrupted()
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
    expect(lastOutput().startsWith(join(dir, 'youtube.com'))).toBe(true)
    expect(find('old-host')?.runDir).toBe(join(dir, 'youtube.com'))
    expect(existsSync(join(dir, 'YouTube'))).toBe(false)
  })

  it('and by extractor, which the old rule asked first', async () => {
    const dir = newDir()
    mkdirSync(join(dir, 'Twitter'))
    restore({ id: 'old-extractor', url: 'https://x.com/a/status/1', extractor: 'Twitter', outputDir: dir, log: 'ran before' })
    resumeInterrupted()
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
    expect(lastOutput().startsWith(join(dir, 'Twitter'))).toBe(true)
  })

  it('goes by the new name when the old folder is not there', async () => {
    const dir = newDir()
    restore({ id: 'no-old', url: 'https://www.youtube.com/watch?v=abc', outputDir: dir, log: 'ran before' })
    resumeInterrupted()
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
    expect(lastOutput().startsWith(join(dir, 'YouTube'))).toBe(true)
  })

  it('goes by the new name for a row that never ran, whatever folders there are', async () => {
    const dir = newDir()
    mkdirSync(join(dir, 'youtube.com'))
    restore({ id: 'never-ran', url: 'https://www.youtube.com/watch?v=abc', outputDir: dir })
    resumeInterrupted()
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
    expect(lastOutput().startsWith(join(dir, 'YouTube'))).toBe(true)
  })
})
