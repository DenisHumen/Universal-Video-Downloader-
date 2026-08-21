import { describe, expect, it } from 'vitest'
import type { AppSettings, VideoFormat } from '@shared/types'
import {
  availableHeights,
  heightLabel,
  initialMode,
  initialQuality,
  maxHeightOf,
  outcomeResolution,
  resolveSelection
} from './quality'

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { defaultMode: 'video', defaultQuality: 'best', ...overrides } as AppSettings
}

const format = (height?: number): VideoFormat => ({
  id: String(height ?? 'audio'),
  ext: 'mp4',
  kind: height ? 'video' : 'audio',
  resolution: height ? `${height}p` : 'audio',
  height
})

describe('maxHeightOf', () => {
  it('is 0 when nothing has a height', () => {
    expect(maxHeightOf([])).toBe(0)
    expect(maxHeightOf([format(undefined)])).toBe(0)
  })

  it('returns the tallest format', () => {
    expect(maxHeightOf([format(360), format(1080), format(720)])).toBe(1080)
  })
})

describe('initialQuality', () => {
  it('defaults to best without settings', () => {
    expect(initialQuality(null)).toBe('best')
  })

  it('keeps the preference when the video has something better', () => {
    expect(initialQuality(settings({ defaultQuality: '1080' }), [2160, 1080, 720])).toBe('1080')
  })

  it('collapses to best when the preference is already the top of the ladder', () => {
    // Selecting "1080p" on a video whose best is 1080p is just "best".
    expect(initialQuality(settings({ defaultQuality: '1080' }), [1080, 720])).toBe('best')
  })

  it('falls back to best when the preference exceeds what the video offers', () => {
    // The whole point: a 4K default must not fail on a 720p-max video.
    expect(initialQuality(settings({ defaultQuality: '2160' }), 720)).toBe('best')
  })

  it('snaps down to a height the video really has', () => {
    // A 360p default on a 720/480/240 video must land on 240 — not on a 360p
    // button that doesn't exist.
    expect(initialQuality(settings({ defaultQuality: '360' }), [720, 480, 240])).toBe('240')
  })

  it('falls back to best when nothing is low enough', () => {
    expect(initialQuality(settings({ defaultQuality: '240' }), [1080, 720])).toBe('best')
  })

  it('keeps the preference when the available heights are unknown', () => {
    expect(initialQuality(settings({ defaultQuality: '720' }))).toBe('720')
    expect(initialQuality(settings({ defaultQuality: '720' }), [])).toBe('720')
  })

  it('normalises the audio preset to best for video', () => {
    expect(initialQuality(settings({ defaultQuality: 'audio' }), 1080)).toBe('best')
  })
})

describe('availableHeights', () => {
  it('lists distinct video heights, tallest first', () => {
    expect(availableHeights([format(480), format(720), format(480), format(240)])).toEqual([
      720, 480, 240
    ])
  })

  it('ignores audio-only formats and unknown heights', () => {
    expect(availableHeights([format(undefined), format(720)])).toEqual([720])
  })

  it('is empty when a site reports no heights at all', () => {
    expect(availableHeights([])).toEqual([])
  })
})

describe('heightLabel', () => {
  it('calls 2160 and above 4K, everything else by height', () => {
    expect(heightLabel(2160)).toBe('4K')
    expect(heightLabel(720)).toBe('720p')
    expect(heightLabel(240)).toBe('240p')
  })
})

describe('initialMode', () => {
  it('honours an audio default and otherwise picks video', () => {
    expect(initialMode(settings({ defaultMode: 'audio' }))).toBe('audio')
    expect(initialMode(settings({ defaultMode: 'video' }))).toBe('video')
    expect(initialMode(null)).toBe('video')
  })
})

