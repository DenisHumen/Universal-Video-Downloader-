import { describe, expect, it } from 'vitest'
import { best, classify, isPlausible, rank, scoreUrl, type MediaCandidate } from './candidates'

function candidate(url: string, source = 'raw', bonus = 0): MediaCandidate {
  const { kind, score } = scoreUrl(url, bonus)
  return { url, kind, score, source }
}

describe('classify', () => {
  it('recognises the streaming manifest formats', () => {
    expect(classify('https://cdn.test/master.m3u8').kind).toBe('hls')
    expect(classify('https://cdn.test/manifest.mpd').kind).toBe('dash')
    expect(classify('https://cdn.test/video.mp4').kind).toBe('file')
  })

  it('scores an unknown URL at zero so it can never win', () => {
    expect(classify('https://cdn.test/page.html').score).toBe(0)
    expect(scoreUrl('https://cdn.test/page.html').score).toBe(0)
  })
})

describe('scoreUrl', () => {
  it('prefers HLS over progressive files', () => {
    expect(scoreUrl('https://cdn.test/master.m3u8').score).toBeGreaterThan(
      scoreUrl('https://cdn.test/video.mp4').score
    )
  })

  it('demotes trailers and previews below the real video', () => {
    expect(scoreUrl('https://cdn.test/trailer.mp4').score).toBeLessThan(
      scoreUrl('https://cdn.test/video.mp4').score
    )
  })

  it('demotes sprite/thumbnail strips', () => {
    expect(isPlausible(candidate('https://cdn.test/storyboard.mp4'))).toBe(false)
  })

  it('rejects ad-network media outright', () => {
    expect(isPlausible(candidate('https://ads.doubleclick.net/spot.mp4'))).toBe(false)
    expect(isPlausible(candidate('https://cdn.test/ads/preroll.mp4'))).toBe(false)
  })

  it('demotes individual HLS segments so a master playlist wins', () => {
    expect(scoreUrl('https://cdn.test/seg-12.ts').score).toBeLessThan(
      scoreUrl('https://cdn.test/master.m3u8').score
    )
  })

  it('rewards structured sources over a raw markup sweep', () => {
    const structured = scoreUrl('https://cdn.test/video.mp4', 34).score
    const raw = scoreUrl('https://cdn.test/video.mp4', 0).score
    expect(structured).toBeGreaterThan(raw)
  })

  it('never treats a blob: URL as downloadable', () => {
    expect(isPlausible(candidate('blob:https://site.test/abcd.mp4'))).toBe(false)
  })
})

describe('rank', () => {
  it('sorts best-first and de-duplicates by URL', () => {
    const ranked = rank([
      candidate('https://cdn.test/video.mp4'),
      candidate('https://cdn.test/master.m3u8'),
      candidate('https://cdn.test/video.mp4')
    ])
    expect(ranked).toHaveLength(2)
    expect(ranked[0].url).toBe('https://cdn.test/master.m3u8')
  })

  it('keeps the headers from whichever copy carried them', () => {
    const withHeaders: MediaCandidate = {
      ...candidate('https://cdn.test/master.m3u8'),
      headers: { Referer: 'https://site.test/' },
      score: 10
    }
    const withoutHeaders = candidate('https://cdn.test/master.m3u8')
    const ranked = rank([withHeaders, withoutHeaders])
    expect(ranked[0].headers).toEqual({ Referer: 'https://site.test/' })
  })
})

describe('best', () => {
  it('returns nothing when every candidate is junk', () => {
    expect(best([candidate('https://cdn.test/thumbs/sprite.mp4')])).toBeUndefined()
    expect(best([])).toBeUndefined()
  })

  it('picks the manifest out of a noisy page', () => {
    const found = best([
      candidate('https://ads.doubleclick.net/spot.mp4'),
      candidate('https://cdn.test/preview.mp4'),
      candidate('https://cdn.test/hls/master.m3u8'),
      candidate('https://cdn.test/seg-1.ts')
    ])
    expect(found?.url).toBe('https://cdn.test/hls/master.m3u8')
  })
})
