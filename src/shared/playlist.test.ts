import { describe, expect, it } from 'vitest'
import type { PlaylistPlace } from './types'
import { numberedName, playlistFolderName, playlistNumber } from './playlist'

/*
  The number and the folder a playlist entry is given. main writes them into
  the engine's `-o`, and the settings screen shows them in its example name.
*/

const place = (overrides: Partial<PlaylistPlace> = {}): PlaylistPlace => ({
  title: 'Course',
  index: 7,
  count: 40,
  folder: true,
  numbered: true,
  ...overrides
})

describe('playlistNumber', () => {
  it('pads to the width of the whole list, so the files sort in order', () => {
    expect(playlistNumber(7, 40)).toBe('07 - ')
    expect(playlistNumber(7, 9)).toBe('7 - ')
  })

  // 100 entries is three digits: "07" would sort after "100".
  it('takes three digits for a list of a hundred', () => {
    expect(playlistNumber(7, 100)).toBe('007 - ')
    expect(playlistNumber(100, 100)).toBe('100 - ')
    expect(playlistNumber(7, 99)).toBe('07 - ')
  })
})

describe('numberedName', () => {
  it('puts the number in front of the default template', () => {
    expect(numberedName('%(title)s [%(id)s].%(ext)s', place())).toBe('07 - %(title)s [%(id)s].%(ext)s')
  })

  // Numbering the start of the template would number the uploader's folder,
  // and give every entry a folder of its own.
  it('numbers the file name, not a folder the template sorts into', () => {
    expect(numberedName('%(uploader)s/%(title)s.%(ext)s', place())).toBe(
      '%(uploader)s/07 - %(title)s.%(ext)s'
    )
    expect(numberedName('%(uploader)s\\%(playlist)s\\%(title)s.%(ext)s', place())).toBe(
      '%(uploader)s\\%(playlist)s\\07 - %(title)s.%(ext)s'
    )
  })

  // A slash inside a field is a date format; the engine puts the value in the
  // name, so splitting there would cut the field in half.
  it('ignores a slash inside a field', () => {
    expect(numberedName('%(upload_date>%Y/%m/%d)s %(title)s.%(ext)s', place())).toBe(
      '07 - %(upload_date>%Y/%m/%d)s %(title)s.%(ext)s'
    )
    expect(numberedName('%(uploader)s/%(upload_date>%Y/%m)s %(title)s.%(ext)s', place())).toBe(
      '%(uploader)s/07 - %(upload_date>%Y/%m)s %(title)s.%(ext)s'
    )
  })

  it('reads %% as a percent sign, not the start of a field', () => {
    expect(numberedName('100%%(raw)/%(title)s.%(ext)s', place())).toBe('100%%(raw)/07 - %(title)s.%(ext)s')
  })

  // A selection that starts at item 10 is files 10, 11, 12 - not 1, 2, 3.
  it('uses the position it is given, from wherever the selection starts', () => {
    const names = [10, 11, 12].map((index) => numberedName('%(title)s.%(ext)s', place({ index, count: 12 })))
    expect(names).toEqual(['10 - %(title)s.%(ext)s', '11 - %(title)s.%(ext)s', '12 - %(title)s.%(ext)s'])
  })

  it('leaves the name alone when numbering is off, or for a single video', () => {
    expect(numberedName('%(title)s.%(ext)s', place({ numbered: false }))).toBe('%(title)s.%(ext)s')
    expect(numberedName('%(title)s.%(ext)s', undefined)).toBe('%(title)s.%(ext)s')
  })
})

describe('playlistFolderName', () => {
  it('drops what a folder name cannot hold, the template sign included', () => {
    expect(playlistFolderName('Rust: 100% from zero / part 1')).toBe('Rust 100 from zero part 1')
    expect(playlistFolderName('tab\there')).toBe('tab here')
  })

  // Windows strips a trailing dot as it creates the folder, and the path the
  // app then looks in would not exist.
  it('ends on neither a dot nor a space', () => {
    expect(playlistFolderName('Wait for it...')).toBe('Wait for it')
    expect(playlistFolderName('Mix. ')).toBe('Mix')
  })

  it('falls back to a name for a title with nothing usable in it', () => {
    expect(playlistFolderName('')).toBe('playlist')
    expect(playlistFolderName('???')).toBe('playlist')
  })
})
