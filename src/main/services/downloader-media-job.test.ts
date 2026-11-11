import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadItem } from '@shared/types'

/*
  A trim or convert, up to the moment ffmpeg exits: what it leaves on the row,
  and so in the Library. ffmpeg itself is pretended; the output file is real.
*/

const h = vi.hoisted(() => ({ dir: '', probes: [] as (() => void)[], held: false, encodes: 0 }))
vi.mock('electron', () => ({ app: { getPath: () => h.dir }, shell: {} }))
vi.mock('./log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('./settings', () => ({ getSettings: () => ({ concurrentDownloads: 1, downloadDir: h.dir }) }))
vi.mock('./ytdlp', () => ({ ytdlpBinaryPath: () => '', ensureYtdlp: async () => undefined, ytdlpSpawnOptions: () => ({}) }))
vi.mock('./ffmpeg', async (real) => ({
  ...(await real<typeof import('./ffmpeg')>()),
  probeMedia: async () => {
    if (h.held) await new Promise<void>((release) => h.probes.push(release))
    return { duration: 600, hasVideo: true, hasAudio: true }
  },
  runFfmpeg: (args: string[]) => {
    h.encodes++
    writeFileSync(args[args.length - 1], 'twelve bytes')
    return { child: { kill: () => undefined }, done: Promise.resolve({ code: 0, stderr: '' }) }
  }
}))

beforeEach(() => {
  h.probes = []
  h.held = false
  h.encodes = 0
  h.dir = mkdtempSync(join(tmpdir(), 'uvd-job-'))
  vi.resetModules()
})
afterEach(() => rmSync(h.dir, { recursive: true, force: true }))

async function runJob(req: Partial<Parameters<typeof import('./downloader').startMediaJob>[0]>): Promise<DownloadItem> {
  const source = join(h.dir, 'film.mp4')
  writeFileSync(source, 'the whole film')
  const { startMediaJob, downloadEvents } = await import('./downloader')
  const finished = new Promise<DownloadItem>((resolve) => {
    downloadEvents.on('updated', (item: DownloadItem) => {
      if (item.state === 'completed' || item.state === 'error') resolve(item)
    })
  })
  startMediaJob({ kind: 'trim', sourcePath: source, title: 'Film', range: { start: 10, end: 70 }, ...req })
  return finished
}

describe('a finished media job', () => {
  it('has the size of its file and the length of what it cut', async () => {
    const item = await runJob({})
    expect(item.state).toBe('completed')
    expect(item.totalBytes).toBe('twelve bytes'.length)
    expect(item.duration).toBe(60)
  })

  it('remembers the page its source came from, apart from what it fetched', async () => {
    const item = await runJob({ originUrl: 'https://example.com/film', uploader: 'Someone' })
    expect(item.originUrl).toBe('https://example.com/film')
    expect(item.uploader).toBe('Someone')
    expect(item.sourceUrl).toBeUndefined()
  })

  it('takes only a real web address as that page', async () => {
    const item = await runJob({ originUrl: 'file:///etc/passwd' })
    expect(item.originUrl).toBeUndefined()
  })
})

/*
  The probe takes a moment, and the row can be paused and resumed inside it.
  The second run sets the same state the first one checks for on its way out,
  so both went on to encode into one file.
*/
describe('a media job restarted while it is still looking at its file', () => {
  it('encodes once', async () => {
    h.held = true
    const source = join(h.dir, 'film.mp4')
    writeFileSync(source, 'the whole film')
    const { startMediaJob, pauseDownload, resumeDownload, listDownloads } = await import('./downloader')
    const item = startMediaJob({ kind: 'trim', sourcePath: source, title: 'Film', range: { start: 10, end: 70 } })
    await vi.waitFor(() => expect(h.probes).toHaveLength(1))
    pauseDownload(item.id)
    resumeDownload(item.id)
    await vi.waitFor(() => expect(h.probes).toHaveLength(2))
    for (const release of h.probes) release()
    await vi.waitFor(() => expect(listDownloads().find((d) => d.id === item.id)?.state).toBe('completed'))
    expect(h.encodes).toBe(1)
  })
})
