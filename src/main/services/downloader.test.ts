import { describe, expect, it } from 'vitest'
import { join } from 'path'
import type { AppSettings, DownloadItem } from '@shared/types'
import { buildArgs, outputTarget, pickFinishedFile, safeName, siteFolder, titleFromFile } from './downloader'
import { pageUrlOf } from '@shared/page-url'
import { sniffUrlFor } from '../resolvers/universal'
import { directUrlFor } from '../resolvers/universal/direct'

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    downloadDir: '/tmp',
    errorReports: 'ask',
    setupDone: true,
    playlistNumbering: true,
    playlistFolder: true,
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
    keepFinished: 0,
    theme: 'night',
    accent: 'blue',
    language: 'auto',
    notifications: true,
    clipboardWatch: false,
    trayEnabled: false,
    universalFallback: true,
    showAdultServices: false,
    autoDownload: false,
    autoDownloadOff: [],
    preferCompatible: true,
    automationEnabled: false,
    autostart: false,
    smbTargets: [],
    telegramChatId: '',
    logVerbose: false,
    proxy: '',
    cookiesFromBrowser: '',
    cookiesFile: '',
    browserStaySignedIn: true,
    browserSavePasswords: true,
    ...overrides
  }
}

describe('pageUrlOf: the links the resolvers really make', () => {
  it('reads them back, with characters outside ASCII intact', () => {
    expect(pageUrlOf(sniffUrlFor('https://media.example/фильм?a=1'))).toBe('https://media.example/фильм?a=1')
    expect(pageUrlOf(directUrlFor({ url: 'https://cdn.example/a.m3u8', pageUrl: 'https://media.example/страница' }))).toBe(
      'https://media.example/страница'
    )
    expect(pageUrlOf(directUrlFor({ url: 'https://cdn.example/a.m3u8', referer: 'https://media.example/r' }))).toBe(
      'https://media.example/r'
    )
  })

  it('has nothing to say about a link that does not read, and leaves an ordinary one alone', () => {
    expect(pageUrlOf('uvd-direct://abc')).toBe('')
    expect(pageUrlOf('https://media.example/a')).toBe('https://media.example/a')
  })
})

describe('buildArgs: waiting for a video', () => {
  it('asks the engine to wait, only when told to', () => {
    const args = buildArgs(item({ waitForVideo: true }), settings(), '/tmp')
    expect(args[args.indexOf('--wait-for-video') + 1]).toMatch(/^\d+-\d+$/)
    expect(buildArgs(item(), settings(), '/tmp')).not.toContain('--wait-for-video')
  })
})

describe('buildArgs: a live recording', () => {
  it('writes a transport stream, and turns it back into an mp4 at the end', () => {
    const args = buildArgs(item({ live: true }), settings(), '/tmp')
    expect(args).toContain('--hls-use-mpegts')
    expect(args[args.indexOf('--use-postprocessor') + 1]).toBe('FFmpegFixupM3u8')
  })

  it('leaves an ordinary download to the engine', () => {
    const args = buildArgs(item(), settings(), '/tmp')
    expect(args).not.toContain('--hls-use-mpegts')
    expect(args).not.toContain('--use-postprocessor')
  })
})

