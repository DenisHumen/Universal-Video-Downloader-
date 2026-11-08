import { describe, expect, it } from 'vitest'
import { AUTO_SOURCES, autoSourceFor, copiedLinkAction, type CopiedLinkContext } from './auto-sources'
import { normalizeUrl } from './urls'

const id = (url: string): string | null => autoSourceFor(url)?.id ?? null

describe('autoSourceFor', () => {
  it.each([
    ['https://www.youtube.com/watch?v=jNQXAC9IVRw', 'youtube'],
    ['https://youtu.be/jNQXAC9IVRw?si=abc', 'youtube'],
    ['https://www.youtube.com/shorts/abcdefghijk', 'youtube'],
    ['https://www.tiktok.com/@user/video/7300000000000000000', 'tiktok'],
    ['https://vm.tiktok.com/ZMabc123/', 'tiktok'],
    ['https://www.instagram.com/reel/Cabc123/', 'instagram'],
    ['https://www.facebook.com/watch/?v=123456', 'facebook'],
    ['https://fb.watch/abc123/', 'facebook'],
    ['https://x.com/someone/status/1700000000000000000', 'x'],
    ['https://twitter.com/someone/status/1700000000000000000', 'x'],
    ['https://www.reddit.com/r/videos/comments/abc123/title/', 'reddit'],
    ['https://www.twitch.tv/videos/2913818251', 'twitch'],
    ['https://clips.twitch.tv/SomeClipName-abc', 'twitch'],
    ['https://vimeo.com/76979871', 'vimeo'],
    ['https://www.dailymotion.com/video/x8abc', 'dailymotion'],
    ['https://vk.com/video-123_456', 'vk'],
    ['https://vkvideo.ru/video-123_456', 'vk'],
    ['https://ok.ru/video/123456', 'ok'],
    ['https://rutube.ru/video/0123456789abcdef0123456789abcdef/', 'rutube'],
    ['https://www.bilibili.com/video/BV1xx411c7mD', 'bilibili'],
    ['https://www.nicovideo.jp/watch/sm9', 'niconico'],
    ['https://rumble.com/v1abc-title.html', 'rumble'],
    ['https://soundcloud.com/artist/track-name', 'soundcloud']
  ])('takes %s', (url, source) => {
    expect(id(url)).toBe(source)
  })

  // Copying these must never start a download: none of them is one video.
  it.each([
    'https://www.youtube.com/',
    'https://www.youtube.com/@channel',
    'https://www.youtube.com/results?search_query=cats',
    'https://www.youtube.com/playlist?list=PL123',
    'https://www.tiktok.com/@user',
    'https://www.instagram.com/someone/',
    'https://x.com/someone',
    'https://www.reddit.com/r/videos/',
    'https://www.twitch.tv/somestreamer',
    'https://vimeo.com/channels/staffpicks',
    'https://vk.com/feed',
    'https://soundcloud.com/artist/sets/album',
    'https://soundcloud.com/artist',
    'https://example.com/video/123',
    'https://notyoutube.com/watch?v=abc',
    'not a link'
  ])('leaves %s alone', (url) => {
    expect(id(url)).toBeNull()
  })

  it('never reuses an id', () => {
    const ids = AUTO_SOURCES.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('copiedLinkAction', () => {
  const VIDEO = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
  const ctx = (over: Partial<CopiedLinkContext> = {}): CopiedLinkContext => ({
    autoDownload: true,
    autoDownloadOff: [],
    clipboardWatch: false,
    known: new Set(),
    ...over
  })

  it('downloads a video from a source that is on', () => {
    expect(copiedLinkAction(VIDEO, ctx())).toBe('download')
  })

  it('does nothing by itself while the mode is off', () => {
    expect(copiedLinkAction(VIDEO, ctx({ autoDownload: false }))).toBe('ignore')
    expect(copiedLinkAction(VIDEO, ctx({ autoDownload: false, clipboardWatch: true }))).toBe('offer')
  })

  it('respects a source switched off, falling back to the suggestion', () => {
    expect(copiedLinkAction(VIDEO, ctx({ autoDownloadOff: ['youtube'] }))).toBe('ignore')
    expect(copiedLinkAction(VIDEO, ctx({ autoDownloadOff: ['youtube'], clipboardWatch: true }))).toBe('offer')
    expect(copiedLinkAction(VIDEO, ctx({ autoDownloadOff: ['vimeo'] }))).toBe('download')
  })

  // Copying a finished video's link to send it to someone must not fetch it again.
  it('does not fetch a link it already has, however it was written', () => {
    const known = new Set([normalizeUrl(VIDEO)])
    expect(copiedLinkAction('https://youtu.be/jNQXAC9IVRw?si=shared', ctx({ known, clipboardWatch: true }))).toBe('ignore')
  })

  it('offers an unknown site or a channel instead of downloading it', () => {
    const on = ctx({ clipboardWatch: true })
    expect(copiedLinkAction('https://example.com/video/1', on)).toBe('offer')
    expect(copiedLinkAction('https://www.youtube.com/@channel', on)).toBe('offer')
  })
})
