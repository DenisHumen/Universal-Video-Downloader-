import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detect, flattenEntries, playlistEntries, universalCanHelp } from './detector'
import { describeNetError } from '../resolvers/neterror'

/*
  `spawn` is replaced so a test can prove the engine was never started, or
  play back what it said; the settings, which would otherwise read Electron's
  userData, are a stand-in, and so is the engine's location. Everything else -
  URL handling, the resolvers' routing - is the real thing.
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
vi.mock('./ytdlp', () => ({
  ytdlpBinaryPath: () => 'yt-dlp',
  ytdlpSpawnOptions: () => ({ windowsHide: true, env: {} })
}))
const resolveUrl = vi.hoisted(() => vi.fn())
const resolveUniversal = vi.hoisted(() => vi.fn())
vi.mock('../resolvers', async (importOriginal) => {
  const real = await importOriginal<typeof import('../resolvers')>()
  resolveUrl.mockImplementation(real.resolveUrl)
  resolveUniversal.mockImplementation(real.resolveUniversal)
  return { ...real, resolveUrl, resolveUniversal }
})

/** An engine run that writes `stderr` and then, unless `hang`, exits with 1. */
function engine(stderr: string, hang = false): EventEmitter {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough()
  })
  child.stderr.write(stderr)
  if (!hang) setImmediate(() => child.emit('close', 1))
  return child
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

