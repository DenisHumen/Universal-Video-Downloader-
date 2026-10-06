import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isRecord, ReadFailure, readJsonStore, RETRY_READ_MS, writeJsonAtomic } from './json-store'

/*
  A lock and a full disk are the failures a real file cannot be made to produce
  here, so they are pretended:

  - `busy`: reading this one file fails the way an antivirus scanner makes it
    fail on Windows;
  - `room`: bytes left on the disk. A write takes what fits and returns the
    shorter count, the next one fails with ENOSPC - what Linux and macOS do;
  - `chunk`: the most one write takes, with no error, as a write may;
  - `copyFailsFrom`: copying this file fails partway, and the destination is
    deleted, as libuv deletes it.

  Everything else is the real disk.
*/
const h = vi.hoisted(() => ({
  busy: '',
  room: undefined as number | undefined,
  chunk: 0,
  copyFailsFrom: ''
}))

vi.mock('fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs')>()
  const noSpace = (): Error => Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })
  const readFileSync = (path: unknown, options?: unknown): unknown => {
    if (h.busy && String(path) === h.busy) {
      throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' })
    }
    return real.readFileSync(path as string, options as BufferEncoding)
  }
  // Both forms: a buffer with an offset and a length, or a whole string.
  const writeSync = (fd: number, data: unknown, ...rest: unknown[]): number => {
    const bytes = typeof data === 'string' ? Buffer.from(data, 'utf-8') : (data as Buffer)
    const offset = typeof data === 'string' ? 0 : ((rest[0] as number | undefined) ?? 0)
    let length = typeof data === 'string' ? bytes.length : ((rest[1] as number | undefined) ?? bytes.length - offset)
    if (h.room !== undefined) {
      if (h.room <= 0) throw noSpace()
      length = Math.min(length, h.room)
      h.room -= length
    }
    if (h.chunk) length = Math.min(length, h.chunk)
    return real.writeSync(fd, bytes, offset, length)
  }
  const copyFileSync = (source: unknown, destination: unknown, mode?: number): void => {
    if (h.copyFailsFrom && String(source) === h.copyFailsFrom) {
      real.writeFileSync(destination as string, 'half a cop')
      real.unlinkSync(destination as string)
      throw noSpace()
    }
    real.copyFileSync(source as string, destination as string, mode)
  }
  const fake = { readFileSync, writeSync, copyFileSync }
  return { ...real, ...fake, default: { ...real, ...fake } }
})

/** The file as it is on disk, read past the pretend lock. */
async function peek(file: string): Promise<string> {
  const real = await vi.importActual<typeof import('fs')>('fs')
  return real.readFileSync(file, 'utf-8')
}

describe('json-store', () => {
  let dir = ''
  let file = ''

  const healthy = (): void => {
    h.busy = ''
    h.room = undefined
    h.chunk = 0
    h.copyFailsFrom = ''
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'uvd-store-'))
    file = join(dir, 'store.json')
    healthy()
  })

  afterEach(() => {
    healthy()
    rmSync(dir, { recursive: true, force: true })
  })

  const corruptCopies = (): string[] => readdirSync(dir).filter((n) => n.startsWith('store.json.corrupt-'))
  const temps = (): string[] => readdirSync(dir).filter((n) => n.endsWith('.tmp'))

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

    it('carries on after a write that took only part of the text', async () => {
      h.chunk = 3
      writeJsonAtomic(file, { title: 'Видео', n: [1, 2, 3] })
      expect(JSON.parse(await peek(file))).toEqual({ title: 'Видео', n: [1, 2, 3] })
    })

    /*
      The download folder and the settings folder are usually the same drive. A
      download fills it, the failure is saved - and the first write took what
      fit, said so with a short count, and was renamed over the good file, while
      the backup copy failed and libuv deleted the .bak it had opened.
    */
    it('leaves the file and its backup as they were when the disk fills partway', async () => {
      writeJsonAtomic(file, { v: 1 })
      writeJsonAtomic(file, { v: 2, queue: 'a'.repeat(200) })
      const before = await peek(file)

      h.room = 40
      expect(() => writeJsonAtomic(file, { v: 3, queue: 'b'.repeat(200) })).toThrow(/no space/)
      healthy()
      expect(await peek(file)).toBe(before)
      expect(JSON.parse(await peek(`${file}.bak`))).toEqual({ v: 1 })
      expect(temps()).toEqual([])
    })

    it('saves anyway when the backup cannot be made, and keeps the older backup', async () => {
      writeJsonAtomic(file, { v: 1 })
      writeJsonAtomic(file, { v: 2 })
      h.copyFailsFrom = file
      writeJsonAtomic(file, { v: 3 })
      healthy()
      expect(JSON.parse(await peek(file))).toEqual({ v: 3 })
      expect(JSON.parse(await peek(`${file}.bak`))).toEqual({ v: 1 })
      expect(temps()).toEqual([])
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

    /*
      Putting the backup back is a copy too. One that failed partway on a full
      disk deleted the file it was copying over, and the next launch, finding no
      file at all, started afresh with the good backup sitting right beside it.
    */
    it('leaves the damaged file in place when putting the backup back fails', async () => {
      writeFileSync(file, '{"theme":"da')
      writeFileSync(`${file}.bak`, '{"theme":"day"}')
      h.copyFailsFrom = `${file}.bak`
      expect(readJsonStore(file, 'test', isRecord)).toEqual({
        status: 'ok',
        data: { theme: 'day' },
        recovered: true
      })
      healthy()
      expect(await peek(file)).toBe('{"theme":"da')
      expect(temps()).toEqual([])
      // So the next launch recovers from the backup again, instead of finding nothing.
      expect(readJsonStore(file, 'test', isRecord)).toMatchObject({ status: 'ok', recovered: true })
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
