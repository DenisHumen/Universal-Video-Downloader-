import { describe, expect, it } from 'vitest'
import {
  cliArgvFrom,
  describeFailure,
  displayName,
  downloadChoice,
  engineSetupFailure,
  EXIT_NOT_DETECTED,
  formatBytes,
  formatEta,
  outputLanguage,
  parseCliArgs,
  parseProgress,
  parseQuality,
  ffmpegProgressLine,
  postprocessLine,
  progressLine,
  usage
} from './format'

describe('cliArgvFrom', () => {
  it('is null for an ordinary launch', () => {
    expect(cliArgvFrom(['/opt/uvd/universal-video-downloader'])).toBeNull()
    expect(cliArgvFrom(['app', 'https://example.com/v'])).toBeNull()
  })

  it('takes everything after --cli, wherever Electron put it', () => {
    expect(cliArgvFrom(['/opt/uvd/app', '--cli', 'https://a.example/v', '-a'])).toEqual(['https://a.example/v', '-a'])
    // Development: electron.exe, the entry script, then the switch.
    expect(cliArgvFrom(['electron', '.', '--cli', '--help'])).toEqual(['--help'])
  })
})

/*
  The terminal took the best video whatever the app's settings said, so somebody
  who had set 1080p or sound only got something else from `uvd` than from the
  window. The help now says what happens, and this keeps the two agreeing.
*/
describe('downloadChoice', () => {
  const app = { defaultMode: 'video', defaultQuality: '1080' } as const

  it("follows the app's default mode and quality with no flags", () => {
    expect(downloadChoice({ audio: false }, app)).toEqual({ mode: 'video', quality: '1080' })
    expect(downloadChoice({ audio: false }, { defaultMode: 'video', defaultQuality: 'best' })).toEqual({
      mode: 'video',
      quality: 'best'
    })
    expect(downloadChoice({ audio: false }, { defaultMode: 'audio', defaultQuality: '1080' })).toEqual({
      mode: 'audio',
      quality: 'audio'
    })
  })

  it('reads a default quality of audio, with the mode on video, as the best video', () => {
    expect(downloadChoice({ audio: false }, { defaultMode: 'video', defaultQuality: 'audio' })).toEqual({
      mode: 'video',
      quality: 'best'
    })
  })

  it('lets either flag overrule the settings', () => {
    expect(downloadChoice({ audio: false, quality: '720' }, app)).toEqual({ mode: 'video', quality: '720' })
    expect(downloadChoice({ audio: true }, app)).toEqual({ mode: 'audio', quality: 'audio' })
    expect(downloadChoice({ audio: false, quality: 'best' }, { defaultMode: 'audio', defaultQuality: 'audio' })).toEqual({
      mode: 'video',
      quality: 'best'
    })
  })

  it('is what the help says', () => {
    expect(usage()).toMatch(/default mode and quality from the app's settings/)
    expect(usage()).toMatch(/override the settings/)
  })
})

describe('parseCliArgs', () => {
  it('reads links and options', () => {
    expect(parseCliArgs(['https://a.example/v', '-o', '/tmp/x', '--audio', 'https://b.example/w'])).toEqual({
      links: ['https://a.example/v', 'https://b.example/w'],
      output: '/tmp/x',
      audio: true,
      help: false,
      version: false
    })
    expect(parseCliArgs(['--output=/srv/videos', 'https://a.example/v']).output).toBe('/srv/videos')
  })

  it('takes a quality in any of the ways it is written', () => {
    expect(parseCliArgs(['https://a.example/v']).quality).toBeUndefined()
    expect(parseCliArgs(['-q', '720', 'https://a.example/v']).quality).toBe('720')
    expect(parseCliArgs(['https://a.example/v', '--quality', '1080p']).quality).toBe('1080')
    expect(parseCliArgs(['--quality=4K', 'https://a.example/v']).quality).toBe('2160')
    const shouted = parseCliArgs(['-q', 'BEST', 'https://a.example/v'])
    expect(shouted.quality).toBe('best')
    expect(shouted.error).toBeUndefined()
  })

  it('refuses a quality off the ladder, or none at all, and says what it takes', () => {
    expect(parseCliArgs(['-q', '72', 'https://a.example/v']).error).toBe(
      '-q takes best, 2160, 1440, 1080, 720, 480 or 360, not "72".'
    )
    expect(parseCliArgs(['--quality=hd', 'https://a.example/v']).error).toMatch(/takes best, 2160/)
    expect(parseCliArgs(['https://a.example/v', '-q']).error).toMatch(/-q needs a quality after it: best, 2160/)
    expect(parseCliArgs(['--quality=', 'https://a.example/v']).error).toMatch(/needs a quality/)
  })

  it('will not guess between a video height and audio only', () => {
    expect(parseCliArgs(['-a', '-q', '720', 'https://a.example/v']).error).toMatch(/does nothing with --audio/)
    expect(parseCliArgs(['-q', 'best', '--audio', 'https://a.example/v']).error).toMatch(/does nothing with --audio/)
    expect(parseCliArgs(['-a', 'https://a.example/v']).error).toBeUndefined()
  })

  it('wants a link unless asked for help or the version', () => {
    expect(parseCliArgs([]).error).toMatch(/link/)
    expect(parseCliArgs(['--help']).error).toBeUndefined()
    expect(parseCliArgs(['-v']).error).toBeUndefined()
  })

  it('refuses an unknown option and an -o with nothing after it', () => {
    expect(parseCliArgs(['--best', 'https://a.example/v']).error).toBe('Unknown option: --best')
    expect(parseCliArgs(['https://a.example/v', '-o']).error).toMatch(/needs a folder/)
  })

  it('takes everything after -- as a link, dash or not', () => {
    expect(parseCliArgs(['--', '-weird-id', 'https://a.example/v']).links).toEqual(['-weird-id', 'https://a.example/v'])
  })
})

describe('parseQuality', () => {
  it('reads every rung of the ladder the app offers', () => {
    for (const q of ['best', '2160', '1440', '1080', '720', '480', '360']) expect(parseQuality(q)).toBe(q)
  })

  it('refuses heights the app does not offer and words it does not know', () => {
    for (const q of ['', '72', '1000', '8k', '720pp', 'p', 'worst', '-1']) expect(parseQuality(q)).toBeNull()
  })

  it('is listed in the help', () => {
    expect(usage()).toMatch(/-q, --quality <best\|2160\|1440\|1080\|720\|480\|360>/)
  })
})

describe('progress', () => {
  it('reads the engine progress template, falling back to the estimate', () => {
    expect(parseProgress('downloading\t1000\tNA\t4000\t500\t6\tNA\tNA')).toEqual({
      status: 'downloading',
      downloaded: 1000,
      total: 4000,
      speed: 500,
      eta: 6
    })
  })

  it('draws a bar with sizes, speed and time left', () => {
    const line = progressLine({ status: 'downloading', downloaded: 120_400_000, total: 286_000_000, speed: 8_100_000, eta: 21 }, 10)
    expect(line).toBe('   42% ━━━━──────  120 MB of 286 MB · 8.1 MB/s · 0:21 left')
  })

  it('says how much arrived when the size is unknown', () => {
    expect(progressLine({ status: 'downloading', downloaded: 5_300_000, speed: 1_000_000 })).toBe(
      '  downloading  5.3 MB · 1.0 MB/s'
    )
  })

  it('formats sizes and times', () => {
    expect(formatBytes(999)).toBe('999 B')
    expect(formatBytes(1_234_567_890)).toBe('1.2 GB')
    expect(formatEta(59)).toBe('0:59')
    expect(formatEta(3725)).toBe('1:02:05')
  })

  it('says how much of the video ffmpeg has, when it is the one fetching', () => {
    expect(ffmpegProgressLine(754)).toBe('  downloading with ffmpeg  12:34 of the video so far')
    expect(ffmpegProgressLine(3725)).toMatch(/1:02:05 of the video/)
  })

  it('names the post-processing step', () => {
    expect(postprocessLine('Merger')).toMatch(/merging video and audio/)
    expect(postprocessLine('EmbedThumbnail')).toMatch(/thumbnail/)
    expect(postprocessLine(undefined)).toMatch(/finishing up/)
  })

  it('shows the name the file ends up with, not a stream about to be merged', () => {
    expect(displayName('/home/me/Downloads/Me at the zoo [jNQXAC9IVRw].f133.mp4')).toBe('Me at the zoo [jNQXAC9IVRw].mp4')
    expect(displayName('C:\\Users\\me\\Downloads\\clip.webm')).toBe('clip.webm')
  })
})

describe('describeFailure', () => {
  it('sends a link the engine cannot read to the app, with its own exit code', () => {
    for (const code of [undefined, 'noFormats', 'emptyPage', 'unsupportedPlayer', 'forbidden'] as const) {
      const failure = describeFailure(code, 'Could not find a downloadable video at this link.', false)
      expect(failure.exitCode).toBe(EXIT_NOT_DETECTED)
      expect(failure.lines.join(' ')).toMatch(/Open Universal Video Downloader and try it there/)
    }
  })

  it('says what went wrong when the app could not do better', () => {
    const failure = describeFailure('geo', 'This video is not available in your region.', false)
    expect(failure).toEqual({ exitCode: 1, lines: ['✗ This video is not available in your region.'] })
  })

  it('points at cookies for an access gate', () => {
    const failure = describeFailure('signIn', 'This video requires you to be signed in.', true)
    expect(failure.lines[1]).toMatch(/browser cookies/)
  })
})

/*
  Scripts grep what this prints, so English has to stay word for word what it
  was, and a script on a machine set to Russian has to get that English too.
*/
describe('the language it prints in', () => {
  it('is the app’s on a terminal, English into a pipe, and the app’s for help anywhere', () => {
    expect(outputLanguage('ru', true, false)).toBe('ru')
    expect(outputLanguage('ru', false, false)).toBe('en')
    expect(outputLanguage('ru', false, true)).toBe('ru')
    expect(outputLanguage('en', true, false)).toBe('en')
  })

  it('leaves the English help as it was', () => {
    expect(usage()).toBe(
      [
        'Usage: uvd <link> [<link> ...] [options]',
        '',
        "Downloads each link with the default mode and quality from the app's settings",
        '(the best quality, until you change them), into your Downloads folder or the',
        'folder chosen there. The flags below override the settings for this run.',
        '',
        'Options:',
        '  -q, --quality <best|2160|1440|1080|720|480|360>',
        '                         take a video of at most this height (1080p and 4K',
        '                         work too); a site without it gives the best it has',
        '  -o, --output <folder>  save into this folder instead',
        '  -a, --audio            save the audio only',
        '  -V, --version          print the version',
        '  -h, --help             print this help',
        '',
        'If a link does not work here, open Universal Video Downloader and try it',
        'there: the app can also read the page itself and catch the stream in its',
        'built-in browser.'
      ].join('\n')
    )
  })

  it('leaves the English hint to try the app as it was', () => {
    expect(describeFailure('noFormats', 'x', false).lines).toEqual([
      "✗ Couldn't find a video to download at this link.",
      '  Open Universal Video Downloader and try it there: the app can also read',
      '  the page itself and catch the stream in its built-in browser.'
    ])
  })

  it('says the help in Russian, with the flags as they are typed', () => {
    const text = usage('ru')
    expect(text).toMatch(/uvd <ссылка>/)
    expect(text).toContain('-q, --quality <best|2160|1440|1080|720|480|360>')
    expect(text).not.toMatch(/\{\w+\}/)
    expect(text).not.toMatch(/движ|поток/i)
  })

  it('refuses a command line in Russian', () => {
    expect(parseCliArgs(['-q', '72', 'https://a.example/v'], 'ru').error).toBe(
      '-q принимает best, 2160, 1440, 1080, 720, 480 или 360, а не «72».'
    )
    expect(parseCliArgs([], 'ru').error).toMatch(/ссылку/)
    expect(parseCliArgs(['--best', 'x'], 'ru').error).toBe('Неизвестный параметр: --best')
  })

  it('draws progress in Russian, with a comma and Russian units', () => {
    const line = progressLine({ status: 'downloading', downloaded: 5_300_000, total: 8_100_000, speed: 1_000_000, eta: 21 }, 10, 'ru')
    expect(line).toContain('5,3 МБ из 8,1 МБ')
    expect(line).toContain('1,0 МБ/с')
    expect(line).toContain('осталось 0:21')
    expect(ffmpegProgressLine(754, 'ru')).toContain('12:34')
    expect(postprocessLine('Merger', 'ru')).toMatch(/соединяю/)
  })

  it('keeps the exit codes whatever the language', () => {
    for (const code of ['noFormats', 'geo', undefined] as const) {
      expect(describeFailure(code, 'Something.', false, 'ru').exitCode).toBe(describeFailure(code, 'Something.', false).exitCode)
    }
  })

  it('gives the interface’s sentence for a code in Russian, and the engine’s in English', () => {
    expect(describeFailure('geo', 'This video is not available in your region.', false, 'ru').lines[0]).toMatch(/^✗ [^A-Za-z]+/)
    expect(describeFailure(undefined, 'HTTP 503', false, 'ru').lines[0]).toMatch(/сервер/i)
    expect(describeFailure(undefined, 'HTTP 503', false, 'ru').lines[1]).toMatch(/Откройте Universal Video Downloader/)
    expect(describeFailure(undefined, 'HTTP 503', false).lines[0]).toBe('✗ HTTP 503')
    expect(describeFailure('signIn', 'x', true, 'ru').lines[1]).toMatch(/Настройки → Доступ/)
  })
})

describe('engineSetupFailure', () => {
  it('sends an engine that will not start to antivirus, not to the connection', () => {
    const said = 'The download engine was installed but failed to start on this system.'
    for (const language of ['en', 'ru'] as const) {
      const lines = engineSetupFailure(said, language)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatch(/antivirus|антивирус/)
    }
  })

  it('keeps the connection advice, and the reason, for anything else', () => {
    expect(engineSetupFailure('HTTP 503')).toEqual([
      '✗ Could not set up the download engine: HTTP 503',
      '  Check the connection, or open Universal Video Downloader once and let it finish setting up.'
    ])
    expect(engineSetupFailure('HTTP 503', 'ru')[1]).toMatch(/Проверьте интернет/)
  })
})
