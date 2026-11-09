import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detect, flattenEntries, playlistEntries, subtitleCodes, universalCanHelp } from './detector'
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
const putInfo = vi.hoisted(() => vi.fn())
vi.mock('./info-store', () => ({ infoCache: { put: putInfo } }))
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

describe('detect, keeping the answer for the download', () => {
  /** An engine run that prints `json` and exits 0. */
  function answering(json: object): EventEmitter {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() })
    child.stdout.write(JSON.stringify(json))
    setImmediate(() => child.emit('close', 0))
    return child
  }
  const format = { format_id: '18', ext: 'mp4', vcodec: 'avc1', acodec: 'mp4a', height: 360 }

  it("keeps a single video's JSON, keyed by its link", async () => {
    putInfo.mockClear()
    spawn.mockImplementationOnce(() => answering({ id: 'v', title: 'One', formats: [format] }))
    const result = await detect('https://youtu.be/dQw4w9WgXcQ')
    expect(result.ok).toBe(true)
    expect(putInfo).toHaveBeenCalledTimes(1)
    expect(putInfo.mock.calls[0][0]).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ#/)
    expect(JSON.parse(putInfo.mock.calls[0][1])).toMatchObject({ id: 'v' })
  })

  it('keeps nothing for a site whose signed addresses may not last fifteen minutes', async () => {
    putInfo.mockClear()
    spawn.mockImplementationOnce(() => answering({ id: 'v', title: 'One', formats: [format] }))
    expect((await detect('https://unknown-site.test/watch/keep')).ok).toBe(true)
    expect(putInfo).not.toHaveBeenCalled()
  })

  it('keeps nothing for a live stream or a playlist', async () => {
    putInfo.mockClear()
    spawn.mockImplementationOnce(() => answering({ id: 'l', is_live: true, formats: [format] }))
    await detect('https://www.youtube.com/watch?v=liveliveliv')
    spawn.mockImplementationOnce(() =>
      answering({ _type: 'playlist', id: 'p', entries: [{ id: 'a', formats: [format] }] })
    )
    await detect('https://www.youtube.com/watch?v=listlistlis')
    expect(putInfo).not.toHaveBeenCalled()
  })
})

describe('detect, when YouTube holds formats back', () => {
  function answering(json: object, warnings: string): EventEmitter {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() })
    child.stdout.write(JSON.stringify(json))
    child.stderr.write(warnings)
    setTimeout(() => child.emit('close', 0), 5)
    return child
  }
  const low = { format_id: '18', ext: 'mp4', vcodec: 'avc1', acodec: 'mp4a', height: 360 }
  const storyboard = { format_id: 'sb0', ext: 'mhtml', vcodec: 'none', acodec: 'none', protocol: 'mhtml' }

  it('asks the engine for its warnings, with the runtime and without any config', async () => {
    spawn.mockClear()
    spawn.mockImplementationOnce(() => answering({ id: 'v', title: 'One', formats: [low] }, ''))
    await detect('https://www.youtube.com/watch?v=abcdefghijk')
    const args = spawn.mock.calls[0][1] as string[]
    expect(args).not.toContain('--no-warnings')
    expect(args).toContain('--ignore-config')
    expect(args[0]).toBe('--no-js-runtimes')
  })

  it('says why a 360p list is what it is', async () => {
    spawn.mockImplementationOnce(() =>
      answering(
        { id: 'v', title: 'One', formats: [low] },
        'WARNING: [youtube] No supported JavaScript runtime could be found. Only deno is enabled by default\n'
      )
    )
    const result = await detect('https://www.youtube.com/watch?v=abcdefghij1')
    expect(result.info?.qualityLimit).toBe('noRuntime')
  })

  it('says nothing on an ordinary answer', async () => {
    spawn.mockImplementationOnce(() => answering({ id: 'v', title: 'One', formats: [low] }, ''))
    const result = await detect('https://www.youtube.com/watch?v=abcdefghij2')
    expect(result.info?.qualityLimit).toBeUndefined()
    expect(result.ok).toBe(true)
  })

  it('reports a list of only storyboards as YouTube holding the video back', async () => {
    spawn.mockImplementationOnce(() =>
      answering(
        { id: 'v', title: 'One', extractor_key: 'Youtube', formats: [storyboard] },
        'WARNING: Only images are available for download. use --list-formats to see them\n'
      )
    )
    const result = await detect('https://www.youtube.com/watch?v=abcdefghij3')
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('youtubeWithheld')
  })

  it('does not scrape the page for a video YouTube held back', () => {
    for (const errorCode of ['jsRuntimeMissing', 'jsChallengeFailed', 'youtubeWithheld'] as const) {
      expect(universalCanHelp({ errorCode, output: 'WARNING: x\nERROR: [youtube] x: No video formats found!' })).toBe(false)
    }
  })
})

