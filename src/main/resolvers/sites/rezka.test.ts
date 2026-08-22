import { describe, expect, it } from 'vitest'
import { labelHeight, parseStreams, pickQuality } from './rezka'

/*
  HDRezka labels its streams in free text and `4K` is one of them. Reading the
  label with `parseInt` gave 4, which put the best stream the site has below its
  worst — "best quality" always came back 1080p, and a request for 480p could be
  answered with the 4K stream, because 4 is less than 480.
*/
describe('labelHeight', () => {
  it('reads the ordinary labels', () => {
    expect(labelHeight('360p')).toBe(360)
    expect(labelHeight('480p')).toBe(480)
    expect(labelHeight('720p')).toBe(720)
    expect(labelHeight('1080p')).toBe(1080)
  })

  it('reads the ones written in K', () => {
    expect(labelHeight('4K')).toBe(2160)
    expect(labelHeight('2K')).toBe(1440)
    expect(labelHeight('8K')).toBe(4320)
  })

  it('gives up on a label with no number in it', () => {
    expect(labelHeight('auto')).toBe(0)
  })
})

describe('parseStreams', () => {
  const raw = '[360p]https://cdn.test/360.mp4,[1080p]https://cdn.test/1080.mp4,[4K]https://cdn.test/4k.mp4'

  it('sorts 4K above 1080p rather than below 360p', () => {
    expect(parseStreams(raw).map((s) => s.quality)).toEqual(['360p', '1080p', '4K'])
  })

  it('skips the tiers that need a subscription', () => {
    const withUltra = `${raw},[1080p Ultra]https://cdn.test/ultra.mp4`
    expect(parseStreams(withUltra).map((s) => s.quality)).not.toContain('1080p Ultra')
  })
})

describe('pickQuality', () => {
  const streams = parseStreams(
    '[360p]https://cdn.test/360.mp4,[1080p]https://cdn.test/1080.mp4,[4K]https://cdn.test/4k.mp4'
  )

  it('picks 4K for best', () => {
    expect(pickQuality(streams, 'best')?.quality).toBe('4K')
  })

  it('does not hand back 4K to someone who asked for 480p', () => {
    expect(pickQuality(streams, '480')?.quality).toBe('360p')
  })

  it('takes the nearest below the request', () => {
    expect(pickQuality(streams, '1080')?.quality).toBe('1080p')
    expect(pickQuality(streams, '2160')?.quality).toBe('4K')
  })

  it('falls back to the lowest when everything is above the request', () => {
    expect(pickQuality(streams, '240')?.quality).toBe('360p')
  })

  it('has nothing to say about an empty list', () => {
    expect(pickQuality([], 'best')).toBeUndefined()
  })
})
