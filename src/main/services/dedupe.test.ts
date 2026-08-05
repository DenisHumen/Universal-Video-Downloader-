import { describe, expect, it } from 'vitest'
import type { DownloadItem, DownloadRequest, DownloadState } from '@shared/types'
import { isSameDownload, IN_FLIGHT_STATES } from './dedupe'

function item(overrides: Partial<DownloadItem> = {}): DownloadItem {
  return {
    id: 'a',
    url: 'https://site/video',
    sourceUrl: 'https://site/video',
    title: 'Video',
    kind: 'download',
    mode: 'video',
    quality: '1080',
    state: 'downloading',
    percent: 12,
    outputDir: 'C:/dl',
    createdAt: 1,
    ...overrides
  }
}

function request(overrides: Partial<DownloadRequest> = {}): DownloadRequest {
  return { url: 'https://site/video', mode: 'video', quality: '1080', ...overrides }
}

describe('isSameDownload', () => {
  it('matches an identical request that is still in flight', () => {
    expect(isSameDownload(item(), request())).toBe(true)
  })

  it.each(IN_FLIGHT_STATES)('treats %s as still owning the output path', (state) => {
    expect(isSameDownload(item({ state }), request())).toBe(true)
  })

  it.each<DownloadState>(['completed', 'error', 'canceled'])(
    'allows a fresh download once the previous one is %s',
    (state) => {
      expect(isSameDownload(item({ state }), request())).toBe(false)
    }
  )

  it('compares the original URL, not the resolved stream', () => {
    // runDownload rewrites `url` to a short-lived CDN link; `sourceUrl` is what
    // the user actually asked for, and what a repeat request would carry.
    const resolved = item({ url: 'https://cdn.example/abc.m3u8?token=1' })
    expect(isSameDownload(resolved, request())).toBe(true)
  })

  it('separates the same video at a different quality', () => {
    expect(isSameDownload(item({ quality: '720' }), request())).toBe(false)
  })

  it('separates video from audio-only', () => {
    expect(isSameDownload(item({ mode: 'audio' }), request())).toBe(false)
  })

  it('separates an explicit format from a preset', () => {
    expect(isSameDownload(item({ formatId: '137' }), request())).toBe(false)
  })

  it('separates different sections of one video', () => {
    const clip = item({ range: { start: 30, end: 60 } })
    expect(isSameDownload(clip, request({ section: { start: 30, end: 60 } }))).toBe(true)
    expect(isSameDownload(clip, request({ section: { start: 30, end: 90 } }))).toBe(false)
    expect(isSameDownload(clip, request())).toBe(false)
  })

  it('treats "no section" and "from zero" as the same whole video', () => {
    expect(isSameDownload(item({ range: undefined }), request({ section: { start: 0 } }))).toBe(true)
  })

  it('never blocks a trim or convert job, which picks its own output path', () => {
    expect(isSameDownload(item({ kind: 'trim' }), request())).toBe(false)
    expect(isSameDownload(item({ kind: 'convert' }), request())).toBe(false)
  })

  it('does not match a different video', () => {
    expect(isSameDownload(item(), request({ url: 'https://site/other' }))).toBe(false)
  })
})
