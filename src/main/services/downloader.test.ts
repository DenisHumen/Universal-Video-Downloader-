import { describe, expect, it } from 'vitest'
import { join } from 'path'
import type { AppSettings, DownloadItem } from '@shared/types'
import { buildArgs, pickFinishedFile, safeName } from './downloader'

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
    filenameTemplate: '%(title)s [%(id)s].%(ext)s',
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

function item(overrides: Partial<DownloadItem> = {}): DownloadItem {
  return {
    id: 'id-1',
    url: 'https://www.youtube.com/watch?v=abc123',
    title: 'A video',
    mode: 'video',
    state: 'downloading',
    percent: 0,
    outputDir: '/downloads',
    createdAt: 0,
    ...overrides
  }
}

describe('buildArgs', () => {
  it('asks the engine for UTF-8 output', () => {
    // Left to itself yt-dlp.exe writes in the ANSI code page, and every path
    // parsed out of that - Cyrillic titles, a Cyrillic Downloads folder, even
    // "Part 1: Intro" - pointed at a file that did not exist.
    const args = buildArgs(item(), settings(), '/downloads')
    const at = args.indexOf('--encoding')
    expect(at).toBeGreaterThan(-1)
    expect(args[at + 1]).toBe('utf-8')
  })

  it('puts the URL last, behind --', () => {
    // Without `--`, a queued "URL" of `--version` ran as an option and the
    // download "completed".
    for (const url of ['https://www.youtube.com/watch?v=abc123', '--exec=calc', '-o']) {
      const args = buildArgs(item({ url }), settings(), '/downloads')
      expect(args[args.length - 1]).toBe(url)
      expect(args[args.length - 2]).toBe('--')
      expect(args.indexOf('--')).toBe(args.length - 2)
    }
  })

  it('keeps the URL last when a trim adds its own flags', () => {
    const args = buildArgs(item({ range: { start: 10, end: 20 } }), settings(), '/downloads', '/ffmpeg')
    expect(args.slice(-2)).toEqual(['--', 'https://www.youtube.com/watch?v=abc123'])
    expect(args).toContain('--download-sections')
  })

  it('names a custom-resolved stream after its title, with control characters gone', () => {
    // A NUL in the `-o` argument made `spawn` throw synchronously.
    const args = buildArgs(
      item({ referer: 'https://site.test/', title: 'Episode\u00001: Pilot' }),
      settings(),
      '/downloads'
    )
    const output = args[args.indexOf('-o') + 1]
    expect(output).toBe(join('/downloads', 'Episode 1 Pilot.%(ext)s'))
    expect(args.join(' ')).not.toContain('\u0000')
  })

  it('uses the filename template when the engine names the file', () => {
    const args = buildArgs(item(), settings(), '/downloads')
    expect(args[args.indexOf('-o') + 1]).toBe(join('/downloads', '%(title)s [%(id)s].%(ext)s'))
  })
})

describe('safeName', () => {
  it('strips NUL and every other control character', () => {
    expect(safeName('a\u0000b')).toBe('a b')
    expect(safeName('line one\nline two\ttab\u001f\u007fend')).toBe('line one line two tab end')
  })

  it('still strips what Windows refuses in a file name', () => {
    expect(safeName('Part 1: Intro | Why?')).toBe('Part 1 Intro Why')
    expect(safeName('a/b\\c*d"e<f>g%h')).toBe('a b c d e f g h')
  })

  it('leaves non-Latin titles alone', () => {
    expect(safeName('Серия 1 — пилот')).toBe('Серия 1 — пилот')
  })
})

describe('pickFinishedFile', () => {
  const at = (name: string, mtimeMs = 1): { name: string; mtimeMs: number } => ({ name, mtimeMs })

  it('prefers the video over its subtitles and thumbnail', () => {
    // Sorted alphabetically, `Title.webp` and `Title.ru.srt` both beat
    // `Title.mp4`, and "open" launched a subtitle file.
    expect(pickFinishedFile([at('Title.mp4'), at('Title.ru.srt'), at('Title.webp')], 'Title')).toBe(
      'Title.mp4'
    )
  })

  it('ignores partials, per-format pieces and temp files', () => {
    const folder = [
      at('Title.mp4.part', 9),
      at('Title.f137.mp4', 9),
      at('Title.temp.mp4', 9),
      at('Title.mp4.ytdl', 9),
      at('Title.mkv', 1)
    ]
    expect(pickFinishedFile(folder, 'Title')).toBe('Title.mkv')
  })

  it('takes the newest when an earlier attempt left another container behind', () => {
    expect(pickFinishedFile([at('Title.webm', 100), at('Title.mp4', 200)], 'Title')).toBe('Title.mp4')
    expect(pickFinishedFile([at('Title.webm', 300), at('Title.mp4', 200)], 'Title')).toBe('Title.webm')
  })

  it('does not mistake a longer title for this one', () => {
    expect(pickFinishedFile([at('Title 2.mp4'), at('Titles.mp4')], 'Title')).toBeUndefined()
  })

  it('finds audio extractions and streams kept in their own container', () => {
    expect(pickFinishedFile([at('Song.mp3'), at('Song.jpg')], 'Song')).toBe('Song.mp3')
    expect(pickFinishedFile([at('Live.ts'), at('Live.ts.part')], 'Live')).toBe('Live.ts')
  })
})
