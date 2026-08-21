import { describe, expect, it } from 'vitest'
import { extractFromHtml } from './static'

const BASE = 'https://site.test/watch/42'

/** The URLs found, best first — what the resolver actually acts on. */
function urls(html: string, base = BASE): string[] {
  return extractFromHtml(html, base).candidates.map((c) => c.url)
}

describe('extractFromHtml', () => {
  it('reads a JSON-LD VideoObject', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'VideoObject',
      name: 'A film',
      contentUrl: 'https://cdn.test/film.mp4',
      thumbnailUrl: 'https://cdn.test/poster.jpg',
      duration: 'PT1H2M3S'
    })}</script>`
    const found = extractFromHtml(html, BASE)
    expect(found.candidates[0].url).toBe('https://cdn.test/film.mp4')
    expect(found.title).toBe('A film')
    expect(found.thumbnail).toBe('https://cdn.test/poster.jpg')
    expect(found.duration).toBeCloseTo(3723)
  })

  it('reads the microdata form of the same thing', () => {
    // schema.org as it was written before JSON-LD, which plenty of sites still
    // use — and which the scraper used to walk straight past.
    const html = `
      <div itemscope itemtype="http://schema.org/VideoObject">
        <meta itemprop="contentURL" content="https://cdn.test/film.mp4" />
        <link itemprop="thumbnailUrl" href="https://cdn.test/poster.jpg" />
      </div>`
    const found = extractFromHtml(html, BASE)
    expect(found.candidates[0].url).toBe('https://cdn.test/film.mp4')
    expect(found.thumbnail).toBe('https://cdn.test/poster.jpg')
  })

  it('reads microdata whichever order the attributes come in', () => {
    const html = `<meta content="https://cdn.test/film.mp4" itemprop="contentUrl">`
    expect(urls(html)).toContain('https://cdn.test/film.mp4')
  })

  it('reads OpenGraph video tags', () => {
    const html = `<meta property="og:video:secure_url" content="https://cdn.test/og.mp4">
      <meta property="og:title" content="From OpenGraph">`
    const found = extractFromHtml(html, BASE)
    expect(found.candidates[0].url).toBe('https://cdn.test/og.mp4')
    expect(found.title).toBe('From OpenGraph')
  })

  it('reads a <video> element and its <source> children', () => {
    const html = `<video poster="/poster.jpg"><source src="/media/a.mp4"><source src="//cdn.test/b.webm"></video>`
    const found = extractFromHtml(html, BASE)
    expect(found.candidates.map((c) => c.url)).toEqual(
      expect.arrayContaining(['https://site.test/media/a.mp4', 'https://cdn.test/b.webm'])
    )
    expect(found.thumbnail).toBe('https://site.test/poster.jpg')
  })

  it('reads an <audio> element, because an audio-only page is still a download', () => {
    const html = `<audio><source src="https://cdn.test/episode.mp3"></audio>`
    expect(urls(html)).toContain('https://cdn.test/episode.mp3')
  })

  it('reads a player config object', () => {
    const html = `<script>jwplayer("p").setup({ file: "https://cdn.test/stream/master.m3u8" })</script>`
    expect(urls(html)[0]).toBe('https://cdn.test/stream/master.m3u8')
  })

  it('reads a lazy source parked on a data attribute', () => {
    // The headless pass learned to do this; the free static pass had not, so a
    // page that needed no browser was getting one.
    const html = `<div class="player" data-hls="https://cdn.test/hls/master.m3u8"></div>`
    expect(urls(html)).toContain('https://cdn.test/hls/master.m3u8')
  })

  it('sees through the escaping that hides a URL inside embedded JSON', () => {
    const html = `<script>window.__DATA__={"src":"https:\\/\\/cdn.test\\/embedded.mp4"}</script>`
    expect(urls(html)).toContain('https://cdn.test/embedded.mp4')
  })

  it('ranks a manifest above a progressive file above a segment', () => {
    const html = `
      <div data-src="https://cdn.test/hls/master.m3u8"></div>
      <video src="https://cdn.test/progressive.mp4"></video>
      <script>var seg = "https://cdn.test/seg/00042.ts"</script>`
    const found = urls(html)
    expect(found[0]).toBe('https://cdn.test/hls/master.m3u8')
    expect(found[1]).toBe('https://cdn.test/progressive.mp4')
    expect(found).not.toContain('https://cdn.test/seg/00042.ts')
  })

  it('demotes the trailer and the advert below the film', () => {
    const html = `
      <video src="https://cdn.test/media/trailer.mp4"></video>
      <video src="https://cdn.test/media/feature.mp4"></video>
      <video src="https://ads.test/preroll/spot.mp4"></video>`
    const found = urls(html)
    expect(found[0]).toBe('https://cdn.test/media/feature.mp4')
  })

  it('takes the page title when nothing better is offered, without the site suffix', () => {
    const html = `<title>Some Film — SiteName</title><video src="https://cdn.test/a.mp4"></video>`
    expect(extractFromHtml(html, BASE).title).toBe('Some Film')
  })

  it('finds nothing in a page that has nothing', () => {
    const html = `<html><body><h1>An article</h1><img src="/pic.jpg"></body></html>`
    expect(extractFromHtml(html, BASE).candidates).toEqual([])
  })

  it('never returns a relative or javascript: URL', () => {
    const html = `<video src="javascript:void(0)"></video><div data-src="/relative/clip.mp4"></div>`
    for (const url of urls(html)) expect(url).toMatch(/^https?:\/\//)
  })
})