describe('detect, listing a collection', () => {
  // What the settings mock at the top of this file says.
  const settingsLimit = 500
  function listing(count: number): EventEmitter {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() })
    child.stdout.write(
      JSON.stringify({
        _type: 'playlist',
        id: 'PL',
        title: 'List',
        // The count is no help: as here, it often only says what was listed.
        playlist_count: count,
        entries: Array.from({ length: count }, (_, i) => ({ url: `https://www.youtube.com/watch?v=${i}`, title: `V${i}` }))
      })
    )
    setImmediate(() => child.emit('close', 0))
    return child
  }
  const link = 'https://www.youtube.com/playlist?list=PLabc'
  const endOf = (args: string[]): string => args[args.indexOf('--playlist-end') + 1]

  it('says when the list reached the depth from the settings', async () => {
    spawn.mockImplementationOnce(() => listing(settingsLimit))
    const result = await detect(link)
    expect(endOf(spawn.mock.calls[0][1])).toBe(String(settingsLimit))
    expect(result.info?.listingCut).toBe(settingsLimit)
  })

  it('says nothing about a list that ended before it', async () => {
    spawn.mockImplementationOnce(() => listing(settingsLimit - 1))
    const result = await detect(link)
    expect(result.info?.listingCut).toBeUndefined()
  })

  it('lists deeper when asked to, and refuses a depth that is not a number', async () => {
    spawn.mockImplementationOnce(() => listing(5))
    await detect(link, undefined, undefined, { playlistEnd: 1000 })
    expect(endOf(spawn.mock.calls[0][1])).toBe('1000')
    spawn.mockClear()
    spawn.mockImplementationOnce(() => listing(5))
    await detect(link, undefined, undefined, { playlistEnd: '--exec' as unknown as number })
    expect(endOf(spawn.mock.calls[0][1])).toBe(String(settingsLimit))
  })

  it('fails a deeper listing outright, rather than probing the link as one video', async () => {
    spawn.mockImplementationOnce(() => engine('ERROR: boom\n'))
    const result = await detect(link, undefined, undefined, { playlistEnd: 1000 })
    expect(result.ok).toBe(false)
    expect(spawn).toHaveBeenCalledTimes(1)
  })
})

describe('subtitleCodes', () => {
  it('lists languages, not a stream chat', () => {
    expect(subtitleCodes({ en: [], live_chat: [], 'zh-Hans': [] })).toEqual(['en', 'zh-Hans'])
    expect(subtitleCodes(undefined)).toEqual([])
  })
})

describe('universalCanHelp', () => {
  it('lets the signed-in browser try a login or age gate, except on YouTube', () => {
    const insta = { url: 'https://www.instagram.com/p/x', browserAllowed: true }
    for (const errorCode of ['signIn', 'ageRestricted'] as const) {
      expect(universalCanHelp({ errorCode, output: 'ERROR: [Instagram] x: login required' }, insta)).toBe(true)
      expect(universalCanHelp({ errorCode }, { ...insta, browserAllowed: false })).toBe(false)
      expect(
        universalCanHelp({ errorCode, output: 'ERROR: [youtube] x: Sign in to confirm your age' }, insta)
      ).toBe(false)
      expect(
        universalCanHelp({ errorCode }, { url: 'https://www.youtube.com/watch?v=x', browserAllowed: true })
      ).toBe(false)
    }
  })

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
