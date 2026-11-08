import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync, spawn, type ChildProcess } from 'child_process'
import { createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import http from 'http'
import { tmpdir } from 'os'
import { join } from 'path'
import type { DownloadItem } from '@shared/types'

/*
  Stop and Save against the real tools: the queue's own code, a real yt-dlp and a
  real ffmpeg, recording a playlist that ffmpeg is writing right now and this
  file serves on localhost. No outside network. Too slow, and too dependent on
  what is installed, for an ordinary run:

    UVD_REAL_TOOLS=1 FFMPEG_BIN=<ffmpeg> YTDLP_BIN=<yt-dlp> npx vitest run live-stop.real
*/
const YTDLP = process.env.YTDLP_BIN
const FFMPEG = process.env.FFMPEG_BIN
const enabled = Boolean(process.env.UVD_REAL_TOOLS && YTDLP && FFMPEG)

const h = vi.hoisted(() => ({ dir: '', out: '', forceKill: false, ytdlp: '' }))

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
    downloadDir: h.out,
    concurrentDownloads: 4,
    keepFinished: 0,
    filenameTemplate: '%(title)s [%(id)s].%(ext)s',
    audioFormat: 'mp3',
    subtitleLanguages: '',
    speedLimit: '',
    proxy: '',
    cookiesFromBrowser: '',
    cookiesFile: ''
  })
}))
vi.mock('./log', () => {
  const quiet = (): void => undefined
  return { log: { info: quiet, warn: quiet, error: quiet, debug: quiet } }
})
vi.mock('./browser-logins', () => ({ browserCookiesFile: () => undefined }))
vi.mock('./report', () => ({ recordDownloadFailure: () => undefined }))
vi.mock('./info-store', () => ({ infoCache: { take: () => null, release: () => undefined } }))
vi.mock('../resolvers', () => ({ resolveUrl: async (url: string) => ({ url }) }))
vi.mock('../resolvers/universal', () => ({ SNIFF_SCHEME: 'uvd-sniff:', pageUrlFromSniffUrl: () => '' }))
vi.mock('../resolvers/universal/direct', () => ({ DIRECT_SCHEME: 'uvd-direct:', parseDirectUrl: () => null }))
vi.mock('./process', async (original) => {
  const real = await original<typeof import('./process')>()
  return {
    ...real,
    // Standing in for the Ctrl-C that could not be delivered, or was ignored.
    interruptTree: (child: ChildProcess, onFailed: () => void) =>
      h.forceKill ? onFailed() : real.interruptTree(child, onFailed)
  }
})

const sleep = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms))

