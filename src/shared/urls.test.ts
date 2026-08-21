import { describe, expect, it } from 'vitest'
import { looksLikeCollection, needsCookiesOften, normalizeUrl } from './urls'

describe('normalizeUrl', () => {
  it('leaves internal and non-http links untouched', () => {
    expect(normalizeUrl('uvd-rezka://abc')).toBe('uvd-rezka://abc')
    expect(normalizeUrl('uvd-sniff://Zm9v')).toBe('uvd-sniff://Zm9v')
    expect(normalizeUrl('not a url')).toBe('not a url')
  })

  it('adds the scheme a pasted host is missing', () => {
    expect(normalizeUrl('www.youtube.com/watch?v=abc123')).toBe(
      'https://www.youtube.com/watch?v=abc123'
    )
    expect(normalizeUrl('vimeo.com/123456')).toBe('https://vimeo.com/123456')
  })

  it('strips punctuation picked up from running text', () => {
    expect(normalizeUrl('(https://vimeo.com/123456)')).toBe('https://vimeo.com/123456')
    expect(normalizeUrl('https://vimeo.com/123456.')).toBe('https://vimeo.com/123456')
  })

  it('canonicalises every YouTube share shape onto /watch', () => {
    expect(normalizeUrl('https://youtu.be/dQw4w9WgXcQ?si=xyz')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    )
    expect(normalizeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    )
    expect(normalizeUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    )
    expect(normalizeUrl('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    )
  })

  it('keeps a playlist id, which is part of what the link means', () => {
    expect(normalizeUrl('https://www.youtube.com/playlist?list=PL123')).toBe(
      'https://www.youtube.com/playlist?list=PL123'
    )
  })

  it('leaves YouTube Music alone — its formats differ from the main site', () => {
    expect(normalizeUrl('https://music.youtube.com/watch?v=abc123')).toBe(
      'https://music.youtube.com/watch?v=abc123'
    )
  })

  it('drops the analytics TikTok staples onto every share link', () => {
    expect(
      normalizeUrl('https://www.tiktok.com/@user/video/7123?is_from_webapp=1&sender_device=pc')
    ).toBe('https://www.tiktok.com/@user/video/7123')
    expect(normalizeUrl('https://m.tiktok.com/@user/video/7123')).toBe(
      'https://www.tiktok.com/@user/video/7123'
    )
    // Short share hosts redirect; rewriting the host would break the redirect.
    expect(normalizeUrl('https://vm.tiktok.com/ZMabc/')).toBe('https://vm.tiktok.com/ZMabc')
  })

  it('canonicalises Instagram reels and mobile hosts', () => {
    expect(normalizeUrl('https://instagram.com/reels/Cabc123/?igshid=1')).toBe(
      'https://www.instagram.com/reel/Cabc123'
    )
  })

  it('normalises the mobile host of ordinary sites', () => {
    expect(normalizeUrl('https://m.twitch.tv/videos/123')).toBe('https://www.twitch.tv/videos/123')
    expect(normalizeUrl('https://mobile.twitter.com/user/status/123')).toBe(
      'https://www.twitter.com/user/status/123'
    )
  })

  it('removes tracking parameters so the same video dedupes', () => {
    expect(normalizeUrl('https://vimeo.com/123?utm_source=x&fbclid=y')).toBe(
      'https://vimeo.com/123'
    )
    expect(normalizeUrl('https://vimeo.com/123?h=secret')).toBe('https://vimeo.com/123?h=secret')
  })

  it('drops an anchor but keeps a hash route', () => {
    expect(normalizeUrl('https://vimeo.com/123#comments')).toBe('https://vimeo.com/123')
    expect(normalizeUrl('https://www.youtube.com/watch?v=abc123#t=90')).toBe(
      'https://www.youtube.com/watch?v=abc123'
    )
    // Single-page sites route on the fragment; there it *is* the address.
    expect(normalizeUrl('https://site.test/#/watch/123')).toBe('https://site.test/#/watch/123')
    expect(normalizeUrl('https://site.test/#!/video/9')).toBe('https://site.test/#!/video/9')
  })

  it('is idempotent', () => {
    for (const url of [
      'https://youtu.be/dQw4w9WgXcQ?si=xyz',
      'https://www.tiktok.com/@user/video/7123?is_from_webapp=1',
      'https://site.test/#/watch/123',
      'https://instagram.com/reels/Cabc123/'
    ]) {
      const once = normalizeUrl(url)
      expect(normalizeUrl(once), url).toBe(once)
    }
  })
})

describe('looksLikeCollection', () => {
  it('expands playlist, channel and set pages', () => {
    expect(looksLikeCollection('https://www.youtube.com/playlist?list=PL123')).toBe(true)
    expect(looksLikeCollection('https://www.youtube.com/@somechannel')).toBe(true)
    expect(looksLikeCollection('https://www.youtube.com/channel/UC123')).toBe(true)
    expect(looksLikeCollection('https://www.youtube.com/@somechannel/videos')).toBe(true)
    expect(looksLikeCollection('https://soundcloud.com/artist/sets/an-album')).toBe(true)
    expect(looksLikeCollection('https://www.tiktok.com/@someone')).toBe(true)
  })

  it('leaves a single video alone even when it sits inside a playlist', () => {
    // Pasting a video link must download that video, not the whole playlist.
    expect(looksLikeCollection('https://www.youtube.com/watch?v=abc123&list=PL123')).toBe(false)
    expect(looksLikeCollection('https://www.youtube.com/watch?v=abc123')).toBe(false)
  })

  it('treats short-form video links as single videos', () => {
    expect(looksLikeCollection('https://www.youtube.com/shorts/abc123')).toBe(false)
    expect(looksLikeCollection('https://www.tiktok.com/@someone/video/7123')).toBe(false)
    expect(looksLikeCollection('https://www.instagram.com/reel/Cabc123')).toBe(false)
    expect(looksLikeCollection('https://www.twitch.tv/videos/123')).toBe(false)
  })

  it('leaves ordinary pages alone', () => {
    expect(looksLikeCollection('https://vimeo.com/123456')).toBe(false)
    expect(looksLikeCollection('https://example.com/some/article')).toBe(false)
    // `/c/` used to match anywhere in the path, which caught plain article URLs.
    expect(looksLikeCollection('https://example.com/c/news/story-42')).toBe(false)
  })
})

describe('needsCookiesOften', () => {
  it('knows the sites where a login gate is the usual reason for failure', () => {
    expect(needsCookiesOften('https://www.instagram.com/reel/Cabc123')).toBe(true)
    expect(needsCookiesOften('https://www.facebook.com/watch/?v=1')).toBe(true)
    expect(needsCookiesOften('https://www.youtube.com/watch?v=abc123')).toBe(false)
  })
})
