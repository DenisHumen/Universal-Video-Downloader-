import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadItem, DownloadsChanged } from '@shared/types'
import { forwardQueueEvents } from './queue-events'

/*
  The download history on disk, through the real downloader: how it is written,
  what it keeps, and that a history.json which could not be read is never
  replaced by a session's handful of rows.
*/

const h = vi.hoisted(() => ({ dir: '', busy: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => h.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))

vi.mock('fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs')>()
  const readFileSync = (path: unknown, options?: unknown): unknown => {
    if (h.busy && String(path) === h.busy) {
      throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' })
    }
    return real.readFileSync(path as string, options as BufferEncoding)
  }
  return { ...real, default: { ...real, readFileSync }, readFileSync }
})

type Downloader = typeof import('./downloader')
type Settings = typeof import('./settings')

const row = (id: string, overrides: Partial<DownloadItem> = {}): DownloadItem => ({
  id,
  url: `https://example.com/${id}`,
  title: id,
  mode: 'video',
  state: 'completed',
  percent: 100,
  outputDir: h.dir,
  createdAt: 1,
  ...overrides
})

async function peek(file: string): Promise<string> {
  const real = await vi.importActual<typeof import('fs')>('fs')
  return real.readFileSync(file, 'utf-8')
}

describe('history.json', () => {
  let downloader: Downloader
  let settings: Settings
  let history = ''

  const start = async (rows: unknown[], stored: Record<string, unknown> = {}): Promise<void> => {
    writeFileSync(join(h.dir, 'settings.json'), JSON.stringify(stored))
    writeFileSync(history, JSON.stringify(rows))
    vi.resetModules()
    settings = await import('./settings')
    downloader = await import('./downloader')
  }

  beforeEach(() => {
    h.dir = mkdtempSync(join(tmpdir(), 'uvd-history-'))
    h.busy = ''
    history = join(h.dir, 'history.json')
  })

  afterEach(() => {
    h.busy = ''
    // Nothing left on a timer to write into a folder that is about to go.
    settings?.flushSettings()
    downloader?.flushHistory()
    rmSync(h.dir, { recursive: true, force: true })
  })

  it('is written compact, with a completed row’s log cut down to its tail', async () => {
    await start([row('done', { log: 'x'.repeat(4000) }), row('failed', { state: 'error', log: 'y'.repeat(4000) })])
    downloader.loadHistory()
    downloader.flushHistory()

    const text = await peek(history)
    expect(text).not.toContain('\n')
    const saved = JSON.parse(text) as DownloadItem[]
    expect(saved.find((i) => i.id === 'done')?.log).toHaveLength(1000)
    expect(saved.find((i) => i.id === 'failed')?.log).toHaveLength(4000)
    // The live row keeps everything; only the file is trimmed.
    expect(downloader.getDownload('done')?.log).toHaveLength(4000)
  })

  it('skips an entry that cannot be a row instead of losing every row after it', async () => {
    await start([row('a'), null, { title: 'no id' }, row('b')])
    downloader.loadHistory()
    expect(downloader.listDownloads().map((i) => i.id).sort()).toEqual(['a', 'b'])
  })

  it('keeps only as many finished rows as asked, and every unfinished one', async () => {
    const finished = Array.from({ length: 12 }, (_, n) => row(`done-${n}`, { finishedAt: 100 + n }))
    await start(
      [...finished, row('failed', { state: 'error' }), row('paused', { state: 'paused' })],
      { keepFinished: 10 }
    )
    const removed: string[] = []
    downloader.downloadEvents.on('removed', (id: string) => removed.push(id))

    downloader.loadHistory()
    expect(removed).toEqual(['done-0', 'done-1'])
    const ids = downloader.listDownloads().map((i) => i.id)
    expect(ids).toHaveLength(12)
    expect(ids).toContain('failed')
    expect(ids).toContain('paused')
  })

  // The row that just finished is the newest; an older one makes room for it.
  it('applies the limit as a row finishes, without dropping that row', async () => {
    const finished = Array.from({ length: 10 }, (_, n) => row(`done-${n}`, { finishedAt: 100 + n }))
    await start([...finished, row('paused', { state: 'paused', createdAt: 0 })], { keepFinished: 10 })
    downloader.loadHistory()
    const removed: string[] = []
    downloader.downloadEvents.on('removed', (id: string) => removed.push(id))

    downloader.cancelDownload('paused')
    expect(removed).toEqual(['done-0'])
    expect(downloader.getDownload('paused')?.state).toBe('canceled')
  })

  it('keeps everything when no limit is set', async () => {
    await start(Array.from({ length: 30 }, (_, n) => row(`done-${n}`)))
    downloader.loadHistory()
    expect(downloader.listDownloads()).toHaveLength(30)
  })

  it('is never written over while it cannot be read, and nothing in it is lost', async () => {
    await start([row('from-last-week'), row('failed-last-week', { state: 'error' })])
    const before = await peek(history)
    const touched = statSync(history).mtimeMs

    h.busy = history
    downloader.loadHistory()
    expect(downloader.listDownloads()).toEqual([])
    downloader.flushHistory()
    downloader.flushHistory(true)
    expect(await peek(history)).toBe(before)
    expect(statSync(history).mtimeMs).toBe(touched)

    /*
      The lock lets go: the next save reads first, and the rows come back - to
      the window, through the same forwarding the app uses, and not as a toast
      for each, since they finished or failed in another session.
    */
    h.busy = ''
    const batches: DownloadsChanged[] = []
    const notified: string[] = []
    let deferred: (() => void) | undefined
    forwardQueueEvents(
      downloader.downloadEvents,
      {
        changed: (batch) => batches.push(batch),
        progress: () => undefined,
        notify: (i) => notified.push(i.id),
        forget: () => undefined,
        syncOs: () => undefined
      },
      (flush) => {
        deferred = flush
      }
    )
    downloader.flushHistory(true)
    deferred?.()
    expect(notified).toEqual([])
    expect(batches.flatMap((b) => b.updated.map((i) => i.id)).sort()).toEqual([
      'failed-last-week',
      'from-last-week'
    ])
    expect((JSON.parse(await peek(history)) as DownloadItem[]).map((i) => i.id).sort()).toEqual([
      'failed-last-week',
      'from-last-week'
    ])
  })

  it('comes back from its backup when the file was left damaged', async () => {
    await start([])
    writeFileSync(history, '[{"id":"half-writ')
    writeFileSync(`${history}.bak`, JSON.stringify([row('saved')]))
    downloader.loadHistory()
    expect(downloader.getDownload('saved')).toBeDefined()
    expect(readdirSync(h.dir).some((n) => n.startsWith('history.json.corrupt-'))).toBe(true)
  })
})
