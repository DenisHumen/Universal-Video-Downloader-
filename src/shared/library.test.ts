import { afterEach, describe, expect, it, vi } from 'vitest'
import { keptLinkOf, librarySite, listLibrary, siteNameOf, type LibraryEntry } from './library'

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

describe('librarySite', () => {
  it('files a clip under the site of the video it was cut from', () => {
    expect(librarySite({ url: 'C:\\v\\a.mp4', originUrl: 'https://media.example/1' })).toBe('media.example')
  })
})

describe('keptLinkOf', () => {
  const link = 'https://media.example/1'

  it('is the link, for a whole video', () => {
    expect(keptLinkOf(entry('a', { filepath: '/d/Film [abc].mp4' }))).toBe(link)
    // A title with brackets of its own is not a cut.
    expect(keptLinkOf(entry('a', { filepath: '/d/Film [2024] [abc].mp4' }))).toBe(link)
  })

  it('has none for a cut, known or read off a name from before that was recorded', () => {
    expect(keptLinkOf(entry('a', { partial: true }))).toBeUndefined()
    expect(keptLinkOf(entry('a', { filepath: '/d/Film [abc] [0m05s-0m09s].mp4' }))).toBeUndefined()
    expect(keptLinkOf(entry('a', { filepath: '/d/Film [abc] [1h02m05.5s-end] (audio) (2).m4a' }))).toBeUndefined()
    expect(keptLinkOf(entry('a', { filepath: 'C:\\v\\Film [abc] [0m05s-end].mp4' }))).toBeUndefined()
  })

  it('reads only the file name: a folder called that is just a folder', () => {
    expect(keptLinkOf(entry('a', { filepath: '/d [0m05s-end]/Film.mp4' }))).toBe(link)
  })
})

describe('siteNameOf', () => {
  it('names a site, and not the words for having no extractor', () => {
    expect(siteNameOf('Youtube')).toBe('Youtube')
    for (const word of ['Generic', 'generic', 'Universal', 'Browser', 'HTML5MediaEmbed', undefined]) {
      expect(siteNameOf(word)).toBeUndefined()
    }
  })
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
  // The same links, made by the resolvers' own functions, in src/main/services/downloader.test.ts.
  const sniff = (page: string): string => `uvd-sniff://${btoa(page).replace(/=+$/, '')}`
  const direct = (payload: object): string => `uvd-direct://${btoa(JSON.stringify(payload)).replace(/=+$/, '')}`

  it('looks inside the app\'s internal links, as the folder per site does', () => {
    expect(librarySite({ url: sniff('https://www.media.example/film') })).toBe('media.example')
    expect(librarySite({ url: sniff('https://youtu.be/abc') })).toBe('YouTube')
    expect(librarySite({ url: direct({ url: 'https://cdn.example/a.m3u8', pageUrl: 'https://www.media.example/1' }) })).toBe('media.example')
    expect(librarySite({ url: direct({ url: 'https://cdn.example/a.m3u8' }) })).toBe('cdn.example')
  })

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