describe('resolveSelection', () => {
  const formats: VideoFormat[] = [
    { id: '313', ext: 'webm', kind: 'video', resolution: '2160p', height: 2160, fps: 30, vcodec: 'vp9.2', filesize: 900_000_000, dynamicRange: 'HDR' },
    { id: '299', ext: 'mp4', kind: 'video', resolution: '1080p60', height: 1080, fps: 60, vcodec: 'avc1.64002a', filesize: 300_000_000 },
    { id: '22', ext: 'mp4', kind: 'video+audio', resolution: '720p', height: 720, fps: 30, vcodec: 'avc1', acodec: 'mp4a', filesize: 100_000_000 },
    { id: '18', ext: 'mp4', kind: 'video+audio', resolution: '360p', height: 360, fps: 30, vcodec: 'avc1', acodec: 'mp4a', filesize: 20_000_000 },
    { id: '140', ext: 'm4a', kind: 'audio', resolution: 'audio', acodec: 'mp4a', abr: 128, filesize: 6_000_000 }
  ]

  it('resolves "best" to the tallest stream, so the UI can name it', () => {
    const out = resolveSelection(formats, { mode: 'video', quality: 'best' })
    expect(out?.height).toBe(2160)
    expect(out?.dynamicRange).toBe('HDR')
  })

  it('adds the audio stream a video-only format will be merged with', () => {
    const out = resolveSelection(formats, { mode: 'video', quality: 'best' })
    expect(out?.bytes).toBe(906_000_000)
    // A merged download is remuxed to mp4 whatever the video stream was.
    expect(out?.ext).toBe('mp4')
  })

  it('leaves a self-contained stream alone', () => {
    const out = resolveSelection(formats, { mode: 'video', quality: '720' })
    expect(out?.height).toBe(720)
    expect(out?.bytes).toBe(100_000_000)
  })

  it('honours a cap the way the engine does — at or under, never above', () => {
    expect(resolveSelection(formats, { mode: 'video', quality: '1080' })?.height).toBe(1080)
    expect(resolveSelection(formats, { mode: 'video', quality: '480' })?.height).toBe(360)
  })

  it('falls back to the best available when the cap is under everything', () => {
    const tall: VideoFormat[] = [
      { id: 'a', ext: 'mp4', kind: 'video+audio', resolution: '1080p', height: 1080 }
    ]
    expect(resolveSelection(tall, { mode: 'video', quality: '360' })?.height).toBe(1080)
  })

  it('follows an explicit stream choice over the preset', () => {
    const out = resolveSelection(formats, { mode: 'video', quality: 'best', formatId: '18' })
    expect(out?.height).toBe(360)
  })

  it('describes an audio download by its container, not a resolution', () => {
    const out = resolveSelection(formats, { mode: 'audio' }, 'mp3')
    expect(out?.height).toBeUndefined()
    expect(out?.ext).toBe('mp3')
    expect(out?.bytes).toBe(6_000_000)
  })

  it('says nothing rather than guessing when the site reported no formats', () => {
    expect(resolveSelection([], { mode: 'video', quality: 'best' })).toBeNull()
  })

  it('prefers higher fps at the same height', () => {
    const sameHeight: VideoFormat[] = [
      { id: 'a', ext: 'mp4', kind: 'video+audio', resolution: '1080p', height: 1080, fps: 30 },
      { id: 'b', ext: 'mp4', kind: 'video+audio', resolution: '1080p60', height: 1080, fps: 60 }
    ]
    expect(resolveSelection(sameHeight, { mode: 'video', quality: 'best' })?.fps).toBe(60)
  })
})

describe('outcomeResolution', () => {
  it('marks a high frame rate and leaves an ordinary one alone', () => {
    expect(outcomeResolution({ height: 1080, fps: 60 })).toBe('1080p60')
    expect(outcomeResolution({ height: 1080, fps: 30 })).toBe('1080p')
    expect(outcomeResolution({ height: 2160 })).toBe('4K')
    expect(outcomeResolution({})).toBeNull()
    expect(outcomeResolution(null)).toBeNull()
  })
})
