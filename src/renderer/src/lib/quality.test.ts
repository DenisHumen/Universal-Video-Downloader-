import { describe, expect, it } from 'vitest'
import type { AppSettings, VideoFormat } from '@shared/types'
import { initialMode, initialQuality, maxHeightOf } from './quality'

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

  it('keeps the preference when the video can satisfy it', () => {
    expect(initialQuality(settings({ defaultQuality: '1080' }), 2160)).toBe('1080')
    expect(initialQuality(settings({ defaultQuality: '1080' }), 1080)).toBe('1080')
  })

  it('falls back to best when the preference exceeds what the video offers', () => {
    // The whole point: a 4K default must not fail on a 720p-max video.
    expect(initialQuality(settings({ defaultQuality: '2160' }), 720)).toBe('best')
  })

  it('keeps the preference when the ceiling is unknown', () => {
    expect(initialQuality(settings({ defaultQuality: '720' }), 0)).toBe('720')
  })

  it('normalises the audio preset to best for video', () => {
    expect(initialQuality(settings({ defaultQuality: 'audio' }), 1080)).toBe('best')
  })
})

describe('initialMode', () => {
  it('honours an audio default and otherwise picks video', () => {
    expect(initialMode(settings({ defaultMode: 'audio' }))).toBe('audio')
    expect(initialMode(settings({ defaultMode: 'video' }))).toBe('video')
    expect(initialMode(null)).toBe('video')
  })
})
