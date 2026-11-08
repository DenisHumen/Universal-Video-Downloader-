import { EventEmitter } from 'events'
import { existsSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, sep } from 'path'
import { PassThrough } from 'stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { finalPathCandidate, listDownloads, removeDownload, startDownload } from './downloader'
import { isInsideFolder, isMediaName } from './naming'
import { mayOpen, mayShow } from './open-guard'

/*
  A remote server chooses words that reach the engine's output, so which file a
  row ends on cannot be read off just any line. The strings here are the engine's
  own, seen on the real thing; final-path.real.test.ts runs them through it.
*/
const spawn = vi.hoisted(() => vi.fn())
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  spawn
}))
vi.mock('electron', async () => {
  const fs = await import('fs')
  const os = await import('os')
  const path = await import('path')
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'uvd-final-data-'))
  return { app: { getPath: () => userData } }
})
vi.mock('./settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./settings')>()),
  getSettings: () => ({
    concurrentDownloads: 3,
    audioFormat: 'mp3',
    filenameTemplate: '%(title)s.%(ext)s',
    subtitleLanguages: '',
    speedLimit: '',
    proxy: '',
    cookiesFile: '',
    cookiesFromBrowser: '',
    universalFallback: false,
    createSubfolders: false
  })
}))
vi.mock('./ytdlp', () => ({
  ensureYtdlp: () => Promise.resolve('yt-dlp'),
  ytdlpBinaryPath: () => 'yt-dlp',
  ytdlpSpawnOptions: () => ({ windowsHide: true, env: {} })
}))
vi.mock('../resolvers', () => ({ resolveUrl: async (url: string) => ({ url }) }))

const RUN = sep === '\\' ? 'C:\\Users\\me\\Downloads' : '/home/me/Downloads'
const inRun = (name: string): string => join(RUN, name)
const CALC = 'C:\\Windows\\System32\\calc.exe'

describe('which line names the file', () => {
  it('takes the real finals', () => {
    const merged = inRun('A video [abc].mp4')
    expect(finalPathCandidate(`[Merger] Merging formats into "${merged}"`, RUN)).toEqual({ path: merged, priority: 6, alreadyDownloaded: false })
    expect(finalPathCandidate(`[download] Destination: ${merged}`, RUN)?.priority).toBe(2)
    expect(finalPathCandidate(`[ExtractAudio] Destination: ${inRun('a.mp3')}`, RUN)?.path).toBe(inRun('a.mp3'))
    expect(finalPathCandidate(`[Metadata] Adding metadata to "${merged}"`, RUN)?.priority).toBe(3)
    expect(finalPathCandidate(`[download] ${merged} has already been downloaded`, RUN)).toEqual({ path: merged, priority: 4, alreadyDownloaded: true })
  })

  it('reads Cyrillic names, quotes in names and subfolders', () => {
    const named = inRun('Мой ролик ＂тест＂ [abc].mp4')
    expect(finalPathCandidate(`[download] Destination: ${named}`, RUN)?.path).toBe(named)
    const sub = join(RUN, 'Канал', 'Серия 1.mkv')
    expect(finalPathCandidate(`[Merger] Merging formats into "${sub}"`, RUN)?.path).toBe(sub)
    const quoted = inRun('He said "hi" [abc].mp4')
    expect(finalPathCandidate(`[Merger] Merging formats into "${quoted}"`, RUN)?.path).toBe(quoted)
  })

  it('takes nothing from the name a link gave the extractor', () => {
    expect(finalPathCandidate(`[generic] [Merger] Merging formats into "${CALC}": Downloading webpage`, RUN)).toBeNull()
    expect(finalPathCandidate(`[info] [Merger] Merging formats into "${CALC}": Downloading 1 format(s): mp4`, RUN)).toBeNull()
  })

  it('takes nothing from a title tag ffmpeg echoes', () => {
    expect(finalPathCandidate(`    title           : [Merger] Merging formats into "${CALC}"`, RUN)).toBeNull()
  })

  it('takes nothing outside the run, even from a line that is really a line of its own', () => {
    // `%0A` in the link: the engine prints these exactly so, starting the line.
    for (const line of [
      `[Merger] Merging formats into "${CALC}": Downloading webpage`,
      `[Merger] Merging formats into "${CALC}"`,
      `[download] Destination: ${CALC}`,
      `[ExtractAudio] Destination: ${CALC}`,
      `[Metadata] Adding metadata to "${CALC}"`,
      `[download] ${CALC} has already been downloaded`,
      '[Merger] Merging formats into "\\\\attacker.example\\share\\x.mp4"',
      '[download] Destination: \\\\attacker.example\\share\\x.mp4',
      `[download] Destination: ${RUN}${sep}..${sep}..${sep}x.mp4`,
      '[download] Destination: x.mp4',
      '[download] Destination: ../x.mp4'
    ]) {
      expect(finalPathCandidate(line, RUN), line).toBeNull()
    }
  })
})

describe('isInsideFolder', () => {
  it('knows the folder from its neighbours', () => {
    expect(isInsideFolder(inRun('x.mp4'), RUN)).toBe(true)
    expect(isInsideFolder(`${RUN}2${sep}x.mp4`, RUN)).toBe(false)
    expect(isInsideFolder(RUN, RUN)).toBe(false)
  })

  it.runIf(sep === '\\')('ignores case and takes a share only when the run is on it', () => {
    expect(isInsideFolder('c:\\users\\ME\\downloads\\x.mp4', RUN)).toBe(true)
    expect(isInsideFolder('\\\\nas\\media\\x.mp4', '\\\\nas\\media')).toBe(true)
    expect(isInsideFolder('\\\\nas\\media\\x.mp4', RUN)).toBe(false)
  })

  it.runIf(sep === '\\')('refuses an NTFS stream dressed as an .mp4', () => {
    expect(isInsideFolder(inRun('x.exe:y.mp4'), RUN)).toBe(false)
  })
})

