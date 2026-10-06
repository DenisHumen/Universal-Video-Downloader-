import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isRecord, ReadFailure, readJsonStore, RETRY_READ_MS, writeJsonAtomic } from './json-store'

/*
  A lock is the one failure a real file cannot be made to produce here, so the
  read of one named file can be told to fail the way an antivirus scanner makes
  it fail on Windows. Everything else is the real disk.
*/
const h = vi.hoisted(() => ({ busy: '' }))

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

/** The file as it is on disk, read past the pretend lock. */
async function peek(file: string): Promise<string> {
  const real = await vi.importActual<typeof import('fs')>('fs')
  return real.readFileSync(file, 'utf-8')
}

describe('json-store', () => {
  let dir = ''
  let file = ''

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'uvd-store-'))
    file = join(dir, 'store.json')
    h.busy = ''
  })

  afterEach(() => {
    h.busy = ''
    rmSync(dir, { recursive: true, force: true })
  })

  const corruptCopies = (): string[] => readdirSync(dir).filter((n) => n.startsWith('store.json.corrupt-'))

  describe('writeJsonAtomic', () => {
    it('writes compact JSON unless asked to indent, and leaves no temp file behind', async () => {
      writeJsonAtomic(file, { a: 1, b: [2] })
      expect(await peek(file)).toBe('{"a":1,"b":[2]}')
      writeJsonAtomic(file, { a: 1 }, { indent: 2 })
      expect(await peek(file)).toBe('{\n  "a": 1\n}')
      expect(readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([])
    })

    it('keeps the version it replaced as .bak, unless told not to', async () => {
      writeJsonAtomic(file, { v: 1 })
      expect(existsSync(`${file}.bak`)).toBe(false)
      writeJsonAtomic(file, { v: 2 })
      expect(JSON.parse(await peek(`${file}.bak`))).toEqual({ v: 1 })

      const secret = join(dir, 'secrets.dat')
      writeJsonAtomic(secret, { k: 'x' }, { backup: false })
      writeJsonAtomic(secret, { k: 'y' }, { backup: false })
      expect(existsSync(`${secret}.bak`)).toBe(false)
    })

    it('creates the folder it is told to write into', async () => {
      const nested = join(dir, 'a', 'b', 'store.json')
      writeJsonAtomic(nested, [1])
      expect(await peek(nested)).toBe('[1]')
    })
  })

  describe('readJsonStore', () => {
    it('says a file that is not there is missing, and touches nothing', () => {
      expect(readJsonStore(file, 'test', isRecord)).toEqual({ status: 'missing' })
      expect(readdirSync(dir)).toEqual([])
    })

    it('reads a good file as it is', () => {
      writeFileSync(file, '{"theme":"day"}')
      expect(readJsonStore(file, 'test', isRecord)).toEqual({
        status: 'ok',
        data: { theme: 'day' },
        recovered: false
      })
      expect(corruptCopies()).toEqual([])
    })

    it('loads the backup when the file is damaged, puts it back, and keeps the damage aside', async () => {
      writeFileSync(file, '{"theme":"da')
      writeFileSync(`${file}.bak`, '{"theme":"day"}')

      expect(readJsonStore(file, 'test', isRecord)).toEqual({
        status: 'ok',
        data: { theme: 'day' },
        recovered: true
      })
      // The next launch reads the good version straight away.
      expect(await peek(file)).toBe('{"theme":"day"}')
      const kept = corruptCopies()
      expect(kept).toHaveLength(1)
      expect(await peek(join(dir, kept[0]))).toBe('{"theme":"da')
    })

    it('starts afresh without a backup, but keeps a copy of what was there', async () => {
      writeFileSync(file, 'not json at all')
      expect(readJsonStore(file, 'test', isRecord)).toEqual({ status: 'corrupt' })
      const kept = corruptCopies()
      expect(kept).toHaveLength(1)
      expect(await peek(join(dir, kept[0]))).toBe('not json at all')
    })

    // What a zeroed file can parse to: valid JSON, and no store at all.
    it.each([
      ['null', 'null'],
      ['an empty file', ''],
      ['a number', '0'],
      ['an array where an object belongs', '[]']
    ])('treats %s as damaged', (_label, text) => {
      writeFileSync(file, text)
      expect(readJsonStore(file, 'test', isRecord).status).toBe('corrupt')
      expect(corruptCopies()).toHaveLength(1)
    })

    it('ignores a backup that is damaged too', () => {
      writeFileSync(file, 'null')
      writeFileSync(`${file}.bak`, '{"half')
      expect(readJsonStore(file, 'test', isRecord).status).toBe('corrupt')
    })

    it('keeps only the newest three damaged copies', () => {
      for (const stamp of [1, 2, 3, 4, 5]) writeFileSync(`${file}.corrupt-${stamp}`, 'old')
      writeFileSync(file, '{')
      readJsonStore(file, 'test', isRecord)
      const kept = corruptCopies()
      expect(kept).toHaveLength(3)
      expect(kept).not.toContain('store.json.corrupt-1')
      expect(kept).not.toContain('store.json.corrupt-3')
      expect(kept).toContain('store.json.corrupt-5')
    })

    /*
      The save after a recovery would otherwise copy the damaged file over the
      good backup it had just been recovered from.
    */
    it('does not make a backup out of a damaged file on the next save', async () => {
      writeFileSync(file, '{"broken')
      expect(readJsonStore(file, 'test', isRecord).status).toBe('corrupt')
      writeJsonAtomic(file, { fresh: true })
      expect(existsSync(`${file}.bak`)).toBe(false)
      // And from then on, backups as usual.
      writeJsonAtomic(file, { fresh: 2 })
      expect(JSON.parse(await peek(`${file}.bak`))).toEqual({ fresh: true })
    })

    it('reports a locked file as unreadable and leaves it exactly as it was', async () => {
      writeFileSync(file, '{"downloadDir":"D:/Videos"}')
      h.busy = file
      expect(readJsonStore(file, 'test', isRecord)).toEqual({ status: 'unreadable' })
      expect(await peek(file)).toBe('{"downloadDir":"D:/Videos"}')
      expect(corruptCopies()).toEqual([])

      h.busy = ''
      expect(readJsonStore(file, 'test', isRecord).status).toBe('ok')
    })
  })

  describe('ReadFailure', () => {
    it('asks for another read only after a while, and forgets once a read works', () => {
      const failed = new ReadFailure()
      expect(failed.active).toBe(false)
      expect(failed.due(1_000_000)).toBe(false)

      failed.set(1_000_000)
      expect(failed.active).toBe(true)
      expect(failed.due(1_000_000 + RETRY_READ_MS - 1)).toBe(false)
      expect(failed.due(1_000_000 + RETRY_READ_MS)).toBe(true)

      failed.clear()
      expect(failed.active).toBe(false)
    })
  })
})
