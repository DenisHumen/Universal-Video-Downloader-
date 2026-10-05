import { describe, expect, it } from 'vitest'
import { lineReader } from './engine-output'
import { splitOutputLines } from './ffmpeg-output'

const byNewline = (text: string): string[] => text.split(/\r?\n/)

function collect(split = byNewline): { lines: string[]; reader: ReturnType<typeof lineReader> } {
  const lines: string[] = []
  return { lines, reader: lineReader(split, (line) => lines.push(line)) }
}

describe('lineReader', () => {
  it('reassembles a Cyrillic letter that a chunk boundary cut in half', () => {
    // Every letter of a Russian title is two bytes. Decoding each chunk on its
    // own turned a split one into two U+FFFD, and the parsed destination then
    // named a file that did not exist.
    const line = '[download] Destination: C:\\Загрузки\\Привет мир.mp4'
    const bytes = Buffer.from(line + '\n', 'utf8')
    const cut = Buffer.from('[download] Destination: C:\\З', 'utf8').length - 1
    expect(bytes[cut - 1]).toBeGreaterThanOrEqual(0xc0) // really inside a letter

    const { lines, reader } = collect()
    reader.push(bytes.subarray(0, cut))
    expect(lines).toEqual([])
    reader.push(bytes.subarray(cut))
    expect(lines).toEqual([line])
    expect(lines[0]).not.toContain('\uFFFD')
  })

  it('survives a pipe that hands over one byte at a time', () => {
    const text = 'Привет\nмир\n'
    const { lines, reader } = collect()
    for (const byte of Buffer.from(text, 'utf8')) reader.push(Buffer.from([byte]))
    expect(lines).toEqual(['Привет', 'мир'])
  })

  it('carries a half line over to the next chunk', () => {
    const { lines, reader } = collect()
    reader.push('[Merger] Merging formats into "a')
    reader.push('b.mp4"\r\nnext')
    expect(lines).toEqual(['[Merger] Merging formats into "ab.mp4"'])
  })

  it('hands over the last line, which has no separator after it, on flush', () => {
    // The final word of a failed run - usually the reason it failed.
    const { lines, reader } = collect()
    reader.push('ERROR: something broke')
    expect(lines).toEqual([])
    reader.flush()
    expect(lines).toEqual(['ERROR: something broke'])
    reader.flush()
    expect(lines).toEqual(['ERROR: something broke'])
  })

  it('splits however it is told to, so ffmpeg chatter breaks on carriage returns', () => {
    const { lines, reader } = collect(splitOutputLines)
    reader.push('frame=1 time=00:00:01.00\rframe=2 time=00:00:02.00\r')
    expect(lines).toEqual(['frame=1 time=00:00:01.00', 'frame=2 time=00:00:02.00'])
  })
})