describe('buildArgs: audio language', () => {
  const format = (args: string[]): string => args[args.indexOf('-f') + 1]

  // These are the selectors run through the real engine with --simulate.
  it('asks for the language first, and falls back to the plain choice', () => {
    expect(format(buildArgs(item({ quality: '720', audioLanguage: 'de' }), settings(), '/tmp'))).toBe(
      'bv[height<=?720]+ba[language=de]/b[height<=?720][language=de]/bv+ba[language=de]/' +
        'bv*[height<=?720]+ba/b[height<=?720]/bv*+ba/b'
    )
    expect(format(buildArgs(item({ quality: 'best', audioLanguage: 'es-419' }), settings(), '/tmp'))).toBe(
      'bv+ba[language=es-419]/b[language=es-419]/bv*+ba/b'
    )
  })

  it('never lets a format with sound of its own take the place of the language', () => {
    const selector = format(buildArgs(item({ quality: '360', audioLanguage: 'de' }), settings(), '/tmp'))
    const beforeFallback = selector.split('/bv*')[0]
    expect(beforeFallback).not.toContain('bv*')
  })

  it('works on an exact format and on an audio download', () => {
    expect(format(buildArgs(item({ formatId: '137', audioLanguage: 'de' }), settings(), '/tmp'))).toBe(
      '137+ba[language=de]/137+bestaudio/137/best'
    )
    expect(format(buildArgs(item({ mode: 'audio', audioLanguage: 'de' }), settings(), '/tmp'))).toBe(
      'ba[language=de]/bestaudio/best'
    )
  })

  it('leaves every selector as it was without one', () => {
    expect(format(buildArgs(item({ quality: 'best' }), settings(), '/tmp'))).toBe('bv*+ba/b')
    expect(format(buildArgs(item({ mode: 'audio' }), settings(), '/tmp'))).toBe('bestaudio/best')
  })

  it('names the file after the track that came down, so two languages are two files', () => {
    const args = buildArgs(item({ audioLanguage: 'de' }), settings(), '/tmp')
    expect(args[args.indexOf('-o') + 1]).toContain('%(language& [{}]|)s.%(ext)s')
    const plain = buildArgs(item(), settings(), '/tmp')
    expect(plain[plain.indexOf('-o') + 1]).not.toContain('language')
  })
})