describe('isMediaName', () => {
  it('knows what a download is', () => {
    for (const name of ['a.mp4', 'a.MKV', 'a.webm', 'a.ts', 'a.m4a', 'a.mp3', 'a.opus', 'a.avi', 'a.mpg', 'a.3gp', 'a.wmv', 'a.flac', 'a.mka']) {
      expect(isMediaName(name), name).toBe(true)
    }
  })

  it('knows what it is not', () => {
    for (const name of ['a.svg', 'a.xml', 'a.m3u', 'a.m3u8', 'a.asx', 'a.swf', 'a.ico', 'a.bin', 'a.json', 'a.url', 'a.desktop', 'a.webloc', 'a.exe', 'a.mp4.exe', 'a', 'a.mp4.', 'a.mp4 ', 'a.vtt', 'a.part']) {
      expect(isMediaName(name), name).toBe(false)
    }
  })
})

describe('what the window may open', () => {
  const known = { files: [inRun('a.mp4'), inRun('clip.gif'), CALC, inRun('uvd.log')], folders: [RUN] }

  it('opens what it knows', () => {
    expect(mayOpen(inRun('a.mp4'), known)).toBe(true)
    expect(mayOpen(inRun('clip.gif'), known)).toBe(true)
    expect(mayOpen(RUN, known)).toBe(true)
    expect(mayShow(inRun('uvd.log'), known)).toBe(true)
  })

  it('opens nothing else, and no program even if a row from before still names one', () => {
    expect(mayOpen(CALC, known)).toBe(false)
    expect(mayOpen(inRun('other.mp4'), known)).toBe(false)
    expect(mayOpen('\\\\attacker.example\\share\\x.mp4', known)).toBe(false)
    expect(mayOpen(undefined, known)).toBe(false)
    expect(mayShow(inRun('other.mp4'), known)).toBe(false)
    expect(mayShow('\\\\attacker.example\\share\\x.mp4', known)).toBe(false)
  })
})

describe('what a run ends on', () => {
  const row = (id: string) => listDownloads().find((d) => d.id === id)!

  async function run(lines: (dir: string) => string[]): Promise<{ id: string; dir: string }> {
    const dir = mkdtempSync(join(tmpdir(), 'uvd-final-'))
    const stdout = new PassThrough()
    const child = Object.assign(new EventEmitter(), { stdout, stderr: new PassThrough() })
    spawn.mockImplementation(() => child)
    const { id } = await startDownload({ url: 'https://media.example/a', mode: 'video', outputDir: dir })
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled())
    await vi.waitFor(() => expect(child.listenerCount('close')).toBeGreaterThan(0))
    await new Promise<void>((done) => stdout.write(lines(dir).join('\n') + '\n', () => done()))
    await new Promise((done) => setTimeout(done, 10))
    child.emit('close', 0)
    return { id, dir }
  }

  beforeEach(() => {
    for (const item of listDownloads()) removeDownload(item.id)
    spawn.mockReset()
  })

  it('takes the true file over a crafted line', async () => {
    const { id, dir } = await run((d) => {
      writeFileSync(join(d, 'real [x].mp4'), 'video')
      return [
        `[generic] [Merger] Merging formats into "${CALC}": Downloading webpage`,
        `[Merger] Merging formats into "${CALC}"`,
        `[download] Destination: ${join(d, 'real [x].mp4')}`
      ]
    })
    expect(row(id).state).toBe('completed')
    expect(row(id).filepath).toBe(join(dir, 'real [x].mp4'))
  })

  it('fails on a file that is not media and removes it, before anything can open it', async () => {
    let svg = ''
    const { id } = await run((d) => {
      svg = join(d, 'x [y].svg')
      writeFileSync(svg, '<svg/>')
      return [`[download] Destination: ${svg}`]
    })
    expect(row(id).state).toBe('error')
    expect(row(id).errorCode).toBe('notMedia')
    expect(row(id).filepath).toBeUndefined()
    expect(existsSync(svg)).toBe(false)
  })

  it('does not remove such a file that was there before this run', async () => {
    let json = ''
    const { id } = await run((d) => {
      json = join(d, 'x [y].json')
      writeFileSync(json, '{}')
      return [`[download] ${json} has already been downloaded`]
    })
    expect(row(id).state).toBe('error')
    expect(existsSync(json)).toBe(true)
  })

  it('keeps a video announced beside its subtitles, either way round', async () => {
    const { id, dir } = await run((d) => {
      writeFileSync(join(d, 'v.mp4'), 'video')
      writeFileSync(join(d, 'v.en.vtt'), 'WEBVTT')
      return [`[download] Destination: ${join(d, 'v.mp4')}`, `[download] Destination: ${join(d, 'v.en.vtt')}`]
    })
    expect(row(id).state).toBe('completed')
    expect(row(id).filepath).toBe(join(dir, 'v.mp4'))
    expect(existsSync(join(dir, 'v.en.vtt'))).toBe(true)
  })

  it('does not delete a subtitle file when nothing else came', async () => {
    let vtt = ''
    const { id } = await run((d) => {
      vtt = join(d, 'v.en.vtt')
      writeFileSync(vtt, 'WEBVTT')
      return [`[download] Destination: ${vtt}`]
    })
    expect(row(id).state).toBe('error')
    expect(existsSync(vtt)).toBe(true)
  })
})
