import { describe, expect, it } from 'vitest'
import {
  cliArgvFrom,
  describeFailure,
  displayName,
  EXIT_NOT_DETECTED,
  formatBytes,
  formatEta,
  parseCliArgs,
  parseProgress,
  postprocessLine,
  progressLine
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
