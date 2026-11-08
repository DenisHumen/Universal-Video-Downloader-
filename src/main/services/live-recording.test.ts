import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  appendableFragments,
  appendedFragment,
  joinFragments,
  keptFile,
  piecesOnDisk,
  remuxArgs,
  removePieces,
  savedPath
} from './live-recording'

/*
  What Stop and Save makes of the pieces a stopped recording leaves. The same
  code against real streams and a real engine is in live-stop.real.test.ts.
*/

describe('appendableFragments', () => {
  const part = 'rec.mp4.part'

  it('takes an unbroken run, in number order and not name order', () => {
    expect(appendableFragments([`${part}-Frag10`, `${part}-Frag9`, `${part}-Frag11`], part)).toEqual([
      `${part}-Frag9`,
      `${part}-Frag10`,
      `${part}-Frag11`
    ])
  })

  it('stops at a hole, because the stream would jump there', () => {
    expect(appendableFragments([`${part}-Frag3`, `${part}-Frag5`], part)).toEqual([`${part}-Frag3`])
  })

  it('leaves out a fragment still being written, and other files', () => {
    expect(appendableFragments([`${part}-Frag3.part`, 'rec2.mp4.part-Frag1', part], part)).toEqual([])
  })

  it('starts after what the engine says it appended', () => {
    const names = [`${part}-Frag4`, `${part}-Frag5`, `${part}-Frag6`]
    expect(appendableFragments(names, part, 4)).toEqual([`${part}-Frag5`, `${part}-Frag6`])
  })

  it('takes nothing when the next one in line is the one missing', () => {
    expect(appendableFragments([`${part}-Frag6`], part, 4)).toEqual([])
  })
})

describe('appendedFragment', () => {
  it('reads the engine note, and shrugs at anything else', () => {
    expect(appendedFragment('{"downloader":{"current_fragment":{"index":12},"fragment_count":40}}')).toBe(12)
    expect(appendedFragment('{"downloader":{}}')).toBeUndefined()
    expect(appendedFragment('not json')).toBeUndefined()
  })
})

describe('savedPath', () => {
  it('keeps a video container and turns anything else into an mp4', () => {
    expect(savedPath([join('d', 'Show.mkv')], 'video')).toMatchObject({ base: 'Show', ext: 'mkv' })
    expect(savedPath([join('d', 'Show.ts')], 'video')).toMatchObject({ base: 'Show', ext: 'mp4' })
  })

  it('names a pair of streams after the video, without the format', () => {
    const named = savedPath([join('d', 'Show.f137.mp4'), join('d', 'Show.f140.m4a')], 'video')
    expect(named).toMatchObject({ base: 'Show', ext: 'mp4' })
  })

  it('leaves a title that only looks like a format alone', () => {
    expect(savedPath([join('d', 'Have.fun.mp4')], 'video').base).toBe('Have.fun')
  })

  it('keeps an audio download to audio', () => {
    expect(savedPath([join('d', 'Show.mp4')], 'audio').ext).toBe('m4a')
  })
})

describe('remuxArgs', () => {
  it('copies, and takes only sound and picture from every input', () => {
    const args = remuxArgs(['a.part', 'b.part'], 'out.mp4', 'video')
    expect(args.join(' ')).toContain('-map 0:v? -map 0:a? -map 1:v? -map 1:a?')
    expect(args.join(' ')).toContain('-c copy')
    expect(args).not.toContain('-c:v')
    expect(args[args.length - 1]).toBe('out.mp4')
  })

  it('drops the picture for an audio download', () => {
    expect(remuxArgs(['a.part'], 'out.m4a', 'audio').join(' ')).not.toContain(':v?')
  })

  it('only asks mp4-family files for faststart', () => {
    expect(remuxArgs(['a'], 'out.mp4', 'video')).toContain('-movflags')
    expect(remuxArgs(['a'], 'out.mkv', 'video')).not.toContain('-movflags')
  })
})

describe('the pieces on disk', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'uvd-pieces-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('finds a partial, a finished stream, and nothing where nothing was written', () => {
    const a = join(dir, 'a.mp4')
    const b = join(dir, 'b.m4a')
    const c = join(dir, 'c.mp4')
    const d = join(dir, 'd.mp4')
    writeFileSync(`${a}.part`, 'data')
    writeFileSync(b, 'data')
    writeFileSync(`${d}.part`, '')
    const pieces = piecesOnDisk([a, b, c, d])
    expect(pieces.map((p) => [p.file, p.whole])).toEqual([
      [`${a}.part`, false],
      [b, true]
    ])
  })

  it('prefers the partial when both exist: the engine was still writing', () => {
    const a = join(dir, 'a.mp4')
    writeFileSync(a, 'old')
    writeFileSync(`${a}.part`, 'new')
    expect(piecesOnDisk([a])[0].file).toBe(`${a}.part`)
  })

  it('joins waiting fragments on the end, in order, and lets them go', async () => {
    const a = join(dir, 'a.mp4')
    writeFileSync(`${a}.part`, 'one')
    writeFileSync(`${a}.part-Frag2`, 'two')
    writeFileSync(`${a}.part-Frag3`, 'three')
    writeFileSync(`${a}.part-Frag5`, 'five')
    const [piece] = piecesOnDisk([a])
    await joinFragments(piece)
    expect(readFileSync(`${a}.part`, 'utf-8')).toBe('onetwothree')
    expect(piecesOnDisk([a])[0].fragments).toEqual([`${a}.part-Frag5`])
  })

  it('builds the file from fragments alone', async () => {
    const a = join(dir, 'a.mp4')
    writeFileSync(`${a}.part-Frag1`, 'one')
    const [piece] = piecesOnDisk([a])
    await joinFragments(piece)
    expect(readFileSync(`${a}.part`, 'utf-8')).toBe('one')
  })

  it('removes what belonged to the recording and nothing else', () => {
    const a = join(dir, 'a.mp4')
    writeFileSync(`${a}.part`, 'x')
    writeFileSync(`${a}.ytdl`, '{}')
    writeFileSync(`${a}.part-Frag9`, 'x')
    const other = join(dir, 'a.mp4.part2')
    const neighbour = join(dir, 'ab.mp4.part')
    writeFileSync(other, 'x')
    writeFileSync(neighbour, 'x')
    removePieces(piecesOnDisk([a]))
    expect(piecesOnDisk([a])).toEqual([])
    expect(readFileSync(other, 'utf-8')).toBe('x')
    expect(readFileSync(neighbour, 'utf-8')).toBe('x')
  })

  it('names the file that is kept', () => {
    const a = join(dir, 'a.mp4')
    writeFileSync(`${a}.part`, 'x')
    expect(keptFile(piecesOnDisk([a]))).toBe(`${a}.part`)
    expect(keptFile([])).toBeUndefined()
  })
})
