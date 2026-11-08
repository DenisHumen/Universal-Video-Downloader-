import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadItem } from '@shared/types'
import { entryFromItem, listLibrary, normaliseLibrary, noteRemote, pageLinkOf, seedFromHistory, upsertEntry, EMPTY_LIBRARY } from '@shared/library'

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

describe('deleting by file, from a queue row', () => {
  it('moves a file the library holds to the trash, and says when it holds no such file', async () => {
    const lib = await import('./library')
    lib.loadLibrary()
    lib.recordFinished(done('t', '/d/t.mp4', 1))
    expect(await lib.trashFile('/d/stranger.mp4')).toBe('noEntry')
    expect(h.trashed).toEqual([])
    expect(await lib.trashFile('/d/t.mp4')).toBe('trashed')
    expect(h.trashed).toEqual(['/d/t.mp4'])
  })

  it('goes back to the page through a clip’s origin, and has none for a local file', () => {
    expect(pageLinkOf({ url: '/v/a.mp4', originUrl: 'https://example.com/a' })).toBe('https://example.com/a')
    expect(pageLinkOf({ url: 'x', sourceUrl: 'https://example.com/b' })).toBe('https://example.com/b')
    expect(pageLinkOf({ url: '/v/a.mp4' })).toBeUndefined()
    expect(pageLinkOf({ url: 'uvd-rezka://1' })).toBeUndefined()
  })
})

describe('entries whose file is gone', () => {
  it('forgets every missing entry in the library, keeps what went to a share, and touches no file', async () => {
    const lib = await import('./library')
    lib.loadLibrary()
    writeFileSync(join(h.dir, 'here.mp4'), 'x')
    lib.recordFinished(done('here', join(h.dir, 'here.mp4'), 1))
    lib.recordFinished(done('gone1', join(h.dir, 'gone1.mp4'), 2))
    lib.recordFinished(done('gone2', join(h.dir, 'gone2.mp4'), 3))
    lib.recordFinished(done('shared', join(h.dir, 'shared.mp4'), 4, { remotePath: 'anime/ep.mp4' }))
    expect(await lib.countMissing()).toBe(2)
    expect(await lib.forgetMissing()).toBe(2)
    expect(lib.queryLibrary({}).entries.map((e) => e.id).sort()).toEqual(['here', 'shared'])
    expect(existsSync(join(h.dir, 'here.mp4'))).toBe(true)
    expect(h.trashed).toEqual([])
    expect(await lib.forgetMissing()).toBe(0)
  })

  it('locates a file by name in a folder, nested too, and re-keys the entry with the file’s facts', async () => {
    const lib = await import('./library')
    lib.loadLibrary()
    lib.recordFinished(done('a', join(h.dir, 'old', 'Film.MP4'), 1, { totalBytes: 1 }))
    const moved = join(h.dir, 'moved', 'deep')
    mkdirSync(moved, { recursive: true })
    writeFileSync(join(moved, 'Film.MP4'), 'four')
    expect(await lib.locateInFolder('a', join(h.dir, 'moved'))).toEqual({ status: 'found', path: join(moved, 'Film.MP4') })
    expect(lib.queryLibrary({}).entries[0]).toMatchObject({ filepath: join(moved, 'Film.MP4'), sizeBytes: 4, container: 'mp4' })
  })

  it('reports no match by name, so the view can offer to pick the file by hand', async () => {
    const lib = await import('./library')
    lib.loadLibrary()
    lib.recordFinished(done('a', join(h.dir, 'old', 'Film.mp4'), 1))
    expect(await lib.locateInFolder('a', h.dir)).toEqual({ status: 'noMatch', name: 'Film.mp4' })
    writeFileSync(join(h.dir, 'renamed.mp4'), 'x')
    expect(await lib.locateFile('a', join(h.dir, 'renamed.mp4'))).toMatchObject({ status: 'found' })
  })

  it('refuses a file another entry holds, a path that is no file, and an entry it does not know', async () => {
    const lib = await import('./library')
    lib.loadLibrary()
    writeFileSync(join(h.dir, 'b.mp4'), 'x')
    lib.recordFinished(done('a', join(h.dir, 'a.mp4'), 1))
    lib.recordFinished(done('b', join(h.dir, 'b.mp4'), 2))
    expect(await lib.locateFile('a', join(h.dir, 'b.mp4'))).toEqual({ status: 'taken' })
    expect(await lib.locateFile('a', h.dir)).toEqual({ status: 'failed' })
    expect(await lib.locateFile('a', join(h.dir, 'nowhere.mp4'))).toEqual({ status: 'failed' })
    expect(await lib.locateFile('stranger', join(h.dir, 'b.mp4'))).toEqual({ status: 'failed' })
    expect(lib.libraryEntry('a')?.filepath).toBe(join(h.dir, 'a.mp4'))
  })

  // The trust boundary: the channel takes an entry id and a way of looking, never a path.
  it('never takes a path from the renderer when locating', () => {
    const preload = readFileSync(join(__dirname, '..', '..', 'preload', 'index.ts'), 'utf-8')
    expect(preload).toMatch(/locateLibraryEntry: \(id: string, how: 'folder' \| 'file'\)/)
    const ipc = readFileSync(join(__dirname, '..', 'ipc.ts'), 'utf-8')
    expect(ipc).toMatch(/const path = picked\.filePaths\[0\]/)
  })
})

// A watch uploaded the episode and deleted it here: the Library said "file not found".
describe('an entry sent to a share', () => {
  it('learns where the file went, keeping its path as the key', () => {
    const lib = upsertEntry(EMPTY_LIBRARY, entryFromItem(done('a', '/d/ep.mp4', 100))!)
    const moved = noteRemote(lib, 'a', 'anime/Show/S01E06.mp4')
    expect(moved.entries[0]).toMatchObject({ filepath: '/d/ep.mp4', remotePath: 'anime/Show/S01E06.mp4' })
    expect(noteRemote(moved, 'a', 'anime/Show/S01E06.mp4')).toBe(moved)
    expect(noteRemote(moved, 'nope', 'x')).toBe(moved)
  })

  it('is recorded when the finished row loses its file to the upload', async () => {
    const lib = await import('./library')
    lib.loadLibrary()
    lib.recordFinished(done('b', '/d/ep6.mp4', 200))
    lib.recordFinished(done('b', undefined, 200, { remotePath: 'anime/Show/S01E06.mp4' }))
    const [entry] = lib.queryLibrary({}).entries
    expect(entry).toMatchObject({ id: 'b', filepath: '/d/ep6.mp4', remotePath: 'anime/Show/S01E06.mp4' })
  })
})
