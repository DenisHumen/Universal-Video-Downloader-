import { createHash } from 'crypto'
import { EventEmitter } from 'events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { crc32 } from './engine-dist'

/*
  Moving to the onedir engine, with a pretend GitHub serving a real zip.

  The guarantee under test: the single file keeps working until a onedir copy
  has been unpacked, started and switched to, so no failure on the way leaves
  the app without an engine.
*/

const h = vi.hoisted(() => ({
  dir: '',
  /** What each release asset answers: a body, or an HTTP status. */
  assets: new Map<string, Buffer | number>(),
  requested: [] as string[],
  spawned: [] as string[][]
}))

vi.mock('electron', () => ({
  app: { getPath: () => h.dir },
  net: {
    isOnline: () => true,
    request: ({ url }: { url: string }) => {
      const req = Object.assign(new EventEmitter(), { end: vi.fn() })
      req.end.mockImplementation(() => {
        const name = url.split('/').pop() as string
        h.requested.push(name)
        const body = h.assets.get(name) ?? 404
        const res = Object.assign(new EventEmitter(), {
          statusCode: typeof body === 'number' ? body : 200,
          headers: {}
        })
        queueMicrotask(() => {
          req.emit('response', res)
          if (typeof body === 'number') return
          res.emit('data', body)
          res.emit('end')
        })
      })
      return req
    }
  },
  powerMonitor: { on: vi.fn() }
}))
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  execFileSync: vi.fn(),
  spawn: vi.fn((bin: string, args: string[]) => {
    h.spawned.push(args)
    const stream = (): EventEmitter & { setEncoding: () => void } =>
      Object.assign(new EventEmitter(), { setEncoding: () => undefined })
    const child = Object.assign(new EventEmitter(), { stdout: stream(), stderr: stream() })
    queueMicrotask(() => {
      // A file the test wrote as "broken" will not start; anything else answers its version.
      if (existsSync(bin) && readFileSync(bin, 'utf-8').startsWith('broken')) {
        child.emit('close', 1)
        return
      }
      child.stdout.emit('data', bin.includes('yt-dlp-dist-') ? 'onedir\n' : 'onefile\n')
      child.emit('close', 0)
    })
    return child
  })
}))
vi.mock('./engine-dist', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./engine-dist')>()),
  engineAssets: () => ({ onedir: { zip: 'yt-dlp_linux.zip', exe: 'yt-dlp_linux' }, onefile: 'yt-dlp_linux' })
}))
vi.mock('./log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('./settings', () => ({ getSettings: () => ({}) }))
vi.mock('./proxy-auth', () => ({ proxyUrl: () => '', withProxyAuth: <T>(req: T) => req }))

/** A stored (uncompressed) zip of these files. */
function zipOf(files: Record<string, string>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [n, text] of Object.entries(files)) {
    const name = Buffer.from(n)
    const data = Buffer.from(text)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt32LE(crc32(data), 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt8(3, 5)
    central.writeUInt32LE(crc32(data), 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE((0o100755 << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += 30 + name.length + data.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(Object.keys(files).length, 8)
  eocd.writeUInt16LE(Object.keys(files).length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

const sum = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
const ZIP = zipOf({ 'yt-dlp_linux': 'onedir engine', '_internal/lib': 'x' })
const ONEFILE = Buffer.from('onefile engine '.repeat(80_000))

function publish(overrides: Partial<Record<string, Buffer | number>> = {}): void {
  h.assets = new Map<string, Buffer | number>([
    ['yt-dlp_linux.zip', ZIP],
    ['yt-dlp_linux', ONEFILE],
    ['SHA2-256SUMS', Buffer.from(`${sum(ZIP)}  yt-dlp_linux.zip\n${sum(ONEFILE)}  yt-dlp_linux\n`)]
  ])
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined) h.assets.set(k, v)
}

async function fresh(): Promise<typeof import('./ytdlp')> {
  vi.resetModules()
  return import('./ytdlp')
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30))
const realPublic = process.env.PUBLIC
const bin = (): string => join(h.dir, 'UniversalVideoDownloader', 'bin')
const binDir = (): string => (process.platform === 'win32' ? bin() : join(h.dir, 'bin'))
const onefile = (): string => join(binDir(), process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')

beforeEach(() => {
  h.dir = mkdtempSync(join(tmpdir(), 'uvd-onedir-'))
  process.env.PUBLIC = h.dir
  h.requested = []
  h.spawned = []
  publish()
})

afterEach(() => {
  rmSync(h.dir, { recursive: true, force: true })
  if (realPublic === undefined) delete process.env.PUBLIC
  else process.env.PUBLIC = realPublic
})

describe('the onedir engine', () => {
  it('is what a first launch installs', async () => {
    const m = await fresh()
    const path = await m.ensureYtdlp()
    expect(path).toContain('yt-dlp-dist-')
    expect(m.ytdlpBinaryPath()).toBe(path)
    expect(h.requested).not.toContain('yt-dlp_linux')
  })

  it('replaces a working single file behind its back, which stays in use until then', async () => {
    mkdirSync(binDir(), { recursive: true })
    writeFileSync(onefile(), ONEFILE)
    const m = await fresh()
    // Ready at once, on the engine that already works.
    await expect(m.ensureYtdlp()).resolves.toBe(onefile())
    await settle()
    expect(m.ytdlpBinaryPath()).toContain('yt-dlp-dist-')
    expect(m.getYtdlpStatus()).toMatchObject({ state: 'ready', version: 'onedir' })
    // The single file goes at the next launch's clean-up, not while it may be running.
    expect(existsSync(onefile())).toBe(true)
    await (await fresh()).ensureYtdlp()
    expect(existsSync(onefile())).toBe(false)
  })

  it('keeps the single file when the migration fails, and waits a day before trying again', async () => {
    mkdirSync(binDir(), { recursive: true })
    writeFileSync(onefile(), ONEFILE)
    publish({ 'yt-dlp_linux.zip': 403 })
    const m = await fresh()
    await m.ensureYtdlp()
    // Thirty milliseconds was not always enough on the slowest build machine.
    await vi.waitFor(() => expect(existsSync(join(binDir(), 'migration-failed'))).toBe(true), { timeout: 8000 })
    expect(m.ytdlpBinaryPath()).toBe(onefile())

    h.requested = []
    await (await fresh()).ensureYtdlp()
    await settle()
    expect(h.requested).toEqual([])
  })

  it('keeps running the single file beside a onedir copy that will not start', async () => {
    const m = await fresh()
    await m.ensureYtdlp()
    const dist = m.ytdlpBinaryPath()
    writeFileSync(dist, 'broken now')
    writeFileSync(onefile(), ONEFILE)
    publish({ 'yt-dlp_linux.zip': 403 })

    const n = await fresh()
    await expect(n.ensureYtdlp()).resolves.toBe(onefile())
    await settle()
    expect(existsSync(onefile())).toBe(true)
    expect(n.ytdlpBinaryPath()).toBe(onefile())
  })

  it('never touches a working single file when the migration fails', async () => {
    mkdirSync(binDir(), { recursive: true })
    writeFileSync(onefile(), ONEFILE)
    publish({ 'yt-dlp_linux.zip': 403, 'yt-dlp_linux': Buffer.from('a different single file') })
    const m = await fresh()
    await m.ensureYtdlp()
    await settle()
    expect(h.requested).not.toContain('yt-dlp_linux')
    expect(readFileSync(onefile()).equals(ONEFILE)).toBe(true)
  })

  it('updates a single file with -U while the onedir build is backing off, fetching nothing', async () => {
    mkdirSync(binDir(), { recursive: true })
    writeFileSync(onefile(), ONEFILE)
    writeFileSync(join(binDir(), 'migration-failed'), JSON.stringify({ at: Date.now(), count: 1 }))
    const m = await fresh()
    await m.ensureYtdlp()
    h.requested = []
    await m.updateYtdlp(() => false)
    expect(h.spawned.some((args) => args.includes('-U'))).toBe(true)
    expect(h.requested).toEqual([])
  })

  it('does not fetch a newer onedir build every day once one failed to start', async () => {
    const m = await fresh()
    await m.ensureYtdlp()
    const active = m.ytdlpBinaryPath()
    const broken = zipOf({ 'yt-dlp_linux': 'broken build' })
    publish({ 'yt-dlp_linux.zip': broken, 'SHA2-256SUMS': Buffer.from(`${sum(broken)}  yt-dlp_linux.zip\n`) })
    await expect(m.updateYtdlp(() => false)).rejects.toThrow()
    expect(m.ytdlpBinaryPath()).toBe(active)

    h.requested = []
    await m.updateYtdlp(() => false)
    expect(h.requested).toEqual([])
    expect(m.ytdlpBinaryPath()).toBe(active)
  })

  it('never switches to a copy that does not match its checksum', async () => {
    mkdirSync(binDir(), { recursive: true })
    writeFileSync(onefile(), ONEFILE)
    publish({ 'yt-dlp_linux.zip': zipOf({ 'yt-dlp_linux': 'tampered' }) })
    const m = await fresh()
    await m.ensureYtdlp()
    await settle()
    expect(m.ytdlpBinaryPath()).toBe(onefile())
  })

  it('falls back to the single file when there is no engine and the onedir copy cannot be had', async () => {
    publish({ 'yt-dlp_linux.zip': 500 })
    const m = await fresh()
    await expect(m.ensureYtdlp()).resolves.toBe(onefile())
    expect(readFileSync(onefile()).equals(ONEFILE)).toBe(true)
  })

  it('updates by checksum, since a onedir copy cannot update itself', async () => {
    const m = await fresh()
    await m.ensureYtdlp()
    h.requested = []
    await m.updateYtdlp(() => false)
    // Already current: the checksum list is all that was fetched.
    expect(h.requested).toEqual(['SHA2-256SUMS'])

    const next = zipOf({ 'yt-dlp_linux': 'newer onedir engine' })
    publish({
      'yt-dlp_linux.zip': next,
      'SHA2-256SUMS': Buffer.from(`${sum(next)}  yt-dlp_linux.zip\n`)
    })
    const before = m.ytdlpBinaryPath()
    await m.updateYtdlp(() => false)
    expect(m.ytdlpBinaryPath()).not.toBe(before)
    expect(readFileSync(m.ytdlpBinaryPath(), 'utf-8')).toBe('newer onedir engine')
  })
})
