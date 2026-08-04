import { describe, expect, it } from 'vitest'
import {
  buildConvertArgs,
  buildTrimArgs,
  humanizeFfmpegError,
  rangeDuration,
  toTimestamp
} from './ffmpeg'

describe('toTimestamp', () => {
  it('renders ffmpeg-friendly timestamps', () => {
    expect(toTimestamp(0)).toBe('00:00:00.000')
    expect(toTimestamp(65.5)).toBe('00:01:05.500')
    expect(toTimestamp(3661)).toBe('01:01:01.000')
  })

  it('clamps negatives rather than emitting a bad timestamp', () => {
    expect(toTimestamp(-10)).toBe('00:00:00.000')
  })
})

describe('rangeDuration', () => {
  it('is the span between the handles', () => {
    expect(rangeDuration({ start: 10, end: 25 })).toBe(15)
  })

  it('falls back to the source length when there is no end', () => {
    expect(rangeDuration({ start: 10 }, 100)).toBe(90)
  })

  it('is undefined when the end is unknown or the span is empty', () => {
    expect(rangeDuration({ start: 10 })).toBeUndefined()
    expect(rangeDuration({ start: 30, end: 10 })).toBeUndefined()
  })
})

describe('buildTrimArgs', () => {
  it('seeks before the input so the decode starts at the cut', () => {
    const args = buildTrimArgs('in.mp4', 'out.mp4', { start: 12, end: 20 }, true)
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'))
    expect(args[args.indexOf('-ss') + 1]).toBe('00:00:12.000')
  })

  it('expresses the span as a duration, not an absolute end', () => {
    // `-to` after `-ss` means different things in different ffmpeg versions;
    // `-t` is unambiguous.
    const args = buildTrimArgs('in.mp4', 'out.mp4', { start: 12, end: 20 }, true)
    expect(args).toContain('-t')
    expect(args[args.indexOf('-t') + 1]).toBe('00:00:08.000')
    expect(args).not.toContain('-to')
  })

  it('re-encodes for a precise cut and copies for a fast one', () => {
    const precise = buildTrimArgs('in.mp4', 'out.mp4', { start: 5 }, true)
    expect(precise).toContain('libx264')
    const fast = buildTrimArgs('in.mp4', 'out.mp4', { start: 5 }, false)
    expect(fast).toContain('copy')
    expect(fast).not.toContain('libx264')
  })

  it('omits the seek entirely when trimming only the tail', () => {
    const args = buildTrimArgs('in.mp4', 'out.mp4', { end: 30 }, true)
    expect(args).not.toContain('-ss')
  })

  it('always ends with the output path', () => {
    const args = buildTrimArgs('in.mp4', 'out.mp4', { start: 1, end: 2 }, true)
    expect(args[args.length - 1]).toBe('out.mp4')
  })
})

describe('buildConvertArgs', () => {
  it('drops the video stream for audio targets', () => {
    const args = buildConvertArgs('in.mp4', 'out.mp3', { mode: 'audio', container: 'mp3' })
    expect(args).toContain('-vn')
    expect(args).toContain('libmp3lame')
  })

  it('uses vp9/opus for webm and x264/aac for mp4', () => {
    expect(buildConvertArgs('in.mp4', 'o.webm', { mode: 'video', container: 'webm' })).toContain(
      'libvpx-vp9'
    )
    expect(buildConvertArgs('in.mp4', 'o.mp4', { mode: 'video', container: 'mp4' })).toContain(
      'libx264'
    )
  })

  it('builds a palette filter for gif rather than naive output', () => {
    const args = buildConvertArgs('in.mp4', 'o.gif', { mode: 'video', container: 'gif' })
    expect(args.join(' ')).toContain('palettegen')
    expect(args.join(' ')).toContain('paletteuse')
  })

  it('downscales with an even height so encoders accept it', () => {
    const args = buildConvertArgs('in.mp4', 'o.mp4', { mode: 'video', container: 'mp4', height: 720 })
    expect(args[args.indexOf('-vf') + 1]).toBe('scale=-2:720')
  })

  it('falls back to mp4 settings for an unknown container', () => {
    const args = buildConvertArgs('in.mp4', 'o.xyz', { mode: 'video', container: 'xyz' })
    expect(args).toContain('libx264')
  })

  it('always ends with the output path', () => {
    const args = buildConvertArgs('in.mp4', 'out.webm', { mode: 'video', container: 'webm' })
    expect(args[args.length - 1]).toBe('out.webm')
  })
})

describe('humanizeFfmpegError', () => {
  it('explains the silent-video-to-audio case', () => {
    // The real message ffmpeg emits when -vn leaves nothing to write.
    const message = humanizeFfmpegError('[out#0/mp3] Output file does not contain any stream')
    expect(message).toMatch(/no track/i)
  })

  it('explains a missing source and a full disk', () => {
    expect(humanizeFfmpegError('No such file or directory')).toMatch(/gone/i)
    expect(humanizeFfmpegError('No space left on device')).toMatch(/disk is full/i)
  })

  it('explains a damaged file', () => {
    expect(humanizeFfmpegError('moov atom not found')).toMatch(/damaged|incomplete/i)
  })

  it('falls back to the last non-bracketed line', () => {
    expect(humanizeFfmpegError('[libx264 @ 0x1] noise\nSomething specific went wrong')).toBe(
      'Something specific went wrong'
    )
  })
})
