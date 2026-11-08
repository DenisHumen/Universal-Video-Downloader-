import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import http from 'http'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import type { DownloadItem } from '@shared/types'

/*
  Subtitles and failures against the real tools: the queue's own code, a real
  yt-dlp and a real ffmpeg, and a site this file serves on localhost. No outside
  network. Too dependent on what is installed for an ordinary run:

    UVD_REAL_TOOLS=1 FFMPEG_BIN=<ffmpeg> FFPROBE_BIN=<ffprobe> YTDLP_BIN=<yt-dlp> npx vitest run subtitles.real
*/
const YTDLP = process.env.YTDLP_BIN
const FFMPEG = process.env.FFMPEG_BIN
const FFPROBE = process.env.FFPROBE_BIN
const enabled = Boolean(process.env.UVD_REAL_TOOLS && YTDLP && FFMPEG && FFPROBE)

const h = vi.hoisted(() => ({
  dir: '',
  ytdlp: '',
  ffmpegDir: '',
  infoFile: null as string | null,
  settings: {} as Record<string, unknown>
}))

vi.mock('electron', () => ({
  app: { getPath: () => h.dir, getName: () => 'test', getVersion: () => '0', isPackaged: false },
  net: { isOnline: () => true },
  powerMonitor: { on: () => undefined },
  shell: {},
  session: {},
  BrowserWindow: class {}
}))
vi.mock('./ytdlp', () => ({
  ytdlpBinaryPath: () => h.ytdlp,
  ytdlpSpawnOptions: () => ({ windowsHide: true, env: { ...process.env } }),
  ensureYtdlp: async () => h.ytdlp
}))
vi.mock('./settings', () => ({
  getSettings: () => ({
    concurrentDownloads: 4,
    keepFinished: 0,
    filenameTemplate: '%(title)s.%(ext)s',
    audioFormat: 'mp3',
    subtitleLanguages: 'en',
    speedLimit: '',
    proxy: '',
    cookiesFromBrowser: '',
    cookiesFile: '',
    ...h.settings
  })
}))
vi.mock('./ffmpeg', async (original) => ({
  ...(await original<typeof import('./ffmpeg')>()),
  ffmpegLocation: () => h.ffmpegDir
}))
vi.mock('./log', () => {
  const quiet = (): void => undefined
  return { log: { info: quiet, warn: quiet, error: quiet, debug: quiet } }
})
vi.mock('./browser-logins', () => ({ browserCookiesFile: () => undefined }))
vi.mock('./report', () => ({ recordDownloadFailure: () => undefined }))
vi.mock('./info-store', () => ({
  infoCache: {
    take: () => {
      const file = h.infoFile
      h.infoFile = null
      return file
    },
    release: () => undefined
  }
}))
vi.mock('../resolvers', () => ({ resolveUrl: async (url: string) => ({ url }) }))

