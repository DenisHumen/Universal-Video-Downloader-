import { createHash } from 'crypto'
import { EventEmitter } from 'events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { crc32 } from './engine-dist'
import { makeSigner, signDetached, type TestSigner } from './engine-signature.testkit'

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
  spawned: [] as string[][],
  signer: null as unknown as TestSigner
}))

vi.mock('electron', () => ({
  app: { getPath: () => h.dir },
  net: {
    isOnline: () => true,
    request: ({ url }: { url: string }) => {
      const req = Object.assign(new EventEmitter(), { end: vi.fn(), abort: vi.fn() })
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
vi.mock('./engine-keys', () => ({
  get YT_DLP_KEYS() {
    return [h.signer.pinned]
  }
}))
// A mocked module outlives `vi.resetModules`, so the error class it throws has to as well.
vi.mock('./engine-signature', async (importOriginal) => await importOriginal<typeof import('./engine-signature')>())
vi.mock('./log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

h.signer = makeSigner()
const STRANGER = makeSigner()
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
  // Signed as yt-dlp would have, unless the test says what the signature is.
  if (!('SHA2-256SUMS.sig' in overrides)) h.assets.set('SHA2-256SUMS.sig', signDetached(h.assets.get('SHA2-256SUMS') as Buffer, h.signer))
}

/** The checksum list, signed by whom. */
function listed(signer: TestSigner, assets: Record<string, Buffer>): Record<string, Buffer> {
  const list = Buffer.from(Object.entries(assets).map(([name, body]) => `${sum(body)}  ${name}\n`).join(''))
  return { ...assets, 'SHA2-256SUMS': list, 'SHA2-256SUMS.sig': signDetached(list, signer) }
}

async function fresh(): Promise<typeof import('./ytdlp')> {
  vi.resetModules()
  return import('./ytdlp')
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 300))
const realPublic = process.env.PUBLIC
const realLocal = process.env.LOCALAPPDATA
const bin = (): string => join(h.dir, 'UniversalVideoDownloader', 'bin')
const binDir = (): string => (process.platform === 'win32' ? bin() : join(h.dir, 'bin'))
const onefile = (): string => join(binDir(), process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')

beforeEach(() => {
  h.dir = mkdtempSync(join(tmpdir(), 'uvd-onedir-'))
  process.env.LOCALAPPDATA = h.dir
  process.env.PUBLIC = join(h.dir, 'public')
  h.requested = []
  h.spawned = []
  publish()
})

afterEach(() => {
  rmSync(h.dir, { recursive: true, force: true })
  if (realPublic === undefined) delete process.env.PUBLIC
  else process.env.PUBLIC = realPublic
  if (realLocal === undefined) delete process.env.LOCALAPPDATA
  else process.env.LOCALAPPDATA = realLocal
})

describe.runIf(process.platform === 'win32')('leaving the folder every user can change', () => {
  const shared = (): string => join(process.env.PUBLIC as string, 'UniversalVideoDownloader', 'bin')

  it('runs nothing from there, fetches its own copy and leaves the old one for whoever else uses it', async () => {
    mkdirSync(join(shared(), 'yt-dlp-dist-old'), { recursive: true })
    const planted = join(shared(), 'yt-dlp-dist-old', 'yt-dlp_linux')
    writeFileSync(planted, 'somebody else put this here')
    writeFileSync(join(shared(), 'current.json'), JSON.stringify({ dir: 'yt-dlp-dist-old', exe: 'yt-dlp_linux', sha256: 'x' }))
    const m = await fresh()
    const seen: { moving?: boolean; state: string }[] = []
    m.ytdlpEvents.on('status', (status: { moving?: boolean; state: string }) => seen.push(status))

    const path = await m.ensureYtdlp()

    expect(path.startsWith(bin())).toBe(true)
    expect(path.startsWith(process.env.PUBLIC as string)).toBe(false)
    expect(h.requested).toContain('yt-dlp_linux.zip')
    expect(seen.some((status) => status.state === 'downloading' && status.moving)).toBe(true)
    expect(m.getYtdlpStatus()).toMatchObject({ state: 'ready' })
    expect(m.getYtdlpStatus().moving).toBeUndefined()
    expect(readFileSync(planted, 'utf-8')).toBe('somebody else put this here')
    expect(existsSync(join(shared(), 'current.json'))).toBe(true)
  })

  it('says nothing about moving on a machine that never used the old folder', async () => {
    const m = await fresh()
    const seen: { moving?: boolean }[] = []
    m.ytdlpEvents.on('status', (status: { moving?: boolean }) => seen.push(status))
    await m.ensureYtdlp()
    expect(seen.some((status) => status.moving)).toBe(false)
  })

  it('does not fetch again once its own copy is there', async () => {
    mkdirSync(shared(), { recursive: true })
    await (await fresh()).ensureYtdlp()
    h.requested = []
    await expect((await fresh()).ensureYtdlp()).resolves.toContain('yt-dlp-dist-')
    expect(h.requested).toEqual([])
  })
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
    await vi.waitFor(() => expect(m.ytdlpBinaryPath()).toContain('yt-dlp-dist-'), { timeout: 8000 })
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
    const again = await fresh()
    await again.ensureYtdlp()
    await again.__migrationSettled()
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
    await n.__migrationSettled()
    expect(existsSync(onefile())).toBe(true)
    expect(n.ytdlpBinaryPath()).toBe(onefile())
  })

  it('never touches a working single file when the migration fails', async () => {
    mkdirSync(binDir(), { recursive: true })
    writeFileSync(onefile(), ONEFILE)
    publish({ 'yt-dlp_linux.zip': 403, 'yt-dlp_linux': Buffer.from('a different single file') })
    const m = await fresh()
    await m.ensureYtdlp()
    await m.__migrationSettled()
    expect(h.requested).not.toContain('yt-dlp_linux')
    expect(readFileSync(onefile()).equals(ONEFILE)).toBe(true)
  })

  it('checks a single file against the signed list while the onedir build is backing off', async () => {
    mkdirSync(binDir(), { recursive: true })
    writeFileSync(onefile(), ONEFILE)
    writeFileSync(join(binDir(), 'migration-failed'), JSON.stringify({ at: Date.now(), count: 1 }))
    const m = await fresh()
    await m.ensureYtdlp()
    h.requested = []
    await m.updateYtdlp(() => false)
    expect(h.spawned.some((args) => args.includes('-U'))).toBe(false)
    expect(h.requested).toEqual(['SHA2-256SUMS', 'SHA2-256SUMS.sig'])

    const newer = Buffer.from('newer single file '.repeat(80_000))
    publish(listed(h.signer, { 'yt-dlp_linux': newer }))
    await m.updateYtdlp(() => false)
    expect(h.spawned.some((args) => args.includes('-U'))).toBe(false)
    expect(readFileSync(onefile()).equals(newer)).toBe(true)
  })

  it('will not replace a single file with one the signed list does not vouch for', async () => {
    mkdirSync(binDir(), { recursive: true })
    writeFileSync(onefile(), ONEFILE)
    writeFileSync(join(binDir(), 'migration-failed'), JSON.stringify({ at: Date.now(), count: 1 }))
    const m = await fresh()
    await m.ensureYtdlp()
    const list = listed(h.signer, { 'yt-dlp_linux': Buffer.from('what the list vouches for') })
    publish({ ...list, 'yt-dlp_linux': Buffer.from('what is actually served') })
    await expect(m.updateYtdlp(() => false)).rejects.toThrow(/authenticity check failed/)
    expect(readFileSync(onefile()).equals(ONEFILE)).toBe(true)
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
    await m.__migrationSettled()
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
    // Already current: the checksum list and its signature are all that was fetched.
    expect(h.requested).toEqual(['SHA2-256SUMS', 'SHA2-256SUMS.sig'])

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

describe('a release that cannot be shown to be yt-dlp’s', () => {
  const EVIL = zipOf({ 'yt-dlp_linux': 'not from yt-dlp' })
  const LIST = Buffer.from(`${sum(EVIL)}  yt-dlp_linux.zip\n${sum(EVIL)}  yt-dlp_linux\n`)
  const GENUINE = signDetached(Buffer.from('the list yt-dlp really signed\n'), h.signer)

  /** Everyone who could replace the engine, each with one way of getting it wrong. */
  const WAYS: [string, Partial<Record<string, Buffer | number>>][] = [
    ['a list changed after signing', { 'SHA2-256SUMS': LIST, 'SHA2-256SUMS.sig': GENUINE }],
    ['a signature by another key', { 'SHA2-256SUMS': LIST, 'SHA2-256SUMS.sig': signDetached(LIST, STRANGER) }],
    ['no signature', { 'SHA2-256SUMS': LIST, 'SHA2-256SUMS.sig': 404 }],
    ['a page instead of a signature', { 'SHA2-256SUMS': LIST, 'SHA2-256SUMS.sig': Buffer.from('<html>Wi-Fi sign-in</html>') }]
  ]

  const nothingFetched = (): void => {
    expect(h.requested).not.toContain('yt-dlp_linux.zip')
    expect(h.requested).not.toContain('yt-dlp_linux')
  }

  it.each(WAYS)('refuses a first install over %s, runs nothing and leaves nothing to run', async (_name, release) => {
    publish(release)
    const m = await fresh()
    await expect(m.ensureYtdlp()).rejects.toThrow(/authenticity check failed/)
    nothingFetched()
    expect(h.spawned).toEqual([])
    expect(existsSync(onefile())).toBe(false)
    expect(existsSync(join(binDir(), 'current.json'))).toBe(false)
    expect(existsSync(join(binDir(), 'migration-failed'))).toBe(false)
    expect(m.getYtdlpStatus()).toMatchObject({ state: 'error', message: expect.stringMatching(/authenticity/) })
  })

  it('offers nothing on a retry either, and installs once the release is good again', async () => {
    publish(WAYS[0][1])
    const m = await fresh()
    await expect(m.ensureYtdlp()).rejects.toThrow(/authenticity/)
    await expect(m.ensureYtdlp()).rejects.toThrow(/authenticity/)
    expect(h.spawned).toEqual([])
    publish()
    await expect(m.ensureYtdlp()).resolves.toContain('yt-dlp-dist-')
  })

  it('refuses a zip that is not the one the signed list names, and does not unpack or try the single file', async () => {
    publish({ 'yt-dlp_linux.zip': EVIL })
    const m = await fresh()
    await expect(m.ensureYtdlp()).rejects.toThrow(/authenticity check failed.*checksum/)
    expect(h.requested).not.toContain('yt-dlp_linux')
    expect(h.spawned).toEqual([])
    expect(existsSync(join(binDir(), 'current.json'))).toBe(false)
  })

  it('stops reading a checksum list that goes on far too long', async () => {
    publish({ 'SHA2-256SUMS': Buffer.alloc(2 * 1024 * 1024), 'SHA2-256SUMS.sig': GENUINE })
    const m = await fresh()
    await expect(m.ensureYtdlp()).rejects.toThrow(/far more than a checksum list/)
    expect(existsSync(onefile())).toBe(false)
  })

  it('calls an unreachable signature a connection problem, not a forgery', async () => {
    publish({ 'SHA2-256SUMS.sig': 503 })
    const m = await fresh()
    await expect(m.ensureYtdlp()).rejects.toThrow(/HTTP 503/)
    expect(existsSync(onefile())).toBe(false)
  })

  it.each(WAYS)('keeps the working engine when the button meets %s, and says so', async (_name, release) => {
    const m = await fresh()
    const active = await m.ensureYtdlp()
    publish(release)
    h.requested = []
    h.spawned = []

    await expect(m.updateYtdlp(() => false)).rejects.toThrow(/authenticity check failed/)

    nothingFetched()
    expect(m.ytdlpBinaryPath()).toBe(active)
    expect(readFileSync(active, 'utf-8')).toBe('onedir engine')
    expect(m.getYtdlpStatus()).toMatchObject({ state: 'ready', version: 'onedir', refused: true })
    // Not a build that fails here, so the next attempt is not put off for a month.
    expect(existsSync(join(binDir(), 'migration-failed'))).toBe(false)
  })

  it('keeps the working engine on the daily refresh, remembers it over a restart, and clears it once a good update lands', async () => {
    const m = await fresh()
    const active = await m.ensureYtdlp()
    publish(WAYS[1][1])

    await m.refreshEngineIfDue(() => false)
    expect(m.ytdlpBinaryPath()).toBe(active)
    expect(m.getYtdlpStatus()).toMatchObject({ state: 'ready', refused: true })

    const after = await fresh()
    await after.ensureYtdlp()
    expect(after.getYtdlpStatus()).toMatchObject({ state: 'ready', version: 'onedir', refused: true })

    publish()
    await after.updateYtdlp(() => false)
    expect(after.getYtdlpStatus().refused).toBeUndefined()
  })

  it('leaves a working single file in use when its move to onedir is refused', async () => {
    mkdirSync(binDir(), { recursive: true })
    writeFileSync(onefile(), ONEFILE)
    publish(WAYS[2][1])
    const m = await fresh()
    await expect(m.ensureYtdlp()).resolves.toBe(onefile())
    await vi.waitFor(() => expect(m.getYtdlpStatus().refused).toBe(true), { timeout: 8000 })
    expect(m.ytdlpBinaryPath()).toBe(onefile())
    expect(readFileSync(onefile()).equals(ONEFILE)).toBe(true)
    expect(existsSync(join(binDir(), 'migration-failed'))).toBe(false)
  })
})