beforeEach(() => {
  spawn.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
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

/*
  A host blocked from this network took up to two minutes to report, and then
  reported the wrong thing: the engine ran into the 75 s probe cap ("timed out,
  the site may be unsupported"), and the hidden browser was opened anyway to
  wait out its own timeout on the same unreachable address.
*/
describe('detect, when the host cannot be reached', () => {
  const PAGE = 'https://ok.ru/video/1234567'

  it('answers with the reason the app itself could not reach the host', async () => {
    spawn.mockImplementationOnce(() =>
      engine(
        "ERROR: [Odnoklassniki] 1234567: Unable to download webpage: Failed to resolve 'ok.ru' ([Errno 11001] getaddrinfo failed)\n"
      )
    )
    resolveUniversal.mockRejectedValueOnce(describeNetError(new Error('net::ERR_NAME_NOT_RESOLVED'), PAGE))

    const result = await detect(PAGE)
    expect(result).toMatchObject({ ok: false, errorCode: 'network' })
    expect(result.error).toMatch(/Could not reach ok\.ru: could not resolve host/)
  })

  it('keeps the diagnosis of an engine that did reach the site', async () => {
    // To be told "not in your country" the engine had to get an answer.
    spawn.mockImplementationOnce(() =>
      engine('ERROR: [youtube] abc: The uploader has not made this video available in your country\n')
    )
    resolveUniversal.mockClear()

    expect(await detect(PAGE)).toMatchObject({ ok: false, errorCode: 'geo' })
    // …and stands without a page scrape: no other route around a region lock.
    expect(resolveUniversal).not.toHaveBeenCalled()
  })

  it('says the engine could not connect when it is cut off mid-attempt', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    spawn.mockImplementationOnce(() =>
      engine("[Odnoklassniki] 1234567: Connection to ok.ru timed out. (connect timeout=10.0)\n", true)
    )
    resolveUniversal.mockResolvedValueOnce(null)

    const result = detect(PAGE)
    while (!spawn.mock.calls.length) await tick()
    await tick()
    await vi.advanceTimersByTimeAsync(75_000)

    expect(await result).toMatchObject({ ok: false, errorCode: 'network' })
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

describe('detect, on a host the engine has no extractor for', () => {
  it('has the page scrape running before the probe gives up', async () => {
    spawn.mockImplementationOnce(() => engine('ERROR: Unsupported URL: https://unknown-site.test/v/1\n'))
    resolveUniversal.mockClear()
    resolveUniversal.mockResolvedValueOnce(null)

    await detect('https://unknown-site.test/v/1')
    const options = resolveUniversal.mock.calls.at(-1)?.[1] as { scraped?: Promise<unknown> }
    expect(options.scraped).toBeInstanceOf(Promise)
    await options.scraped?.catch(() => undefined)
  })

  it('neither scrapes nor browses for a prefetch', async () => {
    spawn.mockImplementationOnce(() => engine('ERROR: Unsupported URL: https://unknown-site.test/v/2\n'))
    resolveUniversal.mockClear()

    const result = await detect('https://unknown-site.test/v/2', undefined, undefined, { prefetch: true })
    expect(result.ok).toBe(false)
    expect(resolveUniversal).not.toHaveBeenCalled()
  })

  it('leaves the page alone on a host the engine knows by name', async () => {
    spawn.mockImplementationOnce(() => engine('ERROR: [dailymotion] x1: Unable to extract info\n'))
    resolveUniversal.mockClear()
    resolveUniversal.mockResolvedValueOnce(null)

    await detect('https://www.dailymotion.com/video/x1')
    expect(resolveUniversal).toHaveBeenCalledTimes(1)
    const options = resolveUniversal.mock.calls.at(-1)?.[1] as { scraped?: Promise<unknown> }
    expect(options.scraped).toBeUndefined()
  })
})

describe('universalCanHelp', () => {
  it('skips the page scrape when the site already said no', () => {
    for (const errorCode of ['signIn', 'geo', 'drm', 'ageRestricted', 'upcoming', 'rateLimited', 'unavailable'] as const) {
      expect(universalCanHelp({ errorCode }), errorCode).toBe(false)
    }
  })

  it('skips it when a named extractor explains the failure', () => {
    expect(
      universalCanHelp({ output: 'ERROR: [youtube] abc: Private video. Sign in if you have access' })
    ).toBe(false)
    expect(universalCanHelp({ output: 'ERROR: [youtube:tab] @x: This channel does not exist.' })).toBe(false)
  })

  it('keeps it for unknown pages and broken extractors', () => {
    expect(universalCanHelp({ output: 'ERROR: Unsupported URL: https://site.test/x' })).toBe(true)
    expect(universalCanHelp({ output: 'ERROR: [generic] Unable to find video in page' })).toBe(true)
    expect(universalCanHelp({ output: 'ERROR: [SomeSite] 42: Unable to extract video url' })).toBe(true)
    expect(universalCanHelp({ errorCode: 'noFormats' })).toBe(true)
    expect(universalCanHelp({ errorCode: 'network', output: 'ERROR: [youtube] x: timed out' })).toBe(true)
    expect(universalCanHelp({})).toBe(true)
  })
})

describe('flattenEntries', () => {
  it("opens a channel's tab playlists into their videos", () => {
    const entries = playlistEntries([
      {
        _type: 'playlist',
        title: 'Channel - Videos',
        webpage_url: 'https://www.youtube.com/@c/videos',
        entries: [
          { url: 'https://www.youtube.com/watch?v=a1', title: 'one', ie_key: 'Youtube' },
          { url: 'https://www.youtube.com/watch?v=a2', title: 'two', ie_key: 'Youtube' }
        ]
      },
      {
        _type: 'playlist',
        title: 'Channel - Shorts',
        entries: [{ url: 'https://www.youtube.com/shorts/s1', title: 'short' }]
      }
    ])
    expect(entries.map((e) => e.title)).toEqual(['one', 'two', 'short'])
  })

  it('stops at a bounded depth', () => {
    type Nested = Parameters<typeof flattenEntries>[0][number]
    let node: Nested = { url: 'https://site.test/v', title: 'deep' }
    for (let i = 0; i < 10; i++) node = { _type: 'playlist', entries: [node] }
    const flat = flattenEntries([node])
    expect(flat).toHaveLength(1)
    expect(flat[0]._type).toBe('playlist')
  })
})
