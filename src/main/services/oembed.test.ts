import { describe, expect, it } from 'vitest'
import { oembedEndpoint, readOembed } from './oembed-rules'

describe('oembedEndpoint', () => {
  it('asks each listed site at its own endpoint, with the canonical link', () => {
    expect(oembedEndpoint('https://youtu.be/dQw4w9WgXcQ?si=x')).toBe(
      'https://www.youtube.com/oembed?format=json&url=' +
        encodeURIComponent('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    )
    expect(oembedEndpoint('https://vimeo.com/76979871')).toBe(
      'https://vimeo.com/api/oembed.json?url=' + encodeURIComponent('https://vimeo.com/76979871')
    )
    expect(oembedEndpoint('https://www.dailymotion.com/video/x8abc')).toMatch(
      /^https:\/\/www\.dailymotion\.com\/services\/oembed\?format=json&url=/
    )
    expect(oembedEndpoint('https://soundcloud.com/artist/track')).toMatch(/^https:\/\/soundcloud\.com\/oembed\?/)
    expect(oembedEndpoint('https://www.tiktok.com/@u/video/7123?is_from_webapp=1')).toBe(
      'https://www.tiktok.com/oembed?url=' + encodeURIComponent('https://www.tiktok.com/@u/video/7123')
    )
  })

  it('asks nobody about a site that is not on the list', () => {
    expect(oembedEndpoint('https://some-tube.test/watch/1')).toBeNull()
    // A lookalike host is not the site.
    expect(oembedEndpoint('https://notyoutube.com/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(oembedEndpoint('https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(oembedEndpoint('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(oembedEndpoint('uvd-sniff://abc')).toBeNull()
    expect(oembedEndpoint('not a link')).toBeNull()
  })
})

describe('readOembed', () => {
  it('keeps the title, uploader and poster', () => {
    expect(
      readOembed({ title: 'A talk', author_name: 'Someone', thumbnail_url: 'https://i.ytimg.com/vi/x/hq.jpg' })
    ).toEqual({ title: 'A talk', author: 'Someone', thumbnail: 'https://i.ytimg.com/vi/x/hq.jpg' })
  })

  it('drops what the window could not or should not show', () => {
    expect(readOembed({ title: 'A\u0000talk', thumbnail_url: 'http://plain.test/x.jpg' })).toEqual({
      title: 'A talk',
      author: undefined,
      thumbnail: undefined
    })
    expect(readOembed({ title: 42, author_name: 'x' })).toBeNull()
    expect(readOembed(null)).toBeNull()
    expect(readOembed('html')).toBeNull()
    expect(readOembed({ title: 'x'.repeat(1000) })?.title).toHaveLength(300)
  })
})