describe('buildArgs: subtitles', () => {
  const langs = (args: string[]): string[] =>
    args.flatMap((a, i) => (a === '--sub-langs' ? [args[i + 1]] : []))

  it('asks for nothing by default', () => {
    const args = buildArgs(item(), settings(), '/tmp')
    expect(args).not.toContain('--embed-subs')
    expect(args).not.toContain('--write-subs')
  })

  it('embeds languages picked on the card, machine-made ones included, with the settings off', () => {
    const args = buildArgs(item({ subtitles: ['ru', 'en-orig'] }), settings(), '/tmp')
    expect(args).toContain('--embed-subs')
    expect(args).toContain('--write-auto-subs')
    expect(langs(args)).toEqual(['ru,en-orig'])
  })

  // Run through the real engine: without `--write-subs` a video with both tracks got the machine's.
  it('asks for written tracks beside machine-made ones, and keeps no file of them', () => {
    const args = buildArgs(item({ subtitles: ['de'] }), settings(), '/tmp')
    expect(args).toContain('--write-subs')
    expect(args).toContain('--write-auto-subs')
    expect(args[args.indexOf('--compat-options') + 1]).toBe('no-keep-subs')
  })

  it('keeps the files when Settings wants them beside the video as well', () => {
    const args = buildArgs(item(), settings({ embedSubtitles: true, writeSubtitles: true }), '/tmp')
    expect(args).toContain('--embed-subs')
    expect(args).toContain('--write-subs')
    expect(args).not.toContain('--compat-options')
  })

  // The engine's own rule still applies there: it writes them, embeds them and removes them.
  it('leaves "all" to --embed-subs alone', () => {
    const args = buildArgs(item(), settings({ embedSubtitles: true, subtitleLanguages: 'all' }), '/tmp')
    expect(args).toContain('--embed-subs')
    expect(args).not.toContain('--write-subs')
    expect(args).not.toContain('--compat-options')
  })

  it('does not let a failed caption end the run, and only then', () => {
    expect(buildArgs(item({ subtitles: ['de'] }), settings(), '/tmp')).toContain('--ignore-errors')
    expect(buildArgs(item(), settings({ embedSubtitles: true }), '/tmp')).toContain('--ignore-errors')
    expect(buildArgs(item({ mode: 'audio' }), settings({ writeSubtitles: true }), '/tmp')).toContain('--ignore-errors')
    expect(buildArgs(item(), settings(), '/tmp')).not.toContain('--ignore-errors')
    expect(buildArgs(item({ mode: 'audio' }), settings({ embedSubtitles: true }), '/tmp')).not.toContain('--ignore-errors')
  })

  it('picked languages outrank the Settings list', () => {
    const args = buildArgs(item({ subtitles: ['de'] }), settings({ embedSubtitles: true, subtitleLanguages: 'en' }), '/tmp')
    expect(langs(args)).toEqual(['de'])
  })

  it('leaves them beside the video when Settings asks for that, and only then', () => {
    const args = buildArgs(item({ subtitles: ['de'] }), settings({ writeSubtitles: true }), '/tmp')
    expect(args).toContain('--write-subs')
    expect(args).not.toContain('--embed-subs')
    expect(langs(args)).toEqual(['de'])
  })

  it('does not embed in an audio download', () => {
    const args = buildArgs(item({ mode: 'audio', subtitles: ['de'] }), settings(), '/tmp')
    expect(args).not.toContain('--embed-subs')
    expect(args).not.toContain('--sub-langs')
  })

  it('embedding from Settings takes machine-made captions too', () => {
    const args = buildArgs(item(), settings({ embedSubtitles: true, subtitleLanguages: 'en,ru' }), '/tmp')
    expect(args).toContain('--write-auto-subs')
  })

  // Every language YouTube can translate to, in one go, is a 429.
  it('never asks for machine-made captions in every language', () => {
    for (const subtitleLanguages of ['', 'all', 'en,all']) {
      const args = buildArgs(item(), settings({ embedSubtitles: true, writeSubtitles: true, subtitleLanguages }), '/tmp')
      expect(args).not.toContain('--write-auto-subs')
    }
  })
})

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
  // The engine's thumbnail step raises an error on these two, after the file is already good.
  it.each(['wav', 'aac'])('does not ask for a cover on %s', (audioFormat) => {
    const args = buildArgs(item({ mode: 'audio' }), settings({ audioFormat }), '/downloads')
    expect(args).not.toContain('--embed-thumbnail')
  })

  it.each(['mp3', 'm4a', 'opus', 'flac'])('asks for a cover on %s', (audioFormat) => {
    const args = buildArgs(item({ mode: 'audio' }), settings({ audioFormat }), '/downloads')
    expect(args).toContain('--embed-thumbnail')
  })

  it('asks for a cover on a video, whatever the audio format is set to', () => {
    expect(buildArgs(item(), settings({ audioFormat: 'wav' }), '/downloads')).toContain('--embed-thumbnail')
  })

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

  it('hands the HLS stream to ffmpeg only once the native downloader has refused it', () => {
    // A Twitch VOD whose stream reconnected names a second init segment, which
    // the engine's own downloader refuses outright; ffmpeg reads it.
    const usual = buildArgs(item(), settings(), '/downloads', '/ffmpeg')
    expect(usual).not.toContain('--downloader')
    const twitch = buildArgs(item({ hlsViaFfmpeg: true }), settings(), '/downloads', '/ffmpeg')
    const at = twitch.indexOf('--downloader')
    expect(twitch[at + 1]).toBe('m3u8:ffmpeg')
    expect(twitch.slice(-2)).toEqual(['--', 'https://www.youtube.com/watch?v=abc123'])
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

describe('siteFolder, for a label that names no site', () => {
  it('goes by the host for HTML5MediaEmbed, as the Library does', () => {
    expect(siteFolder({ url: 'https://videos.example.org/a', extractor: 'HTML5MediaEmbed' })).toBe('videos.example.org')
  })
})

describe('siteFolder', () => {
  it('files a sniffed page under its site, not "Universal"', () => {
    // Every universally detected site shared one folder named after the fallback.
    const sourceUrl = sniffUrlFor('https://www.ok.ru/video/1')
    expect(siteFolder({ url: 'https://cdn.test/x.m3u8', sourceUrl: sniffUrlFor('https://kino.example/1'), extractor: 'Universal' })).toBe('kino.example')
    expect(siteFolder({ url: 'https://cdn.test/x.m3u8', sourceUrl, extractor: 'Universal' })).toBe('Одноклассники')
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

  it('keeps a real extractor name for a site it has no name of its own for', () => {
    const native = { url: 'https://media.example/watch/1', extractor: 'ExampleTube' }
    expect(siteFolder(native)).toBe('ExampleTube')
  })

  // Download Now, a batch and the terminal have no extractor; a detect has one.
  it('files one site in one folder however the link was queued', () => {
    const folders = [
      { url: 'https://www.youtube.com/watch?v=abc', extractor: 'Youtube' },
      { url: 'https://www.youtube.com/watch?v=abc' },
      { url: 'https://youtu.be/abc' },
      { url: 'https://music.youtube.com/watch?v=abc' }
    ].map(siteFolder)
    expect(new Set(folders)).toEqual(new Set(['YouTube']))
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

describe('outputTarget', () => {
  const entry = (overrides: Partial<DownloadItem>): DownloadItem => ({ id: 'a', url: 'https://x.test/v', title: 't', mode: 'video', ...overrides }) as DownloadItem

  it('never gives audio the name of the video of the same link, which the engine would delete', () => {
    const video = outputTarget(entry({}), settings(), 'd').path
    const audio = outputTarget(entry({ mode: 'audio', quality: 'audio' }), settings(), 'd').path
    expect(video).toBe(join('d', '%(title)s [%(id)s].%(ext)s'))
    expect(audio).toBe(join('d', '%(title)s [%(id)s] (audio).%(ext)s'))
  })

  it('takes the spaces out of the template too when names are restricted, leaving the folder alone', () => {
    const path = outputTarget(entry({}), settings({ restrictFilenames: true }), 'My Videos').path
    expect(path).toBe(join('My Videos', '%(title)s_[%(id)s].%(ext)s'))
  })
})

describe('titleFromFile', () => {
  it('takes the title out of the name the engine gave the file', () => {
    expect(titleFromFile(join('d', 'Мой ролик [abc123].mp4'))).toBe('Мой ролик')
    expect(titleFromFile(join('d', 'Мой ролик [abc123].f137.mp4'))).toBe('Мой ролик')
    expect(titleFromFile(join('d', 'A plain name.mkv'))).toBe('A plain name')
  })

  it('leaves off what the app itself put on the name', () => {
    expect(titleFromFile(join('d', 'Мой ролик [abc123] (audio).mp3'))).toBe('Мой ролик')
    expect(titleFromFile(join('d', 'Мой ролик [abc123] (2).mp4'))).toBe('Мой ролик')
  })

  it('takes a section and a language off, in the order they went on', () => {
    expect(
      titleFromFile(join('d', 'Клип [abc] [0m05s-0m09s] [de] (audio) (2).mp3'), {
        range: { start: 5, end: 9 },
        audioLanguage: 'de'
      })
    ).toBe('Клип')
  })

  it('leaves a title ending in brackets when the template does not put an id there', () => {
    const template = '%(title)s.%(ext)s'
    expect(titleFromFile(join('d', 'Концерт [Live].mp4'), { template })).toBe('Концерт [Live]')
    expect(titleFromFile(join('d', 'Концерт [Live] [abc].mp4'))).toBe('Концерт [Live]')
    expect(titleFromFile(join('d', 'Концерт [de].mp4'), { template })).toBe('Концерт [de]')
  })

  it('offers nothing for a template with no title in it', () => {
    expect(titleFromFile(join('d', 'abc123.mp4'), { template: '%(id)s.%(ext)s' })).toBeUndefined()
  })

  it('has nothing to offer when the name was only an id', () => {
    expect(titleFromFile(join('d', '[abc123].mp4'))).toBeUndefined()
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
