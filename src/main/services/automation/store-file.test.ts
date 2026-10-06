import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredWatches, Watch } from '@shared/automation'

/*
  watches.json on disk, through the real store. A truncated file used to read
  as an empty list, and the scheduler's next write replaced every hand-built
  watch with that empty list - measured at 1025 bytes before and 544 after one
  add, with nothing kept anywhere.
*/

const h = vi.hoisted(() => ({ dir: '', busy: '' }))

vi.mock('electron', () => ({ app: { getPath: () => h.dir } }))

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

type Store = typeof import('./store')

const watch = (id: string): Watch => ({
  id,
  url: `https://example.com/${id}`,
  title: id,
  provider: 'yummyani',
  translatorId: 't',
  quality: '720p',
  enabled: true,
  intervalMinutes: 360,
  nextCheckAt: 0,
  failures: 0,
  seen: [],
  steps: [{ id: 'd', kind: 'download', enabled: true }],
  createdAt: 1
})

const stored = (...ids: string[]): string => JSON.stringify({ watches: ids.map(watch), runs: {} })

async function peek(file: string): Promise<string> {
  const real = await vi.importActual<typeof import('fs')>('fs')
  return real.readFileSync(file, 'utf-8')
}

describe('watches.json', () => {
  let store: Store
  let file = ''

  const load = async (): Promise<Store> => {
    vi.resetModules()
    store = await import('./store')
    return store
  }

  beforeEach(() => {
    h.dir = mkdtempSync(join(tmpdir(), 'uvd-watches-'))
    h.busy = ''
    file = join(h.dir, 'watches.json')
  })

  afterEach(() => {
    vi.useRealTimers()
    h.busy = ''
    store?.flushWatches()
    rmSync(h.dir, { recursive: true, force: true })
  })

  it('comes back from its backup when the file was cut short', async () => {
    writeFileSync(file, stored('keep-me-1', 'keep-me-2').slice(0, 60))
    writeFileSync(`${file}.bak`, stored('keep-me-1', 'keep-me-2'))
    const { listWatches } = await load()
    expect(listWatches().map((w) => w.id).sort()).toEqual(['keep-me-1', 'keep-me-2'])
  })

  it('keeps the damaged file when there is nothing to recover from', async () => {
    const damaged = stored('keep-me-1').slice(0, 60)
    writeFileSync(file, damaged)
    const { addWatch, flushWatches, listWatches } = await load()
    expect(listWatches()).toEqual([])
    addWatch(watch('new'))
    flushWatches()
    const kept = readdirSync(h.dir).filter((n) => n.startsWith('watches.json.corrupt-'))
    expect(kept).toHaveLength(1)
    expect(await peek(join(h.dir, kept[0]))).toBe(damaged)
  })

  it('never saves over a file it could not read, and adds to it once it can', async () => {
    vi.useFakeTimers()
    writeFileSync(file, stored('keep-me-1'))
    const before = await peek(file)
    h.busy = file

    const { addWatch, flushWatches, listWatches } = await load()
    expect(listWatches()).toEqual([])
    addWatch(watch('added-meanwhile'))
    flushWatches()
    expect(await peek(file)).toBe(before)

    h.busy = ''
    vi.advanceTimersByTime(6000)
    expect(listWatches().map((w) => w.id).sort()).toEqual(['added-meanwhile', 'keep-me-1'])
    flushWatches()
    const saved = JSON.parse(await peek(file)) as StoredWatches
    expect(saved.watches.map((w) => w.id).sort()).toEqual(['added-meanwhile', 'keep-me-1'])
  })
})
