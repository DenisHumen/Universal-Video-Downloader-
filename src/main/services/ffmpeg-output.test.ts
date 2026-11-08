import { describe, expect, it } from 'vitest'
import { ffmpegProgressSeconds, ffmpegTransfer, isFfmpegNoise, splitOutputLines } from './ffmpeg-output'

describe('splitOutputLines', () => {
  it('breaks on carriage returns, which is all ffmpeg ever writes', () => {
    // The whole point: a newline split leaves this as one unreadable line, and
    // that is why a trimmed download's bar never moved.
    expect(splitOutputLines('frame=1 time=00:00:01.00\rframe=2 time=00:00:02.00\r')).toEqual([
      'frame=1 time=00:00:01.00',
      'frame=2 time=00:00:02.00',
      ''
    ])
  })

  it('still handles ordinary newlines and CRLF', () => {
    expect(splitOutputLines('a\nb\r\nc')).toEqual(['a', 'b', 'c'])
  })
})

describe('ffmpegTransfer', () => {
  const LINE = 'frame= 6000 fps=600 q=-1.0 size=  102400KiB time=00:01:40.00 bitrate=8388.6kbits/s speed=10x'

  it('works out size, speed and time left from a status line and the duration', () => {
    const t = ffmpegTransfer(LINE, 1000)
    expect(t.downloadedBytes).toBe(102400 * 1024)
    // 1 MiB of video per second of it, fetched ten times faster than it plays.
    expect(t.speed).toBeCloseTo(10 * 1024 ** 2)
    expect(t.totalBytes).toBeCloseTo(102400 * 1024 * 10, -3)
    expect(t.eta).toBeCloseTo(90)
  })

  it('knows only the size and speed without a duration', () => {
    const t = ffmpegTransfer(LINE)
    expect(t.downloadedBytes).toBeGreaterThan(0)
    expect(t.speed).toBeGreaterThan(0)
    expect(t.totalBytes).toBeUndefined()
    expect(t.eta).toBeUndefined()
  })

  it('says nothing it cannot read', () => {
    expect(ffmpegTransfer('[hls @ 0x1] Opening segment')).toEqual({})
    const early = ffmpegTransfer('frame=0 size=N/A time=00:00:00.00 bitrate=N/A speed=N/A', 100)
    expect(early).toEqual({ downloadedBytes: undefined, speed: undefined, totalBytes: undefined, eta: undefined })
  })
})

describe('ffmpegProgressSeconds', () => {
  it('reads the output timestamp off a status line', () => {
    expect(
      ffmpegProgressSeconds(
        'frame=  240 fps= 30 q=28.0 size=    2048kB time=00:00:08.00 bitrate=2097.2kbits/s speed=1.5x'
      )
    ).toBeCloseTo(8)
  })

  it('handles the size= form ffmpeg uses when there is no video stream', () => {
    expect(ffmpegProgressSeconds('size=    512kB time=00:01:30.50 bitrate= 46.5kbits/s')).toBeCloseTo(
      90.5
    )
  })

  it('counts hours', () => {
    expect(ffmpegProgressSeconds('frame=1 time=01:02:03.00 speed=1x')).toBeCloseTo(3723)
  })

  it('reads a negative timestamp as no progress rather than as going backwards', () => {
    // Happens at the head of a cut that starts before the first keyframe.
    expect(ffmpegProgressSeconds('frame=1 time=-00:00:00.02 speed=1x')).toBe(0)
  })

  it('ignores anything that is not a status line', () => {
    expect(ffmpegProgressSeconds('[download] Destination: video.mp4')).toBeUndefined()
    expect(ffmpegProgressSeconds('ERROR: unable to download video data')).toBeUndefined()
    // A duration report is not progress — it is the total.
    expect(ffmpegProgressSeconds('  Duration: 00:10:00.00, start: 0.000000')).toBeUndefined()
  })
})

describe('isFfmpegNoise', () => {
  it('recognises the status line it prints once a second', () => {
    expect(isFfmpegNoise('frame=  240 fps= 30 time=00:00:08.00 speed=1.5x')).toBe(true)
    expect(isFfmpegNoise('[https @ 0x55f] Opening for reading')).toBe(true)
  })

  it('keeps everything that could explain a failure', () => {
    expect(isFfmpegNoise('ERROR: ffmpeg exited with code 1')).toBe(false)
    expect(isFfmpegNoise('Invalid data found when processing input')).toBe(false)
    expect(isFfmpegNoise('[Merger] Merging formats into "video.mp4"')).toBe(false)
    // Same prefix as the chatter above, and the only line that says why.
    expect(isFfmpegNoise('[hls @ 0x55f] Failed to open segment 12 of playlist 0')).toBe(false)
    expect(isFfmpegNoise('[https @ 0x55f] HTTP error 403 Forbidden')).toBe(false)
  })
})
