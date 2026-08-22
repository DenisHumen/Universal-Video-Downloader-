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

  /*
    A trim writes beside its source and keeps its extension, so the encoders
    have to be ones that container will accept. Handing the MP3 muxer an AAC
    stream, or the WebM muxer h264, fails before the first frame — which is
    every audio download and every VP9 download, on the default setting.
  */
  it('copies rather than re-encodes a lossy audio file, whatever the toggle says', () => {
    for (const ext of ['mp3', 'm4a', 'opus', 'wav', 'ogg']) {
      const args = buildTrimArgs(`in.${ext}`, `out.${ext}`, { start: 5, end: 15 }, true)
      expect(args).toContain('copy')
      expect(args).not.toContain('libx264')
      expect(args).not.toContain('aac')
    }
  })

  /*
    A copied FLAC keeps the source's STREAMINFO, so the cut reports the original
    length and a start time in the middle of it — verified by decoding the
    result and comparing. Re-encoding is free: FLAC is lossless.
  */
  it('re-encodes flac, whose header a copy would leave lying', () => {
    for (const precise of [true, false]) {
      const args = buildTrimArgs('in.flac', 'out.flac', { start: 5, end: 15 }, precise)
      expect(args).toContain('flac')
      expect(args.join(' ')).toContain('-c:a flac')
    }
  })

  it('copies when the source has no video, whatever the container is called', () => {
    const args = buildTrimArgs('in.mp4', 'out.mp4', { start: 5 }, true, false)
    expect(args).toContain('copy')
    expect(args).not.toContain('libx264')
  })

  it('re-encodes webm to vp9 and opus, which is all webm accepts', () => {
    const args = buildTrimArgs('in.webm', 'out.webm', { start: 5, end: 15 }, true)
    expect(args).toContain('libvpx-vp9')
    expect(args).toContain('libopus')
    expect(args).not.toContain('libx264')
    expect(args).not.toContain('aac')
  })

  it('still re-encodes a real video cut to h264', () => {
    for (const ext of ['mp4', 'mkv', 'mov']) {
      const args = buildTrimArgs(`in.${ext}`, `out.${ext}`, { start: 5, end: 15 }, true)
      expect(args).toContain('libx264')
      expect(args).toContain('aac')
    }
  })

  it('keeps +faststart to the mov family that understands it', () => {
    expect(buildTrimArgs('i.mp4', 'o.mp4', { start: 1 }, true)).toContain('+faststart')
    expect(buildTrimArgs('i.webm', 'o.webm', { start: 1 }, true)).not.toContain('+faststart')
    expect(buildTrimArgs('i.mkv', 'o.mkv', { start: 1 }, true)).not.toContain('+faststart')
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

  /*
    Turning an MKV of h264 and AAC into an MP4 is the commonest thing anyone
    asks of this screen, and the streams inside are already what MP4 wants — it
    is a rewrap. It re-encoded every frame at CRF 21 anyway: measured at 1027ms
    against 46ms for the copy on a 20-second clip, and the re-encode came out
    less than half the size, which is quality thrown away rather than saved.
  */
  it('copies the streams when only the container changes', () => {
    const args = buildConvertArgs(
      'in.mkv',
      'out.mp4',
      { mode: 'video', container: 'mp4' },
      { videoCodec: 'h264', audioCodec: 'aac' }
    )
    expect(args).toContain('copy')
    expect(args).not.toContain('libx264')
    // One video and one audio track: MP4 cannot hold the ASS subtitles an MKV
    // often carries, and a blanket copy would fail the whole file over them.
    expect(args.join(' ')).toContain('-map 0:v:0 -map 0:a:0?')
  })

  it('re-encodes when the target container cannot hold those codecs', () => {
    const vp9 = { videoCodec: 'vp9', audioCodec: 'opus' }
    expect(buildConvertArgs('i.webm', 'o.mp4', { mode: 'video', container: 'mp4' }, vp9)).toContain(
      'libx264'
    )
    const h264 = { videoCodec: 'h264', audioCodec: 'aac' }
    expect(
      buildConvertArgs('i.mp4', 'o.webm', { mode: 'video', container: 'webm' }, h264)
    ).toContain('libvpx-vp9')
  })

  it('re-encodes when a downscale was asked for, since that has to decode', () => {
    const args = buildConvertArgs(
      'in.mkv',
      'out.mp4',
      { mode: 'video', container: 'mp4', height: 720 },
      { videoCodec: 'h264', audioCodec: 'aac' }
    )
    expect(args).toContain('libx264')
    expect(args).not.toContain('copy')
  })

  it('re-encodes when nothing is known about the streams', () => {
    expect(buildConvertArgs('in.mkv', 'out.mp4', { mode: 'video', container: 'mp4' })).toContain(
      'libx264'
    )
  })

  it('copies a video with no audio at all', () => {
    const args = buildConvertArgs(
      'in.mkv',
      'out.mp4',
      { mode: 'video', container: 'mp4' },
      { videoCodec: 'h264' }
    )
    expect(args).toContain('copy')
  })

  /*
    The GIF branch turned a requested height into a width by multiplying by
    16/9 and scaled on that — right only for a 16:9 source. A 1080x1920 phone
    video asked to be 480 tall came out 853x1517: three times the height, and a
    file to match. Verified against ffmpeg that it is now 270x480.
  */
  it('scales a gif by the dimension it was actually given', () => {
    const tall = buildConvertArgs('in.mp4', 'out.gif', { mode: 'video', container: 'gif', height: 480 })
    expect(tall.join(' ')).toContain('scale=-1:480')
    const bare = buildConvertArgs('in.mp4', 'out.gif', { mode: 'video', container: 'gif' })
    expect(bare.join(' ')).toContain('scale=480:-1')
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
