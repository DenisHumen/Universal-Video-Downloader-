import { describe, expect, it } from 'vitest'
import type { AppSettings, VideoFormat } from '@shared/types'
import { availableHeights, heightLabel, initialMode, initialQuality, maxHeightOf } from './quality'

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
