import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import http from 'http'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import type { DownloadItem } from '@shared/types'

/*
  Which file a row ends on, with a real yt-dlp and a real ffmpeg, and a site that
  tries to choose it, served by this file on localhost. No outside network:

    UVD_REAL_TOOLS=1 FFMPEG_BIN=<ffmpeg> YTDLP_BIN=<yt-dlp> npx vitest run final-path.real
*/
const YTDLP = process.env.YTDLP_BIN
const FFMPEG = process.env.FFMPEG_BIN
const enabled = Boolean(process.env.UVD_REAL_TOOLS && YTDLP && FFMPEG)

const h = vi.hoisted(() => ({ dir: '', ytdlp: '', ffmpegDir: '', settings: {} as Record<string, unknown> }))

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
    filenameTemplate: '%(title)s [%(id)s].%(ext)s',
    audioFormat: 'mp3',
    subtitleLanguages: '',
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
vi.mock('./browser-logins', () => ({ browserCookiesFile: () => undefined, holdJarCopy: () => ({ release: () => undefined }) }))
vi.mock('./report', () => ({ recordDownloadFailure: () => undefined }))
vi.mock('../resolvers', () => ({ resolveUrl: async (url: string) => ({ url }) }))

const CALC = 'C:\\Windows\\System32\\calc.exe'
const CRAFTED = encodeURIComponent(`[Merger] Merging formats into "${CALC}"`) + '.mp4'

