import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadItem } from '@shared/types'
import { entryFromItem, listLibrary, normaliseLibrary, seedFromHistory, upsertEntry, EMPTY_LIBRARY } from '@shared/library'

/*
  Plan 5.3 [v2] SE-4: the Library store lands first, with its migration and
  round-trip tests, before any Library UI.
*/

const h = vi.hoisted(() => ({ dir: '', trashed: [] as string[] }))
vi.mock('electron', () => ({
  app: { getPath: () => h.dir },
  shell: { trashItem: async (p: string) => void h.trashed.push(p) }
}))
vi.mock('./log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

const done = (id: string, filepath: string | undefined, finishedAt: number, extra: Partial<DownloadItem> = {}): DownloadItem =>
  ({
    id,
    url: `https://example.com/${id}`,
    title: `Video ${id}`,
    state: 'completed',
    percent: 100,
    outputDir: '/d',
    mode: 'video',
    createdAt: finishedAt - 10,
    finishedAt,
    filepath,
    ...extra
  }) as DownloadItem

beforeEach(() => {
  h.dir = mkdtempSync(join(tmpdir(), 'uvd-lib-'))
  h.trashed = []
  vi.resetModules()
})
afterEach(() => rmSync(h.dir, { recursive: true, force: true }))

describe('the library rules (shared)', () => {
  it('takes only finished rows that made a file', () => {
    expect(entryFromItem(done('a', '/d/a.mp4', 5))?.container).toBe('mp4')
    expect(entryFromItem(done('b', undefined, 5))).toBeNull()
    expect(entryFromItem({ ...done('c', '/d/c.mp4', 5), state: 'error' })).toBeNull()
  })

  it('upserts by file path, newest first, and is a no-op for the same entry', () => {
    let lib = upsertEntry(EMPTY_LIBRARY, entryFromItem(done('a', '/d/a.mp4', 1))!)
    lib = upsertEntry(lib, entryFromItem(done('b', '/d/b.mp4', 2))!)
    const again = upsertEntry(lib, entryFromItem(done('b', '/d/b.mp4', 2))!)
    expect(again).toBe(lib)
    lib = upsertEntry(lib, entryFromItem(done('a2', '/d/a.mp4', 3))!)
    expect(lib.entries.map((e) => e.id)).toEqual(['a2', 'b'])
    // The same job re-run into another file replaces its entry.
    lib = upsertEntry(lib, entryFromItem(done('b', '/d/b.mkv', 4))!)
    expect(lib.entries.map((e) => e.filepath)).toEqual(['/d/b.mkv', '/d/a.mp4'])
  })

  it('seeds from history idempotently, deduped by file path', () => {
    const history = [done('a', '/d/a.mp4', 1), done('a-again', '/d/a.mp4', 4), done('x', undefined, 2), { junk: true }]
    const one = seedFromHistory(history)
    expect(one.entries.map((e) => e.id)).toEqual(['a-again'])
    expect(seedFromHistory(history)).toEqual(one)
    expect(normaliseLibrary(one)).toEqual(one)
  })

  it('pages and filters by title words', () => {
    let lib = EMPTY_LIBRARY
    for (let i = 0; i < 30; i++) lib = upsertEntry(lib, entryFromItem(done(`v${i}`, `/d/${i}.mkv`, i, { title: i % 2 ? 'odd one' : 'even one' }))!)
    expect(listLibrary(lib, { limit: 10 }).entries).toHaveLength(10)
    expect(listLibrary(lib, { query: 'odd' }).total).toBe(15)
    expect(listLibrary(lib, { offset: 25, limit: 10 }).entries).toHaveLength(5)
  })
})

describe('the library store (main)', () => {
  it('seeds library.json from history.json on first run and never writes history.json', async () => {
    const historyText = JSON.stringify([done('a', '/d/a.mp4', 1), done('b', '/d/b.webm', 2)])
    writeFileSync(join(h.dir, 'history.json'), historyText)
    const lib = await import('./library')
    lib.loadLibrary()
    expect(readFileSync(join(h.dir, 'history.json'), 'utf-8')).toBe(historyText)
    const saved = JSON.parse(readFileSync(join(h.dir, 'library.json'), 'utf-8'))
    expect(saved.version).toBe(1)
    expect(saved.entries.map((e: { id: string }) => e.id)).toEqual(['b', 'a'])
    // A second launch reads the library, and does not seed again.
    writeFileSync(join(h.dir, 'history.json'), '[]')
    vi.resetModules()
    const again = await import('./library')
    again.loadLibrary()
    expect(again.queryLibrary({}).total).toBe(2)
  })

  it('round-trips what it records', async () => {
    const lib = await import('./library')
    lib.loadLibrary()
    lib.recordFinished(done('n', '/d/new.mp4', 9, { totalBytes: 1234, extractor: 'youtube' }))
    lib.flushLibrary()
    vi.resetModules()
    const back = await import('./library')
    back.loadLibrary()
    const [e] = back.queryLibrary({}).entries
    expect(e).toMatchObject({ id: 'n', filepath: '/d/new.mp4', sizeBytes: 1234, extractor: 'youtube', container: 'mp4' })
  })

  it('moves a file to the system trash, never unlinks it, and tells listeners', async () => {
    const lib = await import('./library')
    lib.loadLibrary()
    lib.recordFinished(done('t', '/d/t.mp4', 1))
    const heard = vi.fn()
    lib.onLibraryChanged(heard)
    expect(await lib.trashEntry('t')).toBe(true)
    expect(h.trashed).toEqual(['/d/t.mp4'])
    expect(heard).toHaveBeenCalled()
    expect(lib.queryLibrary({}).total).toBe(0)
  })

  it('reports files that are gone, and only checks paths the library holds', async () => {
    const lib = await import('./library')
    lib.loadLibrary()
    writeFileSync(join(h.dir, 'here.mp4'), 'x')
    lib.recordFinished(done('h', join(h.dir, 'here.mp4'), 1))
    lib.recordFinished(done('g', join(h.dir, 'gone.mp4'), 2))
    expect(
      await lib.missingFiles([join(h.dir, 'here.mp4'), join(h.dir, 'gone.mp4'), join(h.dir, 'stranger.mp4')])
    ).toEqual([join(h.dir, 'gone.mp4')])
    expect(existsSync(join(h.dir, 'here.mp4'))).toBe(true)
  })
})

describe('the library store: damaged and newer files', () => {
  it('never touches a corrupt history.json, and does not persist a library it could not seed', async () => {
    const corrupt = '[{"id": "a", "state": "compl'
    writeFileSync(join(h.dir, 'history.json'), corrupt)
    const lib = await import('./library')
    lib.loadLibrary()
    lib.recordFinished(done('n', '/d/n.mp4', 5))
    lib.flushLibrary()
    expect(readFileSync(join(h.dir, 'history.json'), 'utf-8')).toBe(corrupt)
    expect(existsSync(join(h.dir, 'history.json.bak'))).toBe(false)
    expect(existsSync(join(h.dir, 'library.json'))).toBe(false)
    // The entry is still there for this session.
    expect(lib.queryLibrary({}).total).toBe(1)
  })

  it('seeds from a readable history.json.bak without restoring it', async () => {
    const corrupt = 'not json'
    writeFileSync(join(h.dir, 'history.json'), corrupt)
    writeFileSync(join(h.dir, 'history.json.bak'), JSON.stringify([done('b', '/d/b.mp4', 1)]))
    const lib = await import('./library')
    lib.loadLibrary()
    expect(lib.queryLibrary({}).total).toBe(1)
    expect(readFileSync(join(h.dir, 'history.json'), 'utf-8')).toBe(corrupt)
  })

  it('reads a library.json from a newer version but never writes it', async () => {
    const newer = JSON.stringify({ version: 2, entries: [{ id: 'z', filepath: '/d/z.mp4', title: 'Z', url: 'u', finishedAt: 1, extra: 'kept' }] })
    writeFileSync(join(h.dir, 'library.json'), newer)
    const lib = await import('./library')
    lib.loadLibrary()
    expect(lib.queryLibrary({}).total).toBe(1)
    lib.recordFinished(done('n', '/d/n.mp4', 5))
    lib.flushLibrary()
    expect(readFileSync(join(h.dir, 'library.json'), 'utf-8')).toBe(newer)
  })
})

describe('isolation (SE-4)', () => {
  it('the downloader, clearFinished and finishedBeyond never import the library', () => {
    for (const file of ['downloader.ts', 'history.ts']) {
      const src = readFileSync(join(__dirname, file), 'utf-8')
      expect(src, file).not.toMatch(/from ['"]\.\/library['"]|shared\/library/)
    }
  })
})
