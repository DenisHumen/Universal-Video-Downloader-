import { describe, expect, it } from 'vitest'
import { librarySite, listLibrary, type LibraryEntry } from './library'

const entry = (id: string, overrides: Partial<LibraryEntry>): LibraryEntry => ({
  id,
  filepath: `/d/${id}.mp4`,
  url: 'https://media.example/1',
  title: id,
  finishedAt: 1,
  ...overrides
})

describe('librarySite', () => {
  it('names a known site the same whichever way the file came in', () => {
    expect(librarySite({ url: 'https://youtu.be/abc' })).toBe('YouTube')
    expect(librarySite({ url: 'https://www.youtube.com/watch?v=abc', extractor: 'Youtube' })).toBe('YouTube')
  })

  it('goes by the extractor, then the host, and has nothing to say about a link it cannot read', () => {
    expect(librarySite({ url: 'https://media.example/1', extractor: 'ExampleTube' })).toBe('ExampleTube')
    expect(librarySite({ url: 'https://www.media.example/1', extractor: 'Universal' })).toBe('media.example')
    expect(librarySite({ url: 'uvd-direct://abc' })).toBeUndefined()
  })
})

describe('listLibrary by site', () => {
  it('keeps one site together, since the sections are drawn from runs of rows', () => {
    const entries = [
      entry('a', { url: 'https://youtu.be/a' }),
      entry('b', { url: 'https://vimeo.com/1' }),
      entry('c', { url: 'https://www.youtube.com/watch?v=c', extractor: 'Youtube' })
    ]
    const sites = listLibrary({ version: 1, entries }, { group: 'site' }).entries.map((e) => librarySite(e))
    expect(sites).toEqual(['Vimeo', 'YouTube', 'YouTube'])
  })
})
