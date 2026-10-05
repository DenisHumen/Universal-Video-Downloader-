import { describe, expect, it } from 'vitest'
import { classifyYtdlpError } from '../../services/options'
import { resolveUrl } from '../index'
import { VIMEO_VIDEO, vimeoPlayerUrl } from './vimeo'

/*
  The engine reads vimeo.com pages through Vimeo's web client, which now turns
  away anyone not logged in — public videos included. Every vimeo.com/<id> link
  failed as "the web client only works when logged-in", shown to the user as a
  video that needed them to sign in. player.vimeo.com/video/<id> serves the same
  video anonymously, so that is where a video link is sent.
*/
describe('vimeoPlayerUrl', () => {
  it('sends a plain video link to the player', () => {
    const player = 'https://player.vimeo.com/video/76979871'
    expect(vimeoPlayerUrl('https://vimeo.com/76979871')).toBe(player)
    expect(vimeoPlayerUrl('https://www.vimeo.com/76979871/')).toBe(player)
  })

  it('carries an unlisted video’s hash from the path', () => {
    expect(vimeoPlayerUrl('https://vimeo.com/123456789/abcdef1234')).toBe(
      'https://player.vimeo.com/video/123456789?h=abcdef1234'
    )
  })

  it('carries a hash that came as ?h=', () => {
    expect(vimeoPlayerUrl('https://vimeo.com/123456789?h=abcdef1234')).toBe(
      'https://player.vimeo.com/video/123456789?h=abcdef1234'
    )
  })

  it('drops what the share button adds', () => {
    expect(vimeoPlayerUrl('https://vimeo.com/1228694119?share=copy')).toBe(
      'https://player.vimeo.com/video/1228694119'
    )
    expect(vimeoPlayerUrl('https://vimeo.com/123456789?share=copy&h=abcdef1234')).toBe(
      'https://player.vimeo.com/video/123456789?h=abcdef1234'
    )
  })

  it('leaves showcases, channels, groups, users and the player alone', () => {
    for (const url of [
      'https://vimeo.com/showcase/1234567',
      'https://vimeo.com/channels/staffpicks/76979871',
      'https://vimeo.com/groups/motion/videos/76979871',
      'https://vimeo.com/user12345678',
      'https://vimeo.com/staff',
      'https://vimeo.com/ondemand/somefilm',
      'https://vimeo.com/76979871/videos/likes',
      'https://player.vimeo.com/video/76979871'
    ]) {
      expect(VIMEO_VIDEO.test(url), url).toBe(false)
      expect(vimeoPlayerUrl(url), url).toBeUndefined()
    }
  })
})

describe('resolveUrl on a Vimeo link', () => {
  it('hands the engine the player, with Vimeo as the referer', async () => {
    const resolved = await resolveUrl('https://vimeo.com/76979871')
    expect(resolved.url).toBe('https://player.vimeo.com/video/76979871')
    expect(resolved.referer).toBe('https://vimeo.com/')
    // The engine's own name for the site, so the label does not change.
    expect(resolved.extractor).toBe('Vimeo')
  })

  it('keeps the hash of a link pasted with tracking on it', async () => {
    const resolved = await resolveUrl('https://vimeo.com/123456789?h=abcdef1234&utm_source=x')
    expect(resolved.url).toBe('https://player.vimeo.com/video/123456789?h=abcdef1234')
  })
})

/*
  Some public videos serve only DRM-protected streams through the player. That
  should read as DRM, not as a generic failure or another sign-in prompt.
  The line is what the engine printed for 76979871.
*/
describe('a DRM-protected Vimeo stream', () => {
  it('is reported as DRM', () => {
    const line =
      'ERROR: This format is DRM protected; Try selecting another format with --format or add ' +
      '--check-formats to automatically fallback to the next best format'
    expect(classifyYtdlpError(line, false).code).toBe('drm')
  })
})