describe.runIf(enabled)('subtitles and failures, with the real tools', () => {
  let downloader: typeof import('./downloader')
  let server: http.Server
  let base = ''
  let media = ''
  const hits: string[] = []

  const row = (id: string): DownloadItem => downloader.listDownloads().find((d) => d.id === id)!

  async function run(url: string, options: { info?: Record<string, unknown>; settings?: Record<string, unknown> } = {}): Promise<{
    item: DownloadItem
    files: string[]
    dir: string
  }> {
    const dir = mkdtempSync(join(tmpdir(), 'uvd-subs-run-'))
    h.settings = options.settings ?? {}
    h.infoFile = null
    if (options.info) {
      h.infoFile = join(dir, 'detect.info.json')
      writeFileSync(
        h.infoFile,
        JSON.stringify({ id: 'v', title: 't', extractor: 'generic', extractor_key: 'Generic', _type: 'video', ...options.info })
      )
    }
    hits.length = 0
    const { id } = await downloader.startDownload({ url, title: 't', mode: 'video', quality: 'best', outputDir: dir })
    await vi.waitFor(
      () => {
        if (!['completed', 'error'].includes(row(id).state)) throw new Error(row(id).state)
      },
      { timeout: 60_000, interval: 100 }
    )
    return { item: row(id), files: readdirSync(dir).filter((f) => !f.endsWith('.info.json')), dir }
  }

  function subtitleLanguages(file: string): string[] {
    const out = execFileSync(
      FFPROBE!,
      ['-v', 'error', '-select_streams', 's', '-show_entries', 'stream_tags=language', '-of', 'csv=p=0', file],
      { encoding: 'utf-8' }
    )
    return out.split(/\r?\n/).filter(Boolean)
  }

  const format = (id: string, path: string, more: Record<string, unknown> = {}): Record<string, unknown> => ({
    format_id: id,
    url: base + path,
    ext: 'mp4',
    protocol: 'http',
    vcodec: 'avc1',
    acodec: 'mp4a',
    ...more
  })
  const track = (path: string): { url: string; ext: string }[] => [{ url: base + path, ext: 'vtt' }]

  beforeAll(async () => {
    h.dir = mkdtempSync(join(tmpdir(), 'uvd-subs-data-'))
    h.ytdlp = YTDLP!
    h.ffmpegDir = dirname(FFMPEG!)
    media = mkdtempSync(join(tmpdir(), 'uvd-subs-media-'))
    const make = (name: string, ...args: string[]): void => {
      execFileSync(FFMPEG!, ['-y', '-v', 'error', ...args, join(media, name)])
    }
    const picture = ['-f', 'lavfi', '-i', 'testsrc=d=2:s=320x180:r=10']
    const encode = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p']
    make('v.mp4', ...picture, ...encode)
    make('both.mp4', ...picture, '-f', 'lavfi', '-i', 'sine=d=2', ...encode, '-c:a', 'aac')
    make('a.m4a', '-f', 'lavfi', '-i', 'sine=d=2', '-c:a', 'aac')
    make('seg0.ts', ...picture, '-f', 'lavfi', '-i', 'sine=d=2', ...encode, '-c:a', 'aac', '-f', 'mpegts')

    server = http.createServer((req, res) => {
      const path = (req.url ?? '').split('?')[0]
      hits.push(path)
      const send = (code: number, body: string | Buffer = '', type = 'application/octet-stream'): void => {
        res.writeHead(code, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) })
        res.end(body)
      }
      if (/^\/(429|403|404)/.test(path)) return send(Number(path.slice(1, 4)))
      if (path.endsWith('.m3u8')) {
        return send(
          200,
          '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\n/seg0.ts\n#EXT-X-ENDLIST\n',
          'application/vnd.apple.mpegurl'
        )
      }
      if (path === '/garbage.mp4') return send(200, Buffer.alloc(2000, 120))
      if (path.endsWith('.vtt')) return send(200, `WEBVTT\n\n00:00.000 --> 00:01.000\n${path}\n`, 'text/vtt')
      const page = /^\/page-(.+)\.html$/.exec(path)
      if (page) {
        const [video, caption] = page[1].split('-')
        return send(
          200,
          `<html><head><title>t</title></head><body><video src="/${video}.mp4"><track kind="captions" src="/${caption}.vtt" srclang="en"></video></body></html>`,
          'text/html'
        )
      }
      const file = join(media, path.slice(1))
      return existsSync(file) ? send(200, readFileSync(file), 'video/mp4') : send(404)
    })
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    downloader = await import('./downloader')
  }, 60_000)

  afterAll(async () => {
    downloader?.shutdownDownloads()
    await new Promise((ok) => server?.close(ok))
    rmSync(media, { recursive: true, force: true })
  }, 30_000)

  const onlyEmbed = { embedSubtitles: true, writeSubtitles: false, subtitleLanguages: 'de' }

  it('a video with both tracks gets the written one, inside the file, with no file beside it', async () => {
    const { item, files } = await run(`${base}/both`, {
      settings: onlyEmbed,
      info: {
        formats: [format('0', '/both.mp4')],
        subtitles: { de: track('/human.vtt') },
        automatic_captions: { de: track('/machine.vtt') }
      }
    })
    expect(item.state).toBe('completed')
    expect(hits).toContain('/human.vtt')
    expect(hits).not.toContain('/machine.vtt')
    expect(files.filter((f) => /\.(vtt|srt)$/.test(f))).toEqual([])
    expect(subtitleLanguages(item.filepath!)).toEqual(['deu'])
  }, 90_000)

  it('a video with written tracks only gets them', async () => {
    const { item, files } = await run(`${base}/human`, {
      settings: onlyEmbed,
      info: { formats: [format('0', '/both.mp4')], subtitles: { de: track('/human.vtt') } }
    })
    expect(item.state).toBe('completed')
    expect(files.filter((f) => /\.(vtt|srt)$/.test(f))).toEqual([])
    expect(subtitleLanguages(item.filepath!)).toEqual(['deu'])
  }, 90_000)

  it('a video with machine-made captions only still gets those', async () => {
    const { item } = await run(`${base}/machine`, {
      settings: onlyEmbed,
      info: { formats: [format('0', '/both.mp4')], automatic_captions: { de: track('/machine.vtt') } }
    })
    expect(item.state).toBe('completed')
    expect(hits).toContain('/machine.vtt')
    expect(subtitleLanguages(item.filepath!)).toEqual(['deu'])
  }, 90_000)

  it('keeps the file beside the video when Settings asks for both', async () => {
    const { files, item } = await run(`${base}/kept`, {
      settings: { ...onlyEmbed, writeSubtitles: true },
      info: { formats: [format('0', '/both.mp4')], subtitles: { de: track('/human.vtt') } }
    })
    expect(item.state).toBe('completed')
    expect(files.filter((f) => f.endsWith('.de.srt'))).toHaveLength(1)
    expect(subtitleLanguages(item.filepath!)).toEqual(['deu'])
  }, 90_000)

  it('a caption answering 429 costs the caption, not the video', async () => {
    const { item, files } = await run(`${base}/page-both-429.html`, { settings: { embedSubtitles: true } })
    expect(item.errorCode).toBeUndefined()
    expect(item.state).toBe('completed')
    expect(hits).toContain('/429.vtt')
    expect(hits).toContain('/both.mp4')
    // The page's one video is named by the engine; only the video is there.
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/\.mp4$/)
  }, 90_000)

  it('a video that cannot be fetched is a failure, as it was', async () => {
    const { item, files } = await run(`${base}/page-404-429.html`, { settings: { embedSubtitles: true } })
    expect(item.state).toBe('error')
    expect(item.filepath).toBeUndefined()
    expect(item.errorCode).toBe('unavailable')
    expect(files.filter((f) => f.endsWith('.mp4'))).toEqual([])
  }, 90_000)

  it('a page that cannot be fetched is a failure, as it was', async () => {
    const { item } = await run(`${base}/404.html`, { settings: { embedSubtitles: true } })
    expect(item.state).toBe('error')
  }, 90_000)

  it('a stream of a pair refused partway is a failure, not a finished file', async () => {
    const { item } = await run(`${base}/pair-refused`, {
      settings: { embedSubtitles: true },
      info: {
        formats: [
          format('137', '/v.mp4', { acodec: 'none', height: 180 }),
          format('140', '/403a.m4a', { vcodec: 'none', ext: 'm4a' })
        ],
        automatic_captions: { en: track('/429.vtt') }
      }
    })
    expect(item.state).toBe('error')
    expect(item.filepath).toBeUndefined()
  }, 90_000)

  it('a merge that fails is a post-processing failure, in the words it had before', async () => {
    const { item } = await run(`${base}/bad-merge`, {
      settings: { embedSubtitles: true },
      info: {
        formats: [
          format('137', '/garbage.mp4', { acodec: 'none', height: 180 }),
          format('140', '/a.m4a', { vcodec: 'none', ext: 'm4a' })
        ],
        automatic_captions: { en: track('/429.vtt') }
      }
    })
    expect(item.state).toBe('error')
    expect(item.errorCode).toBe('postprocess')
  }, 90_000)

  // A premiere that had already aired when the wait ended: what comes is an ordinary HLS video.
  it('a wait that turns out to be an ordinary video ends in a real mp4', async () => {
    h.settings = {}
    const dir = mkdtempSync(join(tmpdir(), 'uvd-subs-run-'))
    const { id } = await downloader.startDownload({
      url: `${base}/premiere.m3u8`,
      title: 'premiere',
      mode: 'video',
      quality: 'best',
      live: true,
      waitForVideo: true,
      outputDir: dir
    })
    await vi.waitFor(() => expect(row(id).state).toBe('completed'), { timeout: 60_000, interval: 100 })
    const name = execFileSync(FFPROBE!, ['-v', 'error', '-show_entries', 'format=format_name', '-of', 'csv=p=0', row(id).filepath!], {
      encoding: 'utf-8'
    })
    expect(row(id).filepath).toMatch(/\.mp4$/)
    expect(name).toContain('mp4')
    expect(name).not.toContain('mpegts')
    expect(row(id).partialPaths?.length).toBe(1)
    expect(readdirSync(dir).filter((f) => f.includes('.part'))).toEqual([])
  }, 90_000)

  // Real seconds: the look after a lost connection is a minute away.
  it('a wait outlasts the site being unreachable, and fetches it once it is back', async () => {
    h.settings = {}
    const closed = http.createServer((_req, res) => res.end())
    await new Promise<void>((ok) => closed.listen(0, '127.0.0.1', ok))
    const port = (closed.address() as { port: number }).port
    await new Promise((ok) => closed.close(ok))
    const { id } = await downloader.startDownload({
      url: `http://127.0.0.1:${port}/premiere.m3u8`,
      title: 'outage',
      mode: 'video',
      quality: 'best',
      live: true,
      waitForVideo: true,
      outputDir: mkdtempSync(join(tmpdir(), 'uvd-subs-run-'))
    })
    await vi.waitFor(() => expect(row(id).log).toContain('looking again in a minute'), { timeout: 30_000, interval: 100 })
    expect(row(id).state).toBe('waiting')
    expect(row(id).attempts).toBe(0)
    const back = http.createServer((req, res) => server.emit('request', req, res))
    await new Promise<void>((ok) => back.listen(port, '127.0.0.1', ok))
    await vi.waitFor(() => expect(row(id).state).toBe('completed'), { timeout: 90_000, interval: 200 })
    expect(row(id).attempts).toBe(0)
    await new Promise((ok) => back.close(ok))
  }, 150_000)

  it('a refused stream address still reads as stale, so the app can ask the site again', async () => {
    const { isStaleInfoError } = await import('./info-cache')
    const { item } = await run(`${base}/stale`, {
      settings: { embedSubtitles: true },
      info: { formats: [format('0', '/403.mp4')], automatic_captions: { en: track('/429.vtt') } }
    })
    // The second run is the fresh extraction, which fails on this made-up page.
    expect(item.state).toBe('error')
    expect(isStaleInfoError('ERROR: unable to download video data: HTTP Error 403: Forbidden')).toBe(true)
    expect(item.log).toContain('unable to download video data: HTTP Error 403')
    expect(item.log).toContain('The saved video details were out of date')
  }, 90_000)
})
