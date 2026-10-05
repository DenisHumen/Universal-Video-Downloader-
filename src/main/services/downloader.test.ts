import { describe, expect, it } from 'vitest'
import { join } from 'path'
import type { AppSettings, DownloadItem } from '@shared/types'
import { buildArgs, pickFinishedFile, safeName, siteFolder } from './downloader'
import { sniffUrlFor } from '../resolvers/universal'
import { directUrlFor } from '../resolvers/universal/direct'

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

  const output = (args: string[]): string => args[args.indexOf('-o') + 1]

  it('names a trimmed download after its section, so the full video is not "already downloaded"', () => {
    // Same template for clip and full video: the engine handed back the clip, exit 0.
    const clip = item({ range: { start: 5, end: 9 } })
    expect(output(buildArgs(clip, settings(), '/downloads'))).toBe(
      join('/downloads', '%(title)s [%(id)s] [0m05s-0m09s].%(ext)s')
    )
    expect(output(buildArgs(item({ range: { start: 5 } }), settings(), '/downloads'))).toBe(
      join('/downloads', '%(title)s [%(id)s] [0m05s-end].%(ext)s')
    )
  })

  it('puts a copy number after the section, just before the extension', () => {
    const copy = item({ range: { start: 5 }, copySuffix: ' (2)' })
    const nested = settings({ filenameTemplate: '%(uploader)s/%(title)s.%(ext)s' })
    expect(output(buildArgs(copy, nested, '/d'))).toBe(
      join('/d', '%(uploader)s/%(title)s [0m05s-end] (2).%(ext)s')
    )
  })

  const scraped = { referer: 'https://site.test/', title: 'Episode 1' }

  it('gives a trimmed custom-resolved stream its section too', () => {
    const clip = item({ ...scraped, range: { start: 65, end: 125 } })
    expect(output(buildArgs(clip, settings(), '/downloads'))).toBe(
      join('/downloads', 'Episode 1 [1m05s-2m05s].%(ext)s')
    )
  })

  it('keeps the name a custom-resolved stream settled on', () => {
    // A resume has to write into the partial the first run started.
    const resumed = item({ ...scraped, outputStem: 'Episode 1 (2)' })
    expect(output(buildArgs(resumed, settings(), '/downloads'))).toBe(
      join('/downloads', 'Episode 1 (2).%(ext)s')
    )
  })
})

describe('siteFolder', () => {
  it('files a sniffed page under its site, not "Universal"', () => {
    // Every universally detected site shared one folder named after the fallback.
    const sourceUrl = sniffUrlFor('https://www.ok.ru/video/1')
    expect(siteFolder({ url: 'https://cdn.test/x.m3u8', sourceUrl, extractor: 'Universal' })).toBe('ok.ru')
  })

  it('files a stream picked in the built-in browser under the page it came from', () => {
    const picked = directUrlFor({ url: 'https://cdn.test/a.mp4', pageUrl: 'https://kino.example/w/7' })
    expect(siteFolder({ url: picked, sourceUrl: picked })).toBe('kino.example')
    const noPage = directUrlFor({ url: 'https://cdn.test/a.mp4', referer: 'https://www.tube.example/' })
    expect(siteFolder({ url: noPage, sourceUrl: noPage })).toBe('tube.example')
  })

  it("files the engine's generic extractor under the host", () => {
    const generic = { url: 'https://videos.example.org/a.mp4', extractor: 'Generic' }
    expect(siteFolder(generic)).toBe('videos.example.org')
  })

  it('keeps a real extractor name', () => {
    const native = { url: 'https://www.youtube.com/watch?v=abc', extractor: 'Youtube' }
    expect(siteFolder(native)).toBe('Youtube')
  })

  it('falls back to nothing, and so to "other", for a link it cannot read', () => {
    expect(siteFolder({ url: 'not a url', extractor: 'generic' })).toBe('')
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