describe.runIf(enabled)('which file a row ends on, with the real engine', () => {
  let downloader: typeof import('./downloader')
  let server: http.Server
  let base = ''
  let media = ''

  const row = (id: string): DownloadItem => downloader.listDownloads().find((d) => d.id === id)!

  async function run(url: string, extra: Record<string, unknown> = {}): Promise<{ item: DownloadItem; dir: string; files: string[] }> {
    const dir = mkdtempSync(join(tmpdir(), 'uvd-final-run-'))
    const { id } = await downloader.startDownload({ url, mode: 'video', quality: 'best', outputDir: dir, ...extra })
    await vi.waitFor(
      () => {
        if (!['completed', 'error'].includes(row(id).state)) throw new Error(row(id).state)
      },
      { timeout: 60_000, interval: 100 }
    )
    return { item: row(id), dir, files: readdirSync(dir) }
  }

  beforeAll(async () => {
    h.dir = mkdtempSync(join(tmpdir(), 'uvd-final-data-'))
    h.ytdlp = YTDLP!
    h.ffmpegDir = dirname(FFMPEG!)
    media = mkdtempSync(join(tmpdir(), 'uvd-final-media-'))
    execFileSync(FFMPEG!, [
      '-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=d=2:s=320x180:r=10', '-f', 'lavfi', '-i', 'sine=d=2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
      // The second route: ffmpeg echoes this on standard error when it opens the file.
      '-metadata', `title=[Merger] Merging formats into "${CALC}"`,
      join(media, 'v.mp4')
    ])
    execFileSync(FFMPEG!, [
      '-y', '-v', 'error', '-i', join(media, 'v.mp4'), '-c', 'copy', '-f', 'hls', '-hls_time', '1', '-hls_playlist_type', 'vod',
      '-hls_segment_filename', join(media, 's%d.ts'), join(media, 'p.m3u8')
    ])

    const video = readFileSync(join(media, 'v.mp4'))
    server = http.createServer((req, res) => {
      const path = decodeURIComponent((req.url ?? '').split('?')[0])
      const send = (type: string, body: Buffer | string): void => {
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) })
        res.end(req.method === 'HEAD' ? undefined : body)
      }
      if (path === '/redirect') {
        res.writeHead(302, { Location: `/${CRAFTED}` })
        return res.end()
      }
      if (path === '/line') {
        res.writeHead(302, { Location: `/x%0A${CRAFTED}` })
        return res.end()
      }
      if (path === '/drawing.svg') return send('image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>')
      if (path.startsWith('/sneaky.')) return send('video/mp4', '[InternetShortcut]\r\nURL=https://example.invalid/\r\n')
      if (path === '/p.m3u8') return send('application/vnd.apple.mpegurl', readFileSync(join(media, 'p.m3u8')))
      if (path.endsWith('.ts')) return send('video/mp2t', readFileSync(join(media, path.slice(1))))
      if (path.endsWith('.mp4')) return send('video/mp4', video)
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    downloader = await import('./downloader')
  })

  afterAll(() => {
    server?.close()
    rmSync(media, { recursive: true, force: true })
  })

  const expectTrueFile = ({ item, dir, files }: { item: DownloadItem; dir: string; files: string[] }): void => {
    expect(item.state, item.error).toBe('completed')
    expect(files.length).toBeGreaterThan(0)
    expect(item.filepath?.startsWith(dir)).toBe(true)
    expect(existsSync(item.filepath!)).toBe(true)
    expect(item.filepath).not.toContain('System32\\calc.exe')
  }

  it('a link redirecting to a crafted name', async () => expectTrueFile(await run(`${base}/redirect`)))
  it('a crafted name that starts a line of its own', async () => expectTrueFile(await run(`${base}/line`)))

  it('a title tag naming a program, on a trimmed download that goes through ffmpeg', async () => {
    const result = await run(`${base}/tagged.mp4`, { range: { start: 0, end: 1 }, precise: false })
    expectTrueFile(result)
  })

  it('an HLS stream fetched by ffmpeg still says where its file is', async () => {
    const result = await run(`${base}/p.m3u8`, { hlsViaFfmpeg: true })
    expectTrueFile(result)
  })

  it('an audio download ends on the audio file', async () => {
    const result = await run(`${base}/song.mp4`, { mode: 'audio', quality: 'audio' })
    expectTrueFile(result)
    expect(result.item.filepath).toMatch(/\.mp3$/)
  })

  it('three copies with restricted names on are three files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'uvd-final-copies-'))
    h.settings = { restrictFilenames: true }
    try {
      const paths: string[] = []
      for (const quality of ['best', '720', '480'] as const) {
        const { id } = await downloader.startDownload({ url: `${base}/copies.mp4`, mode: 'video', quality, outputDir: dir })
        await vi.waitFor(
          () => {
            if (!['completed', 'error'].includes(row(id).state)) throw new Error(row(id).state)
          },
          { timeout: 60_000, interval: 100 }
        )
        expect(row(id).state, row(id).error).toBe('completed')
        paths.push(row(id).filepath!)
      }
      expect(new Set(paths).size).toBe(3)
      for (const path of paths) expect(existsSync(path), path).toBe(true)
      expect(readdirSync(dir).filter((name) => name.endsWith('.mp4'))).toHaveLength(3)
    } finally {
      h.settings = {}
    }
  })

  it.each(['svg', 'xml', 'm3u', 'swf', 'ico', 'bin', 'json', 'asx'])(
    'a video the site calls a .%s fails, in plain words, with nothing left to open',
    async (ext) => {
      const result = await run(`${base}/sneaky.${ext}`)
      expect(result.item.state).toBe('error')
      expect(result.item.filepath).toBeUndefined()
      expect(result.files.filter((f) => !f.endsWith('.part'))).toEqual([])
      if (result.files.length === 0 && result.item.errorCode !== 'notMedia') {
        // The engine has refused or not recognised this one itself, which is as good.
        expect(result.item.errorCode).toBeTruthy()
      }
    }
  )

  it('a real .ts gets through', async () => {
    expectTrueFile(await run(`${base}/s0.ts`))
  })

  it('a site that sends a drawing fails, and the drawing is gone', async () => {
    const result = await run(`${base}/drawing.svg`)
    if (result.item.state === 'error' && result.item.errorCode !== 'notMedia') {
      // A build that will not write it at all has refused it first, which is as good.
      expect(result.files.filter((f) => f.endsWith('.svg'))).toEqual([])
      return
    }
    expect(result.item.state).toBe('error')
    expect(result.item.errorCode).toBe('notMedia')
    expect(result.files.filter((f) => f.endsWith('.svg'))).toEqual([])
  })
})
