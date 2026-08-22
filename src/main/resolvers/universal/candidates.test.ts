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

  /*
    Each junk word used to end in an optional separator, which is no boundary at
    all, so the list matched anything merely starting with one of them. These are
    ordinary videos that were being read as adverts and thumbnails — and at 45 or
    55 off, they landed under the floor and were dropped rather than demoted, so
    the page came back as "nothing found".
  */
  it('does not read a junk word out of the middle of an ordinary name', () => {
    for (const url of [
      'https://cdn.test/course/introduction.mp4',
      'https://cdn.test/videos/cover-band-live.mp4',
      'https://cdn.test/promotional-strategy.mp4',
      'https://cdn.test/posterior-approach.mp4',
      'https://cdn.test/app/logout.mp4',
      'https://cdn.test/bannerman-interview.mp4'
    ]) {
      expect(scoreUrl(url).score, url).toBe(scoreUrl('https://cdn.test/video.mp4').score)
    }
  })

  it('demotes a trailer to the floor but still offers it', () => {
    // A page whose only video is the trailer is a page somebody opened wanting
    // the trailer; a course's first lesson really is called intro.mp4.
    for (const url of ['https://cdn.test/trailer.mp4', 'https://cdn.test/intro.mp4']) {
      expect(isPlausible(candidate(url)), url).toBe(true)
      expect(scoreUrl(url).score).toBeLessThan(scoreUrl('https://cdn.test/video.mp4').score)
    }
  })

  it('does not let a soft penalty lift something already below the floor', () => {
    expect(isPlausible(candidate('https://cdn.test/preview/seg-4.ts'))).toBe(false)
  })

  it('still drops the things that are certainly not the video', () => {
    for (const url of [
      'https://cdn.test/storyboard.mp4',
      'https://cdn.test/thumbs/sprite.mp4',
      'https://cdn.test/hls/thumbnails.mp4',
      'https://ads.doubleclick.net/spot.mp4'
    ]) {
      expect(isPlausible(candidate(url)), url).toBe(false)
    }
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

describe('content types', () => {
  it('scores a manifest the same whether the path or the response says so', () => {
    // The case this exists for: a CDN serving HLS from an extensionless path.
    const hls = scoreUrl('https://cdn.test/hls/98213', 0, 'application/vnd.apple.mpegurl')
    expect(hls.kind).toBe('hls')
    // 100 for the manifest, plus the /hls/ path bonus every manifest gets.
    expect(hls.score).toBeGreaterThanOrEqual(100)
    expect(scoreUrl('https://cdn.test/stream/98213', 0, 'application/dash+xml').kind).toBe('dash')
    expect(scoreUrl('https://cdn.test/v/98213', 0, 'video/mp4').score).toBe(82)
  })

  it('still prefers what the URL says when the URL says anything at all', () => {
    // A .m3u8 served as text/plain is still a manifest.
    expect(scoreUrl('https://cdn.test/master.m3u8', 0, 'text/plain').score).toBeGreaterThan(100)
  })

  it('ignores a response that is not media', () => {
    expect(scoreUrl('https://cdn.test/page', 0, 'text/html').score).toBe(0)
    expect(scoreUrl('https://cdn.test/page', 0).score).toBe(0)
  })

  it('demotes a single HLS segment, whichever way it is recognised', () => {
    expect(scoreUrl('https://cdn.test/seg/00042', 0, 'video/mp2t').score).toBeLessThan(40)
  })

  it('ranks audio below every video container but still finds it', () => {
    const audio = scoreUrl('https://cdn.test/episode.mp3').score
    const video = scoreUrl('https://cdn.test/episode.mp4').score
    expect(audio).toBeGreaterThan(40)
    expect(audio).toBeLessThan(video)
  })

  it('lets Content-Length break a tie between two of a kind', () => {
    const [first] = rank([
      { url: 'https://cdn.test/a.mp4', kind: 'file', score: 82, source: 'network', bytes: 1_000 },
      { url: 'https://cdn.test/b.mp4', kind: 'file', score: 82, source: 'network', bytes: 900_000_000 }
    ])
    expect(first.url).toBe('https://cdn.test/b.mp4')
  })
})
