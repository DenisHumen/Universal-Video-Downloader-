import { describe, expect, it } from 'vitest'
import type { AppSettings } from '@shared/types'
import { accessArgs, hasCookies, headerArgs, humanizeYtdlpError, isTransientError } from './options'

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    downloadDir: '/tmp',
    concurrentDownloads: 3,
    defaultMode: 'video',
    defaultQuality: 'best',
    audioFormat: 'mp3',
    embedThumbnail: true,
    embedSubtitles: false,
    embedMetadata: true,
    embedChapters: true,
    writeSubtitles: false,
    subtitleLanguages: 'en',
    sponsorBlock: false,
    restrictFilenames: false,
    filenameTemplate: '%(title)s.%(ext)s',
    createSubfolders: false,
    speedLimit: '',
    playlistLimit: 500,
    autoUpdate: true,
    resumeOnLaunch: true,
    theme: 'night',
    language: 'auto',
    notifications: true,
    clipboardWatch: false,
    trayEnabled: false,
    universalFallback: true,
    proxy: '',
    cookiesFromBrowser: '',
    cookiesFile: '',
    ...overrides
  }
}

describe('accessArgs', () => {
  it('is empty when nothing is configured', () => {
    expect(accessArgs(settings())).toEqual([])
  })

  it('passes the proxy through', () => {
    expect(accessArgs(settings({ proxy: 'http://p:8080' }))).toEqual(['--proxy', 'http://p:8080'])
  })

  it('prefers an explicit cookies file over the browser', () => {
    const args = accessArgs(settings({ cookiesFile: '/c.txt', cookiesFromBrowser: 'chrome' }))
    expect(args).toEqual(['--cookies', '/c.txt'])
  })

  it('falls back to the browser when no file is set', () => {
    expect(accessArgs(settings({ cookiesFromBrowser: 'firefox' }))).toEqual([
      '--cookies-from-browser',
      'firefox'
    ])
  })
})

describe('hasCookies', () => {
  it('is true for either source', () => {
    expect(hasCookies(settings())).toBe(false)
    expect(hasCookies(settings({ cookiesFile: '/c.txt' }))).toBe(true)
    expect(hasCookies(settings({ cookiesFromBrowser: 'edge' }))).toBe(true)
  })
})

describe('headerArgs', () => {
  it('returns nothing without headers', () => {
    expect(headerArgs()).toEqual([])
    expect(headerArgs({})).toEqual([])
  })

  it('emits one --add-header per entry', () => {
    expect(headerArgs({ Cookie: 'a=1', Origin: 'https://site.test' })).toEqual([
      '--add-header',
      'Cookie:a=1',
      '--add-header',
      'Origin:https://site.test'
    ])
  })

  it('skips headers the engine manages itself', () => {
    // Referer has a dedicated flag; the rest would break range requests.
    expect(headerArgs({ Referer: 'https://site.test/', Range: 'bytes=0-' })).toEqual([])
  })

  it('skips empty values', () => {
    expect(headerArgs({ Cookie: '' })).toEqual([])
  })
})

describe('humanizeYtdlpError', () => {
  it('suggests cookies when they are off and the site gates access', () => {
    const message = humanizeYtdlpError('ERROR: Sign in to confirm your age', false)
    expect(message).toMatch(/age-restricted/i)
    expect(message).toMatch(/cookies/i)
  })

  it('does not nag about cookies when they are already on', () => {
    const message = humanizeYtdlpError('ERROR: Sign in to confirm your age', true)
    expect(message).not.toMatch(/cookies/i)
  })

  it('explains rate limiting', () => {
    expect(humanizeYtdlpError('HTTP Error 429: Too Many Requests', true)).toMatch(/rate-limit/i)
  })

  it('explains DRM', () => {
    expect(humanizeYtdlpError('This video is DRM protected', true)).toMatch(/DRM/i)
  })

  it('explains a full disk', () => {
    expect(humanizeYtdlpError('OSError: [Errno 28] No space left on device', true)).toMatch(/disk/i)
  })

  it('falls back to the last line with the ERROR prefix stripped', () => {
    expect(humanizeYtdlpError('warning: something\nERROR: totally novel failure', true)).toBe(
      'totally novel failure'
    )
  })
})

describe('isTransientError', () => {
  it('retries network blips', () => {
    expect(isTransientError('Connection reset by peer')).toBe(true)
    expect(isTransientError('HTTP Error 503: Service Unavailable')).toBe(true)
    expect(isTransientError('Read timed out')).toBe(true)
  })

  it('never retries a permanent refusal', () => {
    expect(isTransientError('This video is DRM protected')).toBe(false)
    expect(isTransientError('Video has been removed')).toBe(false)
    expect(isTransientError('No space left on device')).toBe(false)
    expect(isTransientError('Unsupported URL: https://example.com')).toBe(false)
  })
})
