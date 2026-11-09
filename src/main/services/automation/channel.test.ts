import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHANNEL_WINDOW } from '@shared/channel'
import type { Watch } from '@shared/automation'
import { videoRef } from '@shared/automation'

const h = vi.hoisted(() => ({
  spawnJson: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

vi.mock('../detector', () => ({
  spawnJson: h.spawnJson,
  PROBE_SOCKET_TIMEOUT: ['--socket-timeout', '10'],
  pickThumbnail: (raw: { thumbnail?: string }) => raw.thumbnail,
  flattenEntries: (raw: unknown[]) => raw
}))
vi.mock('../log', () => ({ log: h.log }))
vi.mock('../settings', () => ({ getSettings: () => ({}) }))
vi.mock('../options', () => ({ accessArgs: () => [] }))
vi.mock('../browser-logins', () => ({ holdJarCopy: () => ({ file: undefined, release: () => undefined }) }))
vi.mock('../ytdlp', () => ({ engineUnavailable: async () => undefined }))

import { checkChannel, describeChannel, listedUpload, listName, stillGoingOn } from './channel'

const entries = (...ids: string[]): object[] =>
  ids.map((id) => ({ id, url: `https://example.com/watch/${id}`, title: `Video ${id}` }))

const answer = (raw: object): { ok: true; raw: object; text: string } => ({ ok: true, raw, text: '' })

const watch = (over: Partial<Watch> = {}): Watch => ({
  id: 'w1',
  url: 'https://example.com/@someone',
  title: 'Someone',
  provider: 'channel',
  translatorId: '',
  quality: 'best',
  enabled: true,
  intervalMinutes: 360,
  nextCheckAt: 0,
  failures: 0,
  seen: [videoRef('b')],
  steps: [],
  createdAt: 0,
  ...over
})

const argsOf = (call: number): string[] => h.spawnJson.mock.calls[call][0] as string[]

beforeEach(() => {
  h.spawnJson.mockReset()
})

describe('reading a list', () => {
  it('asks for a flat listing of the near end, and nothing more', async () => {
    h.spawnJson.mockResolvedValue(answer({ _type: 'playlist', title: 'Someone', entries: entries('a', 'b') }))
    await checkChannel(watch())
    expect(h.spawnJson).toHaveBeenCalledTimes(1)
    const args = argsOf(0)
    expect(args).toEqual(expect.arrayContaining(['--flat-playlist', '--ignore-config', '--playlist-end', String(CHANNEL_WINDOW)]))
    // Behind `--`, so a watch's address can only ever be read as an address.
    expect(args.slice(-2)).toEqual(['--', 'https://example.com/@someone'])
  })

  it('turns a listing into what the watcher writes down', async () => {
    h.spawnJson.mockResolvedValue(
      answer({ _type: 'playlist', title: 'Someone', playlist_count: 7, entries: entries('a', 'b', 'older') })
    )
    const out = await checkChannel(watch())
    expect(out.fresh.map((r) => r.videoId)).toEqual(['a'])
    expect(out.patch.seen?.map((r) => r.videoId)).toEqual(['b', 'older'])
    expect(out.patch.owed?.map((r) => r.videoId)).toEqual(['a'])
    expect(out.patch.listCount).toBe(7)
  })

  it('a bot check is a failed check, in the engine-classified words', async () => {
    const why = 'YouTube is asking this computer to prove it is not a bot.'
    h.spawnJson.mockResolvedValue({ ok: false, error: why, errorCode: 'botCheck' })
    await expect(checkChannel(watch())).rejects.toThrow(why)
  })

  it('a sign-in wall is too', async () => {
    h.spawnJson.mockResolvedValue({ ok: false, error: 'This video requires you to be signed in.', errorCode: 'signIn' })
    await expect(checkChannel(watch())).rejects.toThrow('signed in')
  })

  it('a page that has become one video is a failed check, not an empty list', async () => {
    h.spawnJson.mockResolvedValue(answer({ _type: 'video', id: 'x' }))
    await expect(checkChannel(watch())).rejects.toThrow(/single video/)
  })

  it('opens the tabs of a channel up as lists of their own', async () => {
    h.spawnJson.mockResolvedValue(
      answer({
        _type: 'playlist',
        title: 'Someone',
        entries: [
          { _type: 'playlist', entries: entries('new', 'b') },
          { _type: 'playlist', entries: entries('short', 'b2') }
        ]
      })
    )
    const out = await checkChannel(watch({ seen: [videoRef('b'), videoRef('b2')] }))
    expect(out.fresh.map((r) => r.videoId)).toEqual(['new', 'short'])
  })
})

describe('a long list that keeps its newest last', () => {
  const near = answer({ _type: 'playlist', title: 'P', playlist_count: 100, entries: entries('first') })

  it('reads the far end when it has grown', async () => {
    h.spawnJson.mockResolvedValueOnce(near)
    h.spawnJson.mockResolvedValueOnce(answer({ _type: 'playlist', title: 'P', entries: entries('b', 'new') }))
    const out = await checkChannel(watch({ newestLast: true, listCount: 99 }))
    expect(argsOf(1)).toEqual(expect.arrayContaining(['--playlist-items', `-${CHANNEL_WINDOW}:`]))
    expect(out.fresh.map((r) => r.videoId)).toEqual(['new'])
    expect(out.patch.listCount).toBe(100)
  })

  it('does not page through it when it has not', async () => {
    h.spawnJson.mockResolvedValueOnce(near)
    const out = await checkChannel(watch({ newestLast: true, listCount: 100 }))
    expect(h.spawnJson).toHaveBeenCalledTimes(1)
    expect(out.fresh).toEqual([])
    expect(out.patch.seen).toEqual([videoRef('b')])
  })

  it('a short one is all in the near end', async () => {
    h.spawnJson.mockResolvedValueOnce(answer({ _type: 'playlist', title: 'P', playlist_count: 2, entries: entries('b', 'new') }))
    const out = await checkChannel(watch({ newestLast: true, listCount: 1 }))
    expect(h.spawnJson).toHaveBeenCalledTimes(1)
    expect(out.fresh.map((r) => r.videoId)).toEqual(['new'])
  })
})

describe('looking at a link to follow', () => {
  it('offers the finished uploads, and sets aside what is on air', async () => {
    h.spawnJson.mockResolvedValue(
      answer({
        _type: 'playlist',
        title: 'Someone',
        playlist_count: 240,
        entries: [
          ...entries('a', 'b'),
          { id: 'now', url: 'https://example.com/watch/now', title: 'Stream', live_status: 'is_live' },
          { id: 'soon', url: 'https://example.com/watch/soon', title: 'Soon', live_status: 'is_upcoming' }
        ]
      })
    )
    const out = await describeChannel('https://example.com/@someone')
    expect(out.entries.map((r) => r.videoId)).toEqual(['a', 'b'])
    expect(out.waiting.map((r) => r.videoId)).toEqual(['now', 'soon'])
    expect(out).toMatchObject({ name: 'Someone', count: 240, newestLast: false })
  })

  it('reads the far end of a long playlist straight away', async () => {
    h.spawnJson.mockResolvedValueOnce(answer({ _type: 'playlist', title: 'P', playlist_count: 90, entries: entries('first') }))
    h.spawnJson.mockResolvedValueOnce(answer({ _type: 'playlist', title: 'P', entries: entries('y', 'z') }))
    const out = await describeChannel('https://www.youtube.com/playlist?list=PLabc')
    expect(out.newestLast).toBe(true)
    expect(out.entries.map((r) => r.videoId)).toEqual(['y', 'z'])
  })

  it('refuses one video, in words that say so', async () => {
    h.spawnJson.mockResolvedValue(answer({ _type: 'video', id: 'x' }))
    await expect(describeChannel('https://example.com/watch/x')).rejects.toThrow(/single video/)
  })

  it('refuses a page the engine cannot read as anything', async () => {
    h.spawnJson.mockResolvedValue({ ok: false, error: 'Could not find a downloadable video at this link.', errorCode: 'noFormats' })
    await expect(describeChannel('https://example.com/about')).rejects.toThrow(/not a series, channel or playlist/)
  })

  it('refuses an empty list rather than make a watch that knows nothing', async () => {
    h.spawnJson.mockResolvedValue(answer({ _type: 'playlist', title: 'P', entries: [] }))
    await expect(describeChannel('https://example.com/@someone')).rejects.toThrow('No videos found on this page.')
  })

  it('passes a bot check on, so the dialog can say what it is', async () => {
    h.spawnJson.mockResolvedValue({ ok: false, error: 'YouTube is asking this computer to prove it is not a bot.', errorCode: 'botCheck' })
    await expect(describeChannel('https://www.youtube.com/@someone')).rejects.toThrow(/not a bot/)
  })
})

describe('one entry', () => {
  it('uses the address of a feed entry as its id, without the note the engine smuggles in', () => {
    const smuggled = 'http://192.168.1.10:8080/v1.mp4#__youtubedl_smuggle=%7B%22force_videoid%22%3A+%22g1%22%7D'
    expect(listedUpload({ url: smuggled, title: 'One', timestamp: 100 })).toEqual({
      id: 'http://192.168.1.10:8080/v1.mp4',
      url: 'http://192.168.1.10:8080/v1.mp4',
      title: 'One',
      at: 100_000
    })
  })

  it('refuses an address that is not one: the listing is the site\'s data', () => {
    expect(listedUpload({ id: 'x', url: '--config-locations=/tmp/evil' })).toBeUndefined()
  })

  it('reads a date of upload when that is all there is', () => {
    expect(listedUpload({ id: 'x', url: 'https://example.com/x', upload_date: '20261109' })?.at).toBe(Date.UTC(2026, 10, 9))
  })

  it('takes a stream that has just ended to be not over yet', () => {
    expect(listedUpload({ id: 'x', url: 'https://example.com/x', live_status: 'post_live' })?.live).toBe(true)
    expect(listedUpload({ id: 'x', url: 'https://example.com/x', live_status: 'was_live' })?.live).toBeUndefined()
  })
})

describe('what a list is called', () => {
  it('a channel by its name, not "<name> - Videos"', () => {
    expect(listName({ id: 'UC1', channel_id: 'UC1', channel: 'Someone', title: 'Someone - Videos' }, 'u')).toBe('Someone')
  })

  it('a playlist by its own', () => {
    expect(listName({ id: 'PL1', channel_id: 'UC1', channel: 'Someone', title: 'Best of' }, 'u')).toBe('Best of')
  })

  it('falls back to the link', () => {
    expect(listName({}, 'https://example.com/x')).toBe('https://example.com/x')
  })
})

describe('whether an upload is still going on', () => {
  it('asks about that upload alone', async () => {
    h.spawnJson.mockResolvedValue(answer({ id: 'x', live_status: 'not_live' }))
    expect(await stillGoingOn('https://example.com/x')).toBe(false)
    expect(argsOf(0)).toContain('--no-playlist')
  })

  it.each([
    [{ is_live: true }],
    [{ live_status: 'is_live' }],
    [{ live_status: 'is_upcoming' }],
    [{ live_status: 'post_live' }]
  ])('%j is', async (raw) => {
    h.spawnJson.mockResolvedValue(answer({ id: 'x', ...raw }))
    expect(await stillGoingOn('https://example.com/x')).toBe(true)
  })

  it('a premiere the engine refuses to open is', async () => {
    h.spawnJson.mockResolvedValue({ ok: false, error: 'not yet', errorCode: 'upcoming' })
    expect(await stillGoingOn('https://example.com/x')).toBe(true)
  })

  it('any other failure leaves it to the download to report', async () => {
    h.spawnJson.mockResolvedValue({ ok: false, error: 'gone', errorCode: 'unavailable' })
    expect(await stillGoingOn('https://example.com/x')).toBe(false)
  })
})