async function until<T>(what: string, read: () => T | undefined | false | null, ms = 60_000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const value = read()
    if (value) return value
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${what}`)
    await sleep(100)
  }
}

/** ffmpeg decoding every frame: nothing on stderr at `-v error`, or the file is damaged. */
function decodes(file: string): void {
  const errors = execFileSync(FFMPEG!, ['-v', 'error', '-i', file, '-f', 'null', '-'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  expect(errors).toBe('')
}

function secondsOf(file: string): number {
  const result = spawnText(FFMPEG!, ['-hide_banner', '-i', file])
  const m = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(result)
  if (!m) throw new Error(`No duration in: ${result}`)
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

function spawnText(bin: string, args: string[]): string {
  try {
    return execFileSync(bin, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) {
    return String((err as { stderr?: string }).stderr ?? '')
  }
}

describe.runIf(enabled)('Stop and Save, with the real tools', () => {
  let downloader: typeof import('./downloader')
  let generator: ChildProcess
  let server: http.Server
  let base = ''
  let hls = ''
  const finished: DownloadItem[] = []

  beforeAll(async () => {
    h.ytdlp = YTDLP!
    h.dir = mkdtempSync(join(tmpdir(), 'uvd-live-'))
    h.out = join(h.dir, 'out')
    hls = join(h.dir, 'hls')
    execFileSync(process.platform === 'win32' ? 'cmd' : 'mkdir', process.platform === 'win32' ? ['/c', 'mkdir', h.out, hls] : ['-p', h.out, hls])
    generator = spawn(
      FFMPEG!,
      [
        '-hide_banner', '-loglevel', 'error', '-re',
        // Busy enough to pass ffmpeg's write buffer in seconds; a forced kill loses what is still in that.
        '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25',
        '-f', 'lavfi', '-i', 'sine=frequency=440',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25', '-pix_fmt', 'yuv420p', '-b:v', '2M',
        '-c:a', 'aac',
        '-f', 'hls', '-hls_time', '1', '-hls_list_size', '0', '-hls_flags', 'independent_segments',
        join(hls, 'live.m3u8')
      ],
      { stdio: 'ignore' }
    )
    server = http.createServer((req, res) => {
      const name = (req.url ?? '').split('?')[0].slice(1)
      // Any playlist name is the one stream: the engine names its file after it, so each test has its own.
      const closed = name.startsWith('closed')
      const file = join(hls, name.endsWith('.m3u8') ? 'live.m3u8' : name)
      if (!existsSync(file)) {
        res.writeHead(404)
        res.end()
        return
      }
      if (closed) {
        // The same stream with an end on it: to the engine a finished video, which its own downloader fetches.
        res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' })
        res.end(readFileSync(file, 'utf-8').replace(/\.ts$/gm, '.ts?slow') + '#EXT-X-ENDLIST\n')
        return
      }
      if (name.endsWith('.m3u8')) {
        res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' })
        createReadStream(file).pipe(res)
        return
      }
      // Slow enough that the engine's own downloader is caught partway through its list.
      const delay = (req.url ?? '').endsWith('?slow') ? 3000 : 0
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'video/mp2t' })
        createReadStream(file).pipe(res)
      }, delay)
    })
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    downloader = await import('./downloader')
    downloader.downloadEvents.on('updated', (item: DownloadItem) => {
      if (item.state === 'completed') finished.push(item)
    })
    // Enough of the playlist that a closed copy of it takes the slow downloader a while.
    await until('the stream to have 20 segments', () => existsSync(join(hls, 'live20.ts')))
  }, 120_000)

  afterAll(async () => {
    downloader?.shutdownDownloads()
    generator?.kill()
    server?.closeAllConnections?.()
    server?.close()
    await sleep(1500)
    try {
      if (h.dir) rmSync(h.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch {
      /* in the temp folder, and a slow process exit is no finding */
    }
  })

  const row = (id: string): DownloadItem => {
    const item = downloader.getDownload(id)
    if (!item) throw new Error('row is gone')
    return item
  }
  const partsOf = (name: string): string[] => readdirSync(h.out).filter((f) => f.includes(name))

  /** `title` is the playlist's name too, and so is in the name of every file the engine writes. */
  async function record(title: string, recordForMs: number, prefix = ''): Promise<{ id: string }> {
    const { id } = await downloader.startDownload({
      url: `${base}/${prefix}${title}.m3u8`,
      title,
      mode: 'video',
      quality: 'best',
      live: true,
      outputDir: h.out
    })
    await until('the recording to start', () => row(id).partialPaths?.length, 30_000).catch((err) => {
      throw new Error(`${err}: ${JSON.stringify(row(id))}`)
    })
    await until('data on disk', () => partsOf(title).some((f) => f.includes('.part')))
    await sleep(recordForMs)
    return { id }
  }

  it.each([
    ['asked politely', false],
    ['killed outright', true]
  ])('the ffmpeg path: %s', async (_name, force) => {
    h.forceKill = force
    const title = force ? 'ffmpegkilled' : 'ffmpegpolite'
    const { id } = await record(title, 8000)
    downloader.stopLiveRecording(id)
    const saved = await until('the row to end', () => {
      const item = row(id)
      return item.state === 'completed' || item.state === 'error' ? item : null
    })
    console.log(`[ffmpeg path, ${force ? 'killed' : 'polite'}]`, saved.state, saved.filepath, saved.totalBytes, saved.duration, partsOf(title))
    expect(saved.errorCode).toBeUndefined()
    expect(saved.state).toBe('completed')
    expect(saved.totalBytes).toBe(statSync(saved.filepath!).size)
    expect(saved.savingLive).toBeUndefined()
    decodes(saved.filepath!)
    const seconds = secondsOf(saved.filepath!)
    expect(seconds).toBeGreaterThan(6)
    expect(seconds).toBeLessThan(40)
    // Reached the Library's feed, which is `updated` with `completed`, and left nothing behind.
    expect(finished.some((item) => item.id === id && item.filepath === saved.filepath)).toBe(true)
    expect(partsOf(title).filter((f) => f.includes('.part'))).toEqual([])
  }, 120_000)

  it.each([
    ['asked politely', false],
    ['killed outright', true]
  ])('the engine\'s own HLS downloader: %s', async (_name, force) => {
    h.forceKill = force
    const title = force ? 'nativekilled' : 'nativepolite'
    const { id } = await record(title, 5000, 'closed')
    console.log('[native, before stop]', partsOf(title))
    downloader.stopLiveRecording(id)
    const saved = await until('the row to end', () => {
      const item = row(id)
      return item.state === 'completed' || item.state === 'error' ? item : null
    })
    console.log(`[native, ${force ? 'killed' : 'polite'}]`, saved.state, saved.filepath, saved.totalBytes, saved.duration, partsOf(title), saved.log?.slice(-400))
    expect(saved.errorCode).toBeUndefined()
    expect(saved.state).toBe('completed')
    decodes(saved.filepath!)
    expect(secondsOf(saved.filepath!)).toBeGreaterThan(1)
    expect(partsOf(title).filter((f) => f.includes('.part') || f.endsWith('.ytdl'))).toEqual([])
  }, 120_000)

  it('a resumed recording starts a new file and the first is saved on its own row', async () => {
    h.forceKill = false
    const title = 'resumed'
    const { id } = await record(title, 5000)
    downloader.pauseDownload(id)
    await until('the process to stop', () => partsOf(title).length > 0 && row(id).state === 'paused')
    await sleep(1500)
    const first = row(id).partialPaths![0]
    expect(existsSync(`${first}.part`)).toBe(true)
    const before = new Set(downloader.listDownloads().map((item) => item.id))

    downloader.resumeDownload(id)
    const other = await until('the earlier part to get a row', () =>
      downloader.listDownloads().find((item) => !before.has(item.id) && item.state === 'completed')
    )
    console.log('[resumed, earlier part]', other.filepath, other.duration)
    decodes(other.filepath!)
    expect(secondsOf(other.filepath!)).toBeGreaterThan(3)

    await until('the new run to record', () => row(id).partialPaths?.length)
    await sleep(5000)
    expect(row(id).partialPaths![0]).not.toBe(first)
    downloader.stopLiveRecording(id)
    const saved = await until('the row to end', () => (row(id).state === 'completed' ? row(id) : null))
    console.log('[resumed, new part]', saved.filepath, saved.duration)
    expect(saved.filepath).not.toBe(other.filepath)
    decodes(saved.filepath!)
  }, 120_000)

  it('recording the same stream again within the minute keeps both', async () => {
    h.forceKill = false
    const first = await record('twice', 3000)
    downloader.stopLiveRecording(first.id)
    const one = await until('the first to end', () => (row(first.id).state === 'completed' ? row(first.id) : null))
    const { id } = await downloader.startDownload({
      url: `${base}/twice.m3u8`,
      title: 'twice',
      mode: 'video',
      live: true,
      outputDir: h.out
    })
    await until('the second to start', () => row(id).partialPaths?.length || row(id).state === 'completed')
    console.log('[twice]', one.filepath, row(id).state, row(id).partialPaths, row(id).filepath)
    await sleep(3000)
    downloader.stopLiveRecording(id)
    const two = await until('the second to end', () => (row(id).state === 'completed' ? row(id) : null))
    expect(two.filepath).not.toBe(one.filepath)
    decodes(two.filepath!)
    decodes(one.filepath!)
  }, 120_000)

  it('a paused row can be saved with no process running', async () => {
    h.forceKill = false
    const { id } = await record('pausedsaved', 5000)
    downloader.pauseDownload(id)
    await sleep(1500)
    downloader.stopLiveRecording(id)
    const saved = await until('the row to end', () => (row(id).state === 'completed' ? row(id) : null))
    decodes(saved.filepath!)
    expect(secondsOf(saved.filepath!)).toBeGreaterThan(3)
  }, 120_000)

  /*
    The engine appended its fragments too promptly to catch any lying around, so
    this lays them out by hand as it names them: a transport stream cut on a
    packet boundary, the tail waiting to be appended.
  */
  it('fragments left beside the partial end up in the saved file', async () => {
    h.forceKill = false
    const { id } = await record('fragments', 6000)
    downloader.pauseDownload(id)
    await sleep(1500)
    const dest = row(id).partialPaths![0]
    const whole = readFileSync(`${dest}.part`)
    const packets = Math.floor(whole.length / 188)
    const cut = Math.floor(packets / 3) * 188
    const third = Math.floor(packets / 3) * 188 * 2
    const fullLength = secondsOf(`${dest}.part`)
    writeFileSync(`${dest}.part`, whole.subarray(0, cut))
    writeFileSync(`${dest}.part-Frag7`, whole.subarray(cut, third))
    writeFileSync(`${dest}.part-Frag8`, whole.subarray(third, packets * 188))
    downloader.stopLiveRecording(id)
    const saved = await until('the row to end', () => (row(id).state === 'completed' ? row(id) : null))
    console.log('[fragments]', fullLength, saved.duration, partsOf('fragments'))
    decodes(saved.filepath!)
    expect(saved.duration!).toBeGreaterThan(fullLength * 0.9)
    expect(partsOf('fragments').filter((f) => f.includes('.part'))).toEqual([])
  }, 120_000)

  it('a partial that cannot be read stays on disk, and the row says so', async () => {
    h.forceKill = false
    const { id } = await record('unsavable', 3000)
    downloader.pauseDownload(id)
    await sleep(1500)
    const dest = row(id).partialPaths![0]
    writeFileSync(`${dest}.part`, Buffer.alloc(48, 7))
    downloader.stopLiveRecording(id)
    const failed = await until('the row to end', () => (row(id).state === 'error' ? row(id) : null))
    console.log('[unsavable]', failed.errorCode, failed.keptPartial)
    expect(failed.errorCode).toBe('liveNotSaved')
    expect(failed.keptPartial).toBe(`${dest}.part`)
    expect(statSync(`${dest}.part`).size).toBe(48)
    expect(partsOf('unsavable').filter((f) => f.includes('.saving.'))).toEqual([])
  }, 120_000)

  it('stopped before anything arrived, the row says there is nothing', async () => {
    h.forceKill = true
    const { id } = await downloader.startDownload({
      url: `${base}/atonce.m3u8`,
      title: 'atonce',
      mode: 'video',
      live: true,
      outputDir: h.out
    })
    await until('the process', () => row(id).state === 'downloading')
    downloader.stopLiveRecording(id)
    const failed = await until('the row to end', () => (row(id).state === 'error' ? row(id) : null))
    expect(failed.errorCode).toBe('liveEmpty')
  }, 60_000)
})
