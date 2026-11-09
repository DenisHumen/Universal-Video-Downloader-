import { EventEmitter } from 'events'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PassThrough } from 'stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadItem } from '@shared/types'
import { listDownloads, pauseDownload, POSTPROCESS_PREFIX, PROGRESS_PREFIX, removeDownload, resumeDownload, startDownload } from './downloader'

/*
  What a row's figure says around a restart of the engine. The same stand-ins as
  resume-race.test.ts: the engine is played back line by line, the queue is real.
*/
type FakeEngine = EventEmitter & { stdout: PassThrough; stderr: PassThrough }
const spawn = vi.hoisted(() => vi.fn())
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  spawn
}))
vi.mock('electron', async () => {
  const fs = await import('fs')
  const os = await import('os')
  const path = await import('path')
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'uvd-figures-data-'))
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
vi.mock('../resolvers', () => ({ resolveUrl: (url: string) => Promise.resolve({ url }) }))

const engines: FakeEngine[] = []
spawn.mockImplementation(() => {
  const engine = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() })
  engines.push(engine)
  return engine
})

const find = (id: string): DownloadItem | undefined => listDownloads().find((d) => d.id === id)
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
const fetched = (bytes: number, of: number): string =>
  `${PROGRESS_PREFIX}downloading\t${bytes}\t${of}\tNA\t1000\t5\tNA\tNA\n`

/** One running row, with its engine. */
async function running(url: string): Promise<{ id: string; engine: FakeEngine }> {
  const outputDir = mkdtempSync(join(tmpdir(), 'uvd-figures-'))
  const before = engines.length
  const item = await startDownload({ url, mode: 'video', quality: 'best', outputDir })
  await vi.waitFor(() => expect(engines.length).toBe(before + 1))
  return { id: item.id, engine: engines[before] }
}

async function say(engine: FakeEngine, text: string): Promise<void> {
  engine.stdout.write(text)
  await tick()
  await tick()
}

beforeEach(() => {
  // A row left running would hold one of the three slots.
  for (const row of listDownloads()) removeDownload(row.id)
  engines.length = 0
})

describe('a resumed row', () => {
  it('keeps its figure until the new run says one, and then takes that one', async () => {
    const { id, engine } = await running('https://video.test/watch?v=held')
    await say(engine, fetched(50, 100))
    const reached = find(id)!.percent
    expect(reached).toBe(45)

    pauseDownload(id)
    engine.emit('close', null)
    resumeDownload(id)
    expect(find(id)?.percent).toBe(reached)

    await vi.waitFor(() => expect(engines.length).toBe(2))
    expect(find(id)?.percent).toBe(reached)

    // A partial that turned out shorter: the engine knows better than the last run did.
    await say(engines[1], fetched(10, 100))
    expect(find(id)?.percent).toBe(9)
    // And from there on it only goes forwards again.
    await say(engines[1], fetched(5, 100))
    expect(find(id)?.percent).toBe(9)
  })

  it('does not hold a merge\u2019s 90% over a fresh download', async () => {
    const { id, engine } = await running('https://video.test/watch?v=merge')
    await say(engine, fetched(100, 100))
    await say(engine, `${POSTPROCESS_PREFIX}started\tMerger\n`)
    expect(find(id)?.percent).toBe(90)

    pauseDownload(id)
    engine.emit('close', null)
    resumeDownload(id)
    await vi.waitFor(() => expect(engines.length).toBe(2))
    await say(engines[1], fetched(20, 100))
    expect(find(id)?.percent).toBe(18)
  })
})

describe('a file that is already on disk', () => {
  it('does not put a processing step on a row that is about to start over as a copy', async () => {
    const { id, engine } = await running('https://video.test/watch?v=copy')
    await say(engine, '[download] D:\\out\\Film [x].mp4 has already been downloaded\n')
    await say(engine, `${PROGRESS_PREFIX}finished\t1000\t1000\tNA\tNA\tNA\tNA\tNA\n`)
    await say(engine, `${POSTPROCESS_PREFIX}started\tMoveFiles\n`)
    await say(engine, `${POSTPROCESS_PREFIX}finished\tMoveFiles\n`)

    const row = find(id)!
    expect(row.state).toBe('downloading')
    expect(row.percent).toBe(0)
    expect(row.phase).toBeUndefined()
    expect(row.downloadedBytes).toBeUndefined()

    engine.emit('close', 0)
    await tick()
    expect(find(id)?.copySuffix).toBe(' (2)')
    expect(find(id)?.percent).toBe(0)
  })

  it('still counts what is fetched after it: one stream was there, the other was not', async () => {
    const { id, engine } = await running('https://video.test/watch?v=half')
    await say(engine, '[download] D:\\out\\Film [x].f137.mp4 has already been downloaded\n')
    await say(engine, `${PROGRESS_PREFIX}finished\t1000\t1000\tNA\tNA\tNA\tNA\tNA\n`)
    await say(engine, fetched(100, 100))
    await say(engine, `${POSTPROCESS_PREFIX}started\tMerger\n`)
    expect(find(id)?.state).toBe('processing')
    expect(find(id)?.percent).toBe(90)
  })
})
