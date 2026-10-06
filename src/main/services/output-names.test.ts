import { EventEmitter } from 'events'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PassThrough } from 'stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadItem, DownloadRequest } from '@shared/types'
import { listDownloads, pauseDownload, resumeDownload, startDownload } from './downloader'

/*
  The queue end to end, with the engine played back.

  `spawn` is a stand-in that records each command line and replays what the
  engine would print; the settings, the engine's location, the resolver, the
  process killer and Electron's userData are stand-ins too. The naming, the
  queue and the close handling are the real thing - which is the point: the
  rules in naming.ts only help if the downloader actually asks them.
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
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'uvd-names-data-'))
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

interface Run {
  args: string[]
  close: (code: number) => void
}

/** Every engine run so far, in order. */
let runs: Run[] = []
/** What the next run prints; it then exits 0, unless it is told to hang. */
let script: (args: string[]) => { stdout: string[]; hang?: boolean }

spawn.mockImplementation((_bin: string, args: string[]) => {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough()
  })
  const { stdout, hang } = script(args)
  for (const line of stdout) child.stdout.write(line + '\n')
  const close = (code: number): void => {
    child.emit('close', code)
  }
  runs.push({ args, close })
  if (!hang) setImmediate(() => setImmediate(() => close(0)))
  return child
})

const outputOf = (args: string[]): string => args[args.indexOf('-o') + 1]
const find = (id: string): DownloadItem | undefined => listDownloads().find((d) => d.id === id)

/** The file a template run writes, for a video with this title and id. */
const fileOf = (args: string[], title: string, id: string): string =>
  outputOf(args).replace('%(title)s', title).replace('%(id)s', id).replace('%(ext)s', 'mp4')
const skipped = (args: string[], id: string): string =>
  `[download] ${fileOf(args, 'Talk', id)} has already been downloaded`
const wrote = (args: string[], id: string): string =>
  `[download] Destination: ${fileOf(args, 'Talk', id)}`

function request(id: string, overrides: Partial<DownloadRequest> = {}): DownloadRequest {
  return {
    url: `https://video.test/watch?v=${id}`,
    mode: 'video',
    quality: 'best',
    outputDir: mkdtempSync(join(tmpdir(), 'uvd-names-')),
    ...overrides
  }
}

beforeEach(() => {
  runs = []
  script = () => ({ stdout: [] })
  resolveUrl.mockReset()
  resolveUrl.mockImplementation(async (url: string) => ({ url }))
})

describe('a name another download already has', () => {
  it('fetches a clip again as " (2)" instead of handing back the full video', async () => {
    // The engine said "has already been downloaded", exit 0, and the row completed on the clip.
    script = (args) => ({ stdout: [runs.length === 0 ? skipped(args, 'v1') : wrote(args, 'v1')] })
    const req = request('v1', { section: { start: 5, end: 9 } })
    const item = await startDownload(req)

    await vi.waitFor(() => expect(find(item.id)?.state).toBe('completed'))
    expect(runs.map((run) => outputOf(run.args))).toEqual([
      join(req.outputDir!, '%(title)s [%(id)s] [0m05s-0m09s].%(ext)s'),
      join(req.outputDir!, '%(title)s [%(id)s] [0m05s-0m09s] (2).%(ext)s')
    ])
    expect(find(item.id)?.filepath).toBe(join(req.outputDir!, 'Talk [v1] [0m05s-0m09s] (2).mp4'))
  })

  it("retries only once, even if the copy's name turns out to be taken too", async () => {
    script = (args) => ({ stdout: [skipped(args, 'v2')] })
    const item = await startDownload(request('v2', { quality: '720' }))

    await vi.waitFor(() => expect(find(item.id)?.state).toBe('completed'))
    expect(runs).toHaveLength(2)
  })

  it('completes on the file when the same request already finished into it', async () => {
    const req = request('v3')
    script = (args) => ({ stdout: [wrote(args, 'v3')] })
    const first = await startDownload(req)
    await vi.waitFor(() => expect(find(first.id)?.state).toBe('completed'))

    script = (args) => ({ stdout: [skipped(args, 'v3')] })
    const again = await startDownload(req)

    await vi.waitFor(() => expect(find(again.id)?.state).toBe('completed'))
    expect(runs).toHaveLength(2)
    expect(find(again.id)?.filepath).toBe(find(first.id)?.filepath)
  })
})

describe('the same link at two qualities', () => {
  it('runs one after the other, so the second gets a name of its own instead of sharing a .part', async () => {
    // Both started at once under one name: two engines appending to "Talk [v4].f140.m4a.part".
    const dir = mkdtempSync(join(tmpdir(), 'uvd-names-'))
    const link = (args: string[]): string => args[args.length - 1]
    let sameLinkRuns = 0
    script = (args) => {
      if (!link(args).endsWith('v4')) return { stdout: [], hang: true }
      sameLinkRuns++
      if (sameLinkRuns === 1) return { stdout: [wrote(args, 'v4')], hang: true }
      return { stdout: [sameLinkRuns === 2 ? skipped(args, 'v4') : wrote(args, 'v4')] }
    }
    const best = await startDownload(request('v4', { outputDir: dir }))
    const hd = await startDownload(request('v4', { outputDir: dir, quality: '720' }))
    const other = await startDownload(request('v5', { outputDir: dir }))

    // The 720p waits its turn; a different link queued behind it takes the free slot.
    expect(find(hd.id)?.state).toBe('queued')
    expect(find(other.id)?.state).not.toBe('queued')
    await vi.waitFor(() => expect(runs).toHaveLength(2))
    expect(runs.map((run) => link(run.args))).toEqual([best.url, other.url])

    await vi.waitFor(() => expect(find(best.id)?.log).toContain('Destination'))
    runs[0].close(0)
    await vi.waitFor(() => expect(find(hd.id)?.state).toBe('completed'))
    expect(runs).toHaveLength(4)
    expect(find(best.id)?.filepath).toBe(join(dir, 'Talk [v4].mp4'))
    expect(find(hd.id)?.filepath).toBe(join(dir, 'Talk [v4] (2).mp4'))

    runs[1].close(0)
    await vi.waitFor(() => expect(find(other.id)?.state).toBe('completed'))
  })
})

describe('streams captured from one page', () => {
  it('get names of their own, and keep them across pause and resume', async () => {
    resolveUrl.mockImplementation(async (url: string) => ({
      url: `https://cdn.test/${url.slice(-1)}.m3u8`,
      referer: 'https://page.test/watch/1'
    }))
    script = () => ({ stdout: [], hang: true })
    const dir = mkdtempSync(join(tmpdir(), 'uvd-names-'))
    const page = { mode: 'video', quality: 'best', title: 'Episode 1', outputDir: dir } as const

    const a = await startDownload({ ...page, url: 'https://page.test/stream/a' })
    const b = await startDownload({ ...page, url: 'https://page.test/stream/b' })
    await vi.waitFor(() => expect(runs).toHaveLength(2))
    // Both used to be "Episode 1.%(ext)s": two engines appending to one .part.
    expect(outputOf(runs[0].args)).toBe(join(dir, 'Episode 1.%(ext)s'))
    expect(outputOf(runs[1].args)).toBe(join(dir, 'Episode 1 (2).%(ext)s'))

    pauseDownload(b.id)
    runs[1].close(1)
    resumeDownload(b.id)
    await vi.waitFor(() => expect(runs).toHaveLength(3))
    expect(outputOf(runs[2].args)).toBe(join(dir, 'Episode 1 (2).%(ext)s'))
    expect(find(a.id)?.outputStem).toBe('Episode 1')
  })
})
