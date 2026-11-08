import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  settings: {
    autoDownload: true,
    autoDownloadOff: [] as string[],
    clipboardWatch: false,
    defaultMode: 'video',
    defaultQuality: '1080'
  },
  detect: vi.fn(),
  start: vi.fn(),
  list: vi.fn((): unknown[] => [])
}))
vi.mock('./detector', () => ({ detect: h.detect }))
vi.mock('./downloader', () => ({ listDownloads: h.list, startDownload: h.start }))
vi.mock('./settings', () => ({ getSettings: () => h.settings }))
vi.mock('./log', () => ({ log: { info: vi.fn(), warn: vi.fn() } }))

import { autoRequest, handleCopiedLink } from './auto-download'

const VIDEO = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
const hooks = () => ({ offer: vi.fn(), started: vi.fn() })

beforeEach(() => {
  h.settings.autoDownload = true
  h.settings.autoDownloadOff = []
  h.settings.clipboardWatch = false
  h.detect.mockReset()
  h.start.mockReset()
  h.start.mockImplementation(async (r: { title?: string; url: string }) => ({ title: r.title || r.url }))
  h.list.mockReturnValue([])
})

describe('handleCopiedLink', () => {
  it('detects, then queues with the real title and the default quality', async () => {
    h.detect.mockResolvedValue({ ok: true, info: { title: 'Me at the zoo', duration: 19, extractor: 'youtube' } })
    const on = hooks()
    await handleCopiedLink(VIDEO, on)
    expect(h.start).toHaveBeenCalledWith(expect.objectContaining({ title: 'Me at the zoo', quality: '1080', mode: 'video' }))
    expect(on.started).toHaveBeenCalledWith('Me at the zoo')
    expect(on.offer).not.toHaveBeenCalled()
  })

  // A live stream never ends, and a playlist or a series needs choosing.
  it.each([{ isLive: true }, { isPlaylist: true }, { streaming: {} }])('offers rather than starts %o', async (extra) => {
    h.detect.mockResolvedValue({ ok: true, info: { title: 'x', ...extra } })
    const on = hooks()
    await handleCopiedLink(VIDEO, on)
    expect(h.start).not.toHaveBeenCalled()
    expect(on.offer).toHaveBeenCalledWith(VIDEO)
  })

  // The run then fails as a row with its error and retry, instead of nothing happening.
  it('queues the link even when detection failed', async () => {
    h.detect.mockResolvedValue({ ok: false, errorCode: 'botCheck' })
    await handleCopiedLink(VIDEO, hooks())
    expect(h.start).toHaveBeenCalledTimes(1)
  })

  it('runs one download for a link copied twice while it is being detected', async () => {
    let answer: (v: unknown) => void = () => undefined
    h.detect.mockReturnValue(new Promise((r) => (answer = r)))
    const first = handleCopiedLink(VIDEO, hooks())
    await handleCopiedLink(VIDEO, hooks())
    answer({ ok: true, info: { title: 'x' } })
    await first
    expect(h.detect).toHaveBeenCalledTimes(1)
    expect(h.start).toHaveBeenCalledTimes(1)
  })

  it('does not fetch a finished link again, but retries a failed one', async () => {
    h.detect.mockResolvedValue({ ok: true, info: { title: 'x' } })
    h.list.mockReturnValue([{ url: VIDEO, state: 'completed' }])
    await handleCopiedLink(VIDEO, hooks())
    expect(h.start).not.toHaveBeenCalled()
    h.list.mockReturnValue([{ url: VIDEO, state: 'error' }])
    await handleCopiedLink(VIDEO, hooks())
    expect(h.start).toHaveBeenCalledTimes(1)
  })

  it('stays out of the way of a source switched off', async () => {
    h.settings.autoDownloadOff = ['youtube']
    const on = hooks()
    await handleCopiedLink(VIDEO, on)
    expect(h.detect).not.toHaveBeenCalled()
    expect(on.offer).not.toHaveBeenCalled()
  })
})

describe('autoRequest', () => {
  it('takes audio mode and a preset that only makes sense for audio from Settings', () => {
    expect(autoRequest(VIDEO, undefined, { defaultMode: 'audio', defaultQuality: 'best' })).toMatchObject({ mode: 'audio', quality: 'audio' })
    expect(autoRequest(VIDEO, undefined, { defaultMode: 'video', defaultQuality: 'audio' })).toMatchObject({ mode: 'video', quality: 'best' })
  })
})
