import { describe, expect, it } from 'vitest'
import type { AppSettings } from '@shared/types'
import {
  accessArgs,
  classifyYtdlpError,
  hasCookies,
  headerArgs,
  humanizeYtdlpError,
  isTransientError,
  stalledConnecting
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

  it('drops a header with a NUL in it rather than letting spawn throw on it', () => {
    // A captured value with a NUL made `spawn` throw synchronously, and the row
    // sat on "downloading" with no process behind it until restart.
    expect(headerArgs({ 'X-Token': 'a\u0000b', Origin: 'https://site.test' })).toEqual([
      '--add-header',
      'Origin:https://site.test'
    ])
    expect(headerArgs({ 'X-\u0000': 'value' })).toEqual([])
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

  /*
    The whole 4000-character tail used to be scanned for any number from 500
    to 599, so ffmpeg's input summary or the file name decided it: a cut that
    could never work waited twelve seconds and ran twice more before the user
    was told.
  */
  it('is not fooled by a bitrate in the 500s', () => {
    const tail = [
      "Input #0, hls, from 'https://cdn.test/index.m3u8':",
      '  Duration: 00:24:15.53, start: 1.400000, bitrate: 548 kb/s',
      '  Stream #0:0: Video: h264, yuv420p, 1280x720, 30 fps',
      'size=       0kB time=N/A bitrate=N/A speed=N/A',
      'ERROR: Postprocessing: Error opening output files: Invalid argument'
    ].join('\n')
    expect(isTransientError(tail)).toBe(false)
  })

  it('is not fooled by a 500 in the file name', () => {
    const tail = [
      '[download] Destination: C:/Users/x/Downloads/Top 500 goals [abc].mp4',
      '[Merger] Merging formats into "C:/Users/x/Downloads/Top 500 goals [abc].mkv"',
      'ERROR: Postprocessing: Conversion failed!'
    ].join('\n')
    expect(isTransientError(tail)).toBe(false)
  })

  it('reads the reason from ffmpeg when the engine only says ffmpeg failed', () => {
    // A live capture handed to ffmpeg: the transient cause is ffmpeg's line,
    // the engine's own last word is a flat exit code.
    const tail = '[https @ 0x1] Connection reset by peer\nERROR: ffmpeg exited with code 1'
    expect(isTransientError(tail)).toBe(true)
  })

  it('ignores a connection warning the run recovered from', () => {
    const tail = [
      'WARNING: [youtube] Unable to download webpage: Connection reset by peer. Retrying (1/3)...',
      'ERROR: [youtube] abc: Requested format is not available. Use --list-formats for a list of available formats'
    ].join('\n')
    expect(isTransientError(tail)).toBe(false)
  })

  it('still retries a server error and a gateway timeout', () => {
    expect(isTransientError('ERROR: unable to download video data: HTTP Error 502: Bad Gateway')).toBe(true)
    expect(isTransientError('[https @ 0x1] HTTP error 504 Gateway Time-out\nERROR: ffmpeg exited with code 1')).toBe(
      true
    )
  })
})

describe('stalledConnecting', () => {
  /*
    A blocked host left the engine connecting until the probe's 75 s cap, and
    the user was told "timed out, the site may be unsupported" about a site the
    engine never reached.
  */
  it('spots an engine that never got through', () => {
    expect(
      stalledConnecting(
        "[Odnoklassniki] 1234567: Unable to download webpage: ('Connection to ok.ru timed out. (connect timeout=10.0)')"
      )
    ).toBe(true)
    expect(stalledConnecting('Failed to establish a new connection: [WinError 10051]')).toBe(true)
    expect(stalledConnecting("Failed to resolve 'ok.ru' ([Errno 11001] getaddrinfo failed)")).toBe(true)
    expect(stalledConnecting('[Errno -2] Name or service not known')).toBe(true)
  })

  it('does not blame the network for a slow extraction', () => {
    expect(stalledConnecting('')).toBe(false)
    expect(stalledConnecting('[youtube] abc: Downloading webpage\n[youtube] abc: Downloading player')).toBe(false)
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
  The age rule was a bare `age`, and "Unable to download webpage" - how the
  engine opens nearly every network failure - has "age" in it. A refused
  connection, a 403, a 429, a timeout and a DNS failure all told the user the
  video was age-restricted and sent them off to set up cookies. Every line here
  is real engine output.
*/
describe('classifyYtdlpError, when the network is the problem', () => {
  const WEBPAGE = 'ERROR: [generic] Unable to download webpage: '
  const cases: [string, string][] = [
    [WEBPAGE + '<urlopen error [Errno 11001] getaddrinfo failed>', 'network'],
    [
      WEBPAGE +
        "HTTPSConnection(host='accounts.site.test', port=443): Failed to resolve 'accounts.site.test' " +
        "([Errno 11001] getaddrinfo failed) (caused by TransportError(\"HTTPSConnection(host='accounts.site.test', port=443)\"))",
      'network'
    ],
    [WEBPAGE + '[WinError 10054] An existing connection was forcibly closed by the remote host', 'network'],
    [WEBPAGE + 'HTTP Error 403: Forbidden', 'forbidden'],
    [WEBPAGE + 'HTTP Error 429: Too Many Requests', 'rateLimited'],
    [WEBPAGE + 'The read operation timed out', 'timeout'],
    [
      WEBPAGE +
        '[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate (_ssl.c:1006)',
      'network'
    ],
    [
      "ERROR: [Odnoklassniki] 1234567: Unable to download webpage: (<HTTPSConnection(host='ok.ru', port=443) at 0x2466196f170>, " +
        "'Connection to ok.ru timed out. (connect timeout=20.0)') (caused by TransportError(\"(<HTTPSConnection(host='ok.ru', port=443) " +
        "at 0x2466196f170>, 'Connection to ok.ru timed out. (connect timeout=20.0)')\"))",
      'timeout'
    ],
    [
      "ERROR: [dzen.ru] abc: Unable to download webpage: HTTPSConnectionPool(host='dzen.ru', port=443): Max retries exceeded " +
        "with url: /video/watch/abc (Caused by NewConnectionError('Failed to establish a new connection: [WinError 10051] " +
        "A socket operation was attempted to an unreachable network'))",
      'network'
    ],
    [
      'ERROR: [youtube] abc: Unable to download API page: [WinError 10061] No connection could be made because the target machine actively refused it',
      'network'
    ],
    ['ERROR: [generic] Unable to download webpage: [Errno -2] Name or service not known', 'network'],
    ['ERROR: [vk] 123: Unable to extract page data', 'noFormats']
  ]

  it.each(cases)('%s', (line, code) => {
    expect(classifyYtdlpError(line, false).code).toBe(code)
  })

  it('never calls a failed page download age-restricted', () => {
    for (const [line] of cases) {
      const out = classifyYtdlpError(line, false)
      expect(out.code, line).not.toBe('ageRestricted')
      expect(out.message, line).not.toMatch(/age-restricted/i)
    }
  })

  it('does not suggest cookies for a network failure', () => {
    expect(classifyYtdlpError(cases[0][0], false).cookieHint).toBe(false)
  })

  it('still recognises a real age gate', () => {
    for (const line of [
      'ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.',
      'ERROR: [site] 1: This video is age-restricted',
      'ERROR: [site] 1: Age verification is required to watch this video'
    ]) {
      expect(classifyYtdlpError(line, false).code, line).toBe('ageRestricted')
    }
  })
})

/*
  Common YouTube outcomes that no rule knew: they reached a Russian-speaking
  user as untranslated English, or under the wrong code - a terminated account
  read as "sign in" because the line has "account" in it.
*/
describe('classifyYtdlpError, in the words of the engine', () => {
  const cases: [string, string][] = [
    ['ERROR: [youtube] abc: Video unavailable', 'unavailable'],
    ['ERROR: [youtube] aaaaaaaaaaa: This video is unavailable', 'unavailable'],
    [
      'ERROR: [youtube] abc: Video unavailable. This video is no longer available because the YouTube account associated with this video has been terminated.',
      'unavailable'
    ],
    ['ERROR: [youtube] abc: This video is only available for subscribers', 'signIn'],
    [
      'ERROR: [youtube] abc: Join this channel to get access to members-only content like this video, and other exclusive perks.',
      'signIn'
    ],
    ['ERROR: [youtube] abc: Your IP address is blocked from accessing this post', 'geo'],
    [
      'ERROR: [youtube] abc: Requested format is not available. Use --list-formats for a list of available formats',
      'noFormats'
    ],
    ['ERROR: [youtube] abc: The uploader has not made this video available in your country', 'geo'],
    ['ERROR: [youtube] abc: This video is not available from your location due to geo restriction', 'geo'],
    ['ERROR: [youtube] abc: This live event will begin in 5 hours.', 'upcoming'],
    ['ERROR: [youtube] abc: Premieres in 2 hours', 'upcoming']
  ]

  it.each(cases)('%s', (line, code) => {
    expect(classifyYtdlpError(line, false).code).toBe(code)
  })

  it('does not offer cookies for a format that does not exist', () => {
    const out = classifyYtdlpError('ERROR: [youtube] abc: Requested format is not available', false)
    expect(out.cookieHint).toBe(false)
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

/*
  A speed limit of "2MB" stops the engine at its own command line, and the line
  it prints has "rate limit" in it - so the user was told the site was
  rate-limiting them and to wait a minute, over and over, on every download.
  The lines are yt-dlp 2026.03.17's own; a release build puts its file name
  where the source build says "yt-dlp".
*/
describe('classifyYtdlpError, when the engine refuses a setting', () => {
  const USAGE = 'Usage: yt-dlp.exe [OPTIONS] URL [URL...]\r\n\r\n'

  it('blames the setting, not the site', () => {
    const out = classifyYtdlpError('yt-dlp: error: invalid rate limit "2MB" given', false)
    expect(out.code).toBe('badSetting')
    expect(out.message).toMatch(/speed limit/i)
    expect(out.cookieHint).toBe(false)
  })

  it('reads the whole usage block the engine writes', () => {
    const raw = USAGE + 'yt-dlp.exe: error: invalid rate limit "2MB" given\r\n'
    expect(classifyYtdlpError(raw, false).code).toBe('badSetting')
  })

  it('knows the program by any of its release names', () => {
    // The prefix is the binary's own file name, and the app runs it under that name.
    for (const prog of ['yt-dlp', 'yt-dlp.exe', 'yt-dlp_macos', 'yt-dlp_linux_aarch64']) {
      const line = `${prog}: error: rate limit "0" must be positive`
      expect(classifyYtdlpError(line, false).code, prog).toBe('badSetting')
    }
  })

  it('is not led astray by what the refused value says', () => {
    // A template is quoted back in full, and any word in it could match a rule below.
    const line = 'yt-dlp: error: invalid default output template "%(title)s ffmpeg 404 %(": incomplete format key'
    expect(classifyYtdlpError(line, false).code).toBe('badSetting')
  })

  it('still knows a real rate limit when it sees one', () => {
    expect(
      classifyYtdlpError('ERROR: [youtube] abc: HTTP Error 429: Too Many Requests', false).code
    ).toBe('rateLimited')
  })

  it('does not retry it, since every attempt would fail the same way', () => {
    expect(isTransientError(USAGE + 'yt-dlp.exe: error: invalid rate limit "2MB" given')).toBe(false)
  })
})
