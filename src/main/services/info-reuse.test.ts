import { EventEmitter } from 'events'
import { existsSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PassThrough } from 'stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadItem } from '@shared/types'

/*
  A download started from the detect's JSON, with the engine played back.
  Same stand-ins as resume-race.test.ts; the cache is a real one in a temp
  folder, so the files it hands out and takes back are real files.
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
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'uvd-reuse-data-'))
  return { app: { getPath: () => userData } }
})
const SETTINGS = vi.hoisted(() => ({
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
}))
vi.mock('./settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./settings')>()),
  getSettings: () => SETTINGS
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
vi.mock('./info-store', async () => {
  const { InfoCache } = await import('./info-cache')
  const fs = await import('fs')
  const os = await import('os')
  const path = await import('path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uvd-reuse-cache-'))
  return { infoCache: new InfoCache(() => dir) }
})

const { listDownloads, pauseDownload, resumeDownload, startDownload } = await import('./downloader')
const { infoCache } = await import('./info-store')
const { infoKey } = await import('./info-cache')

interface Run {
  args: string[]
  finish: (code: number, stderr?: string) => void
}
let runs: Run[] = []
/** Runs that finish on their own, and how. */
let autoFinish: ((args: string[]) => { code: number; stderr?: string } | null) | null = null

spawn.mockImplementation((_bin: string, args: string[]) => {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() })
  const finish = (code: number, stderr = ''): void => {
    if (stderr) child.stderr.write(stderr)
    setImmediate(() => child.emit('close', code))
  }
  runs.push({ args, finish })
  const auto = autoFinish?.(args)
  if (auto) finish(auto.code, auto.stderr)
  return child
})

const find = (id: string): DownloadItem | undefined => listDownloads().find((d) => d.id === id)
const infoArg = (args: string[]): string | undefined => args[args.indexOf('--load-info-json') + 1]
const usesInfo = (args: string[]): boolean => args.includes('--load-info-json')

let n = 0
async function queue(): Promise<DownloadItem> {
  const url = `https://video.test/watch?v=reuse${++n}`
  infoCache.put(infoKey(url, SETTINGS), JSON.stringify({ id: `reuse${n}`, title: 'Talk' }))
  return startDownload({ url, mode: 'video', outputDir: mkdtempSync(join(tmpdir(), 'uvd-reuse-')) })
}

beforeEach(() => {
  runs = []
  autoFinish = null
  resolveUrl.mockReset()
  resolveUrl.mockImplementation(async (url: string) => ({ url }))
})

describe('starting a download from the detect\'s JSON', () => {
  it('reads the saved JSON instead of extracting the link again, then deletes it', async () => {
    autoFinish = () => ({ code: 0 })
    const item = await queue()
    await vi.waitFor(() => expect(find(item.id)?.state).toBe('completed'))
    expect(runs).toHaveLength(1)
    expect(usesInfo(runs[0].args)).toBe(true)
    // The link is not on the command line at all: the JSON stands in for it.
    expect(runs[0].args).not.toContain('--')
    expect(existsSync(infoArg(runs[0].args)!)).toBe(false)
  })

  it('runs once more, normally and without spending a retry, when the saved addresses expired', async () => {
    autoFinish = (args) =>
      usesInfo(args) ? { code: 1, stderr: 'ERROR: unable to download video data: HTTP Error 403: Forbidden\n' } : { code: 0 }
    const item = await queue()
    await vi.waitFor(() => expect(find(item.id)?.state).toBe('completed'))
    expect(runs.map((r) => usesInfo(r.args))).toEqual([true, false])
    expect(runs[1].args.slice(-2)).toEqual(['--', find(item.id)?.url])
    expect(find(item.id)?.attempts ?? 0).toBe(0)
  })

  it('fails a real failure as it always did', async () => {
    autoFinish = () => ({ code: 1, stderr: 'ERROR: [youtube] x: Private video\n' })
    const item = await queue()
    await vi.waitFor(() => expect(find(item.id)?.state).toBe('error'))
    expect(runs).toHaveLength(1)
  })

  it('extracts afresh after a pause and resume', async () => {
    const item = await queue()
    await vi.waitFor(() => expect(runs).toHaveLength(1))
    expect(usesInfo(runs[0].args)).toBe(true)
    pauseDownload(item.id)
    runs[0].finish(1)
    await vi.waitFor(() => expect(find(item.id)?.state).toBe('paused'))
    autoFinish = () => ({ code: 0 })
    resumeDownload(item.id)
    await vi.waitFor(() => expect(find(item.id)?.state).toBe('completed'))
    expect(runs.map((r) => usesInfo(r.args))).toEqual([true, false])
  })

  it('is not used for a link a resolver rewrote', async () => {
    autoFinish = () => ({ code: 0 })
    resolveUrl.mockImplementation(async () => ({ url: 'https://cdn.test/stream.m3u8', headers: { Referer: 'x' } }))
    const item = await queue()
    await vi.waitFor(() => expect(find(item.id)?.state).toBe('completed'))
    expect(usesInfo(runs[0].args)).toBe(false)
  })
})
