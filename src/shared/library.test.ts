import { afterEach, describe, expect, it, vi } from 'vitest'
import { librarySite, listLibrary, type LibraryEntry } from './library'

const entry = (id: string, overrides: Partial<LibraryEntry>): LibraryEntry => ({
  id,
  filepath: `/d/${id}.mp4`,
  url: 'https://media.example/1',
  title: id,
  finishedAt: 1,
  ...overrides
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listLibrary: grouping by site', () => {
  it('reads each link a fixed number of times, however many comparisons the sort makes', () => {
    const entries = Array.from({ length: 2000 }, (_, i) =>
      entry(`e${i}`, { url: `https://site${(i * 7919) % 2000}.example/${i}`, finishedAt: i })
    )
    const count = (list: LibraryEntry[]): number => {
      let reads = 0
      const Real = URL
      vi.stubGlobal(
        'URL',
        class extends Real {
          constructor(url: string, base?: string) {
            super(url, base)
            reads++
          }
        }
      )
      listLibrary({ version: 1, entries: list }, { group: 'site', limit: 1 })
      vi.unstubAllGlobals()
      return reads
    }
    expect(count(entries) / count(entries.slice(0, 200))).toBeLessThan(11)
  })
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
