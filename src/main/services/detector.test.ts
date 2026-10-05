import { beforeEach, describe, expect, it, vi } from 'vitest'
import { detect, playlistEntries } from './detector'

/*
  `spawn` is replaced so a test can prove the engine was never started; the
  settings, which would otherwise read Electron's userData, are a stand-in.
  Everything else - URL handling, the resolvers' routing - is the real thing.
*/
const spawn = vi.hoisted(() => vi.fn())
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  spawn
}))
vi.mock('./settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./settings')>()),
  getSettings: () => ({
    playlistLimit: 500,
    universalFallback: false,
    proxy: '',
    cookiesFile: '',
    cookiesFromBrowser: ''
  })
}))
const resolveUrl = vi.hoisted(() => vi.fn())
vi.mock('../resolvers', async (importOriginal) => {
  const real = await importOriginal<typeof import('../resolvers')>()
  resolveUrl.mockImplementation(real.resolveUrl)
  return { ...real, resolveUrl }
})

beforeEach(() => {
  spawn.mockClear()
})

describe('detect', () => {
  it('never starts the engine for a detection that was already canceled', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await detect('https://example.com/watch/1', undefined, controller.signal)
    expect(result).toMatchObject({ ok: false, errorCode: 'canceled' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('stops when the cancel lands during the resolve stage', async () => {
    // Resolver-backed sites spend seconds here. The probe after it attached its
    // abort listener to a signal that had already fired, so it never ran, and
    // the engine probed on for up to two minutes after the user gave up.
    const controller = new AbortController()
    resolveUrl.mockImplementationOnce(async (url: string) => {
      controller.abort()
      return { url }
    })
    const result = await detect('https://example.com/watch/1', undefined, controller.signal)
    expect(result).toMatchObject({ ok: false, errorCode: 'canceled' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('refuses input the engine would read as an option', async () => {
    // `--version` in the URL slot was executed as an option.
    for (const input of ['--version', '-o x', 'not a link']) {
      const result = await detect(input)
      expect(result, input).toMatchObject({ ok: false, errorCode: 'notALink' })
    }
    expect(spawn).not.toHaveBeenCalled()
  })
})

describe('playlistEntries', () => {
  it('drops entries whose URL is really an option', () => {
    // A playlist listing is the site's own JSON, and every entry the user ticks
    // is queued by its URL as-is.
    const entries = playlistEntries([
      { url: '--config-locations=x', title: 'evil 1' },
      { webpage_url: '--update-to=a/b', title: 'evil 2' },
      { url: 'https://www.youtube.com/watch?v=abc123', title: 'fine' },
      { url: 'abc123', title: 'a bare id the engine could not fetch on its own' },
      { title: 'no url at all' }
    ])
    expect(entries).toEqual([
      { url: 'https://www.youtube.com/watch?v=abc123', title: 'fine', thumbnail: undefined }
    ])
  })

  it('prefers the page URL and keeps what the picker shows', () => {
    const entries = playlistEntries([
      {
        url: 'https://cdn.test/raw',
        webpage_url: 'https://site.test/watch/1',
        thumbnails: [{ url: 'https://i.test/small.jpg' }, { url: 'https://i.test/big.jpg' }]
      }
    ])
    expect(entries).toEqual([
      { url: 'https://site.test/watch/1', title: 'Untitled', thumbnail: 'https://i.test/big.jpg' }
    ])
  })
})
