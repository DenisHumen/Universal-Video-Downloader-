import { describe, expect, it } from 'vitest'
import { EMPTY_LIBRARY, entryFromItem, relocateEntry, upsertEntry } from './library'
import { cookieBrowsersFor, type DownloadItem } from './types'

describe('cookieBrowsersFor', () => {
  it('does not offer on Windows what the engine cannot read there', () => {
    const offered = cookieBrowsersFor('win32')
    expect(offered).toContain('firefox')
    expect(offered).not.toContain('chrome')
    expect(offered).not.toContain('edge')
    expect(offered).not.toContain('safari')
  })

  it('offers Safari only on a Mac, and Chrome everywhere else', () => {
    expect(cookieBrowsersFor('darwin')).toEqual(expect.arrayContaining(['safari', 'chrome']))
    expect(cookieBrowsersFor('linux')).toContain('chrome')
    expect(cookieBrowsersFor('linux')).not.toContain('safari')
  })
})

describe('relocateEntry', () => {
  const item = { id: 'a', state: 'completed', filepath: '/d/ep.mp4', url: 'https://x/1', title: 't', createdAt: 1 } as DownloadItem
  const lib = upsertEntry(EMPTY_LIBRARY, entryFromItem(item)!)

  it('follows a rename', () => {
    expect(relocateEntry(lib, 'a', { filepath: '/d/Show S01E01.mp4' }).entries[0].filepath).toBe('/d/Show S01E01.mp4')
  })

  it('keeps the path as its key when the file went to a share', () => {
    const moved = relocateEntry(lib, 'a', { filepath: undefined, remotePath: 'anime/ep.mp4' })
    expect(moved.entries[0]).toMatchObject({ filepath: '/d/ep.mp4', remotePath: 'anime/ep.mp4' })
  })

  it('leaves the library alone for an entry it does not hold', () => {
    expect(relocateEntry(lib, 'nope', { remotePath: 'x' })).toBe(lib)
  })
})
