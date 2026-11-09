import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { freeSpace } from './disk'

const gone = (): Error => Object.assign(new Error('nope'), { code: 'ENOENT' })

describe('how much room a folder has', () => {
  it('multiplies what the disk reports', async () => {
    expect(await freeSpace('D:/video', async () => ({ bsize: 4096, blocks: 1000, bavail: 10 }))).toEqual({
      bytes: 40960,
      reliable: true
    })
  })

  it('asks the nearest folder that exists when this one has not been made yet', async () => {
    const asked: string[] = []
    const free = await freeSpace('/data/video/YouTube', async (p) => {
      asked.push(p)
      if (p !== '/data') throw gone()
      return { bsize: 1, blocks: 10, bavail: 5 }
    })
    expect(asked).toEqual(['/data/video/YouTube', '/data/video', '/data'])
    expect(free?.bytes).toBe(5)
  })

  it('a full disk is an answer', async () => {
    expect((await freeSpace('D:/video', async () => ({ bsize: 4096, blocks: 1000, bavail: 0 })))?.bytes).toBe(0)
  })

  it('does not believe a share that reports no blocks', async () => {
    expect(await freeSpace('//192.168.1.10/media', async () => ({ bsize: 4096, blocks: 0, bavail: 0 }))).toBeUndefined()
  })

  it('takes a share for a warning at most', async () => {
    const free = await freeSpace('\\\\192.168.1.10\\media', async () => ({ bsize: 1, blocks: 10, bavail: 5 }))
    expect(free).toEqual({ bytes: 5, reliable: false })
  })

  it('a refusal or a failure is "do not know", not a full disk', async () => {
    const refused = Object.assign(new Error('no'), { code: 'EACCES' })
    expect(await freeSpace('D:/video', () => Promise.reject(refused))).toBeUndefined()
    expect(await freeSpace('', () => Promise.reject(refused))).toBeUndefined()
  })

  it('gives up at the root rather than going round for ever', async () => {
    expect(await freeSpace('/a/b', () => Promise.reject(gone()))).toBeUndefined()
  })

  it('reads the real thing here', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'uvd-disk-'))
    try {
      const free = await freeSpace(join(dir, 'not', 'made', 'yet'))
      expect(free?.bytes).toBeGreaterThan(0)
      expect(free?.reliable).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
