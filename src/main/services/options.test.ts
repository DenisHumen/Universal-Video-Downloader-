import { describe, expect, it } from 'vitest'
import type { AppSettings } from '@shared/types'
import {
  accessArgs,
  classifyYtdlpError,
  hasCookies,
  headerArgs,
  humanizeYtdlpError,
  isTransientError
} from './options'

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
    preferCompatible: true,
    automationEnabled: false,
    autostart: false,
    smbTargets: [],
    telegramChatId: '',
    logVerbose: false,
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

describe('classifyYtdlpError', () => {
  /*
    A missing ffmpeg says "ffmpeg not found", and the rule for a removed video
    matched a bare "not found" and came first - so every post-processing failure
    was reported as "this video may have been removed, or blocked in your
    region, try enabling cookies". Wrong diagnosis, wrong remedy, and the file
    had in fact downloaded perfectly.
  */
  it('blames the tool when the tool is what failed', () => {
    const out = classifyYtdlpError(
      'ERROR: Postprocessing: ffmpeg not found. Please install or provide the path',
      false
    )
    expect(out.code).toBe('postprocess')
    expect(out.cookieHint).toBe(false)
    expect(out.message).not.toMatch(/region|removed/i)
  })

  it('still recognises a video that really is gone', () => {
    expect(classifyYtdlpError('ERROR: Video not found on this server', false).code).toBe(
      'unavailable'
    )
    expect(classifyYtdlpError('ERROR: HTTP Error 404: Not Found', false).code).toBe('unavailable')
  })
})

/*
  A trimmed Twitch VOD failed with "post-processing failed - the video
  downloaded but could not be merged". It had not downloaded: ffmpeg wrote
  nothing, yt-dlp called the empty file finished, and the metadata step choked
  on it. The last line blamed the wrong step; the lines above it said so.
*/
describe('classifyYtdlpError, when ffmpeg wrote nothing', () => {
  const log = [
    '[info] v2881778152: Downloading 1 time ranges: 17077.0-inf',
    '[download] Destination: C:/Users/x/Downloads/vod [v2881778152].mp4',
    '[NULL @ 00000199d5e52c40] Invalid NAL unit size (1919161869 > 101).',
    '[NULL @ 00000199d5e52c40] missing picture in access unit with size 105',
    'size=       0kB time=N/A bitrate=N/A speed=N/A    ',
    '[Metadata] Adding metadata to "C:/Users/x/Downloads/vod [v2881778152].mp4"',
    'ERROR: Postprocessing: Error opening output files: Invalid argument'
  ].join('\n')

  it('says nothing was recorded, not that it downloaded and failed to merge', () => {
    const out = classifyYtdlpError(log, false)
    expect(out.code).toBe('cutFailed')
    expect(out.message).not.toMatch(/downloaded but/i)
  })

  it('recognises the summary line newer ffmpeg prints instead', () => {
    const summary =
      '[out#0/mp4 @ 0000017533aef140] video:0kB audio:0kB subtitle:0kB other streams:0kB global headers:0kB muxing overhead: unknown\n' +
      'ERROR: Postprocessing: Error opening output files: Invalid argument'
    expect(classifyYtdlpError(summary, false).code).toBe('cutFailed')
  })

  it('leaves a real post-processing failure where it was', () => {
    const real =
      'size=   20480kB time=00:01:05.00 bitrate=2580.1kbits/s speed=12x\n' +
      'ERROR: Postprocessing: Conversion failed!'
    expect(classifyYtdlpError(real, false).code).toBe('postprocess')
  })
})
