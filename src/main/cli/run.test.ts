import { EventEmitter } from 'events'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PassThrough } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
  `uvd` from the top: the engine is played back, and the cookie jar is a made-up
  one in a temporary folder. What this is about is the private copy of that jar,
  which has to be gone by the time the process is, whichever way it went.
*/
const h = vi.hoisted(() => ({ dir: '', exit: vi.fn() }))
const spawn = vi.hoisted(() => vi.fn())

vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  spawn
}))
vi.mock('electron', () => ({
  app: {
    getPath: () => h.dir,
    getVersion: () => '0',
    disableHardwareAcceleration: vi.fn(),
    commandLine: { appendSwitch: vi.fn() },
    setPath: vi.fn(),
    dock: { hide: vi.fn() },
    whenReady: () => Promise.resolve(),
    exit: h.exit
  }
}))
vi.mock('../resolvers/universal/capture', () => ({ browsingSession: vi.fn() }))
vi.mock('../services/settings', () => ({
  getSettings: () => ({
    browserStaySignedIn: true,
    downloadDir: h.dir,
    defaultMode: 'video',
    defaultQuality: 'best',
    audioFormat: 'mp3',
    filenameTemplate: '%(title)s.%(ext)s',
    subtitleLanguages: '',
    speedLimit: '',
    proxy: '',
    cookiesFile: '',
    cookiesFromBrowser: '',
    createSubfolders: false
  })
}))
vi.mock('../services/secrets', () => ({
  initSecrets: async () => undefined,
  flushSecrets: async () => undefined,
  getSecret: vi.fn(),
  setSecret: vi.fn(),
  SECRET: {}
}))
vi.mock('../services/proxy', () => ({ applyProxy: async () => undefined }))
vi.mock('../services/ytdlp', () => ({
  ensureJsRuntime: async () => undefined,
  ensureYtdlp: async () => 'yt-dlp',
  ytdlpBinaryPath: () => 'yt-dlp',
  ytdlpSpawnOptions: () => ({})
}))
vi.mock('../services/ffmpeg', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/ffmpeg')>()),
  ffmpegLocation: () => undefined
}))
vi.mock('../services/log', () => {
  const quiet = vi.fn()
  return { log: { info: quiet, warn: quiet, error: quiet, debug: quiet }, initLog: quiet, flushLog: quiet }
})
vi.mock('../services/process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/process')>()),
  killTree: vi.fn()
}))

type Engine = EventEmitter & { stdout: PassThrough; stderr: PassThrough }
const ENTRY = '.example.com\tTRUE\t/\tTRUE\t0\tsession\texample-value'

/** Where a `--cookies` argument pointed, in the run the test just started. */
const cookiesArg = (): string => {
  const args = spawn.mock.calls[0][1] as string[]
  return args[args.indexOf('--cookies') + 1]
}

beforeEach(() => {
  vi.resetModules()
  h.dir = mkdtempSync(join(tmpdir(), 'uvd-cli-'))
  writeFileSync(join(h.dir, 'browser-cookies.txt'), `# Netscape HTTP Cookie File\n${ENTRY}\n`)
  h.exit.mockReset()
  spawn.mockReset()
  spawn.mockImplementation(() => Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() }))
  vi.spyOn(process.stdout, 'write').mockImplementation(((_text: string, done?: () => void) => {
    done?.()
    return true
  }) as typeof process.stdout.write)
})

afterEach(() => {
  vi.restoreAllMocks()
  process.removeAllListeners('SIGINT')
  process.removeAllListeners('SIGTERM')
})

async function started(): Promise<Engine> {
  const { startCli } = await import('./run')
  startCli(['https://media.example/v'])
  await vi.waitFor(() => expect(spawn).toHaveBeenCalled())
  return spawn.mock.results[0].value as Engine
}

describe('the terminal’s copy of the cookie jar', () => {
  it('is what the engine is given, and never the app’s own', async () => {
    const engine = await started()
    expect(existsSync(cookiesArg())).toBe(true)
    expect(cookiesArg()).not.toBe(join(h.dir, 'browser-cookies.txt'))
    engine.emit('close', 0)
    await vi.waitFor(() => expect(h.exit).toHaveBeenCalledWith(0))
  })

  it('is gone after a finished run', async () => {
    const engine = await started()
    const copy = cookiesArg()
    engine.emit('close', 0)
    await vi.waitFor(() => expect(h.exit).toHaveBeenCalledWith(0))
    expect(existsSync(copy)).toBe(false)
  })

  it('is gone after a failed one', async () => {
    const engine = await started()
    const copy = cookiesArg()
    engine.stderr.emit('data', Buffer.from('ERROR: unable to download video data: HTTP Error 404: Not Found\n'))
    engine.emit('close', 1)
    await vi.waitFor(() => expect(h.exit).toHaveBeenCalled())
    expect(h.exit.mock.calls[0][0]).not.toBe(0)
    expect(existsSync(copy)).toBe(false)
  })

  it('is gone after Ctrl-C', async () => {
    await started()
    const copy = cookiesArg()
    process.emit('SIGINT')
    await vi.waitFor(() => expect(h.exit).toHaveBeenCalledWith(130))
    expect(existsSync(copy)).toBe(false)
  })

  it('leaves the app’s own jar where it was', async () => {
    const engine = await started()
    engine.emit('close', 0)
    await vi.waitFor(() => expect(h.exit).toHaveBeenCalled())
    expect(readdirSync(h.dir)).toContain('browser-cookies.txt')
  })
})
