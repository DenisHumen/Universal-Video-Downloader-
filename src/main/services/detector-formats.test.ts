import { describe, expect, it } from 'vitest'
import { formatKind, mapFormats, type RawFormat } from './detector'

/*
  A missing codec means "not reported". Coub's video formats and a plain direct
  .mp4 report none, and were dropped as unknown: Coub offered audio only, and a
  direct link fell through to the hidden browser and lost its title.
*/
describe('formatKind', () => {
  it("reads Coub's codec-less video as video, to be merged with its audio", () => {
    const coub: RawFormat = { format_id: 'html5-video-high', ext: 'mp4', acodec: 'none' }
    expect(formatKind(coub)).toBe('video')
  })

  it('reads a direct mp4 or a codec-less HLS stream as video with sound', () => {
    expect(formatKind({ format_id: '0', ext: 'mp4' })).toBe('video+audio')
    expect(formatKind({ format_id: 'hls-720', ext: 'mp4', protocol: 'm3u8_native' })).toBe('video+audio')
  })

  it('keeps a known video codec without audio as video only', () => {
    expect(formatKind({ format_id: '137', ext: 'mp4', vcodec: 'avc1' })).toBe('video')
  })

  it('reads a codec-less audio container as audio', () => {
    expect(formatKind({ format_id: 'a', ext: 'mp3' })).toBe('audio')
  })

  it('still drops what is not media', () => {
    expect(formatKind({ format_id: 'sb0', ext: 'mhtml', vcodec: 'none', acodec: 'none' })).toBe('unknown')
    expect(formatKind({ format_id: 'thumb', ext: 'jpg' })).toBe('unknown')
  })

  it('lets mapFormats offer the formats it used to drop', () => {
    const out = mapFormats([
      { format_id: 'html5-video-high', ext: 'mp4', acodec: 'none' },
      { format_id: 'sb0', ext: 'mhtml', vcodec: 'none', acodec: 'none' }
    ])
    expect(out.map((f) => f.id)).toEqual(['html5-video-high'])
  })
})
