import { describe, expect, it } from 'vitest'
import { looksLikeCollection } from './urls'

describe('looksLikeCollection', () => {
  it('expands playlist, channel and set pages', () => {
    expect(looksLikeCollection('https://www.youtube.com/playlist?list=PL123')).toBe(true)
    expect(looksLikeCollection('https://www.youtube.com/@somechannel')).toBe(true)
    expect(looksLikeCollection('https://www.youtube.com/channel/UC123')).toBe(true)
    expect(looksLikeCollection('https://soundcloud.com/artist/sets/an-album')).toBe(true)
  })

  it('leaves a single video alone even when it sits inside a playlist', () => {
    // Pasting a video link must download that video, not the whole playlist.
    expect(looksLikeCollection('https://www.youtube.com/watch?v=abc123&list=PL123')).toBe(false)
    expect(looksLikeCollection('https://www.youtube.com/watch?v=abc123')).toBe(false)
  })

  it('leaves ordinary pages alone', () => {
    expect(looksLikeCollection('https://vimeo.com/123456')).toBe(false)
    expect(looksLikeCollection('https://example.com/some/article')).toBe(false)
  })
})
