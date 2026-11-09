import { createHash } from 'crypto'
import { EventEmitter } from 'events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { crc32 } from './engine-dist'

/*
  Fetching the runtime, with a pretend GitHub serving a real zip and a real
  archive-to-disk path. The guarantee under test: whatever goes wrong on the way,
  the engine and every ordinary download go on as they were, and a file that has
  not passed its checksum and started is never handed to the engine.
*/

const h = vi.hoisted(() => ({
  dir: '',
  body: undefined as Buffer | number | undefined,
  sha: '',
  requested: [] as string[],
  statuses: [] as string[],
  spawned: [] as { bin: string; args: string[] }[],
  online: true
}))

vi.mock('electron', () => ({
  app: { getPath: () => h.dir },
  net: {
    isOnline: () => h.online,
    request: ({ url }: { url: string }) => {
      const req = Object.assign(new EventEmitter(), { end: vi.fn() })
      req.end.mockImplementation(() => {
        h.requested.push(url)
        const body = h.body ?? 404
        const res = Object.assign(new EventEmitter(), {
          statusCode: typeof body === 'number' ? body : 200,
          headers: { 'content-length': typeof body === 'number' ? '0' : String(body.length) }
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
    h.spawned.push({ bin, args })
    const stream = (): EventEmitter & { setEncoding: () => void } =>
      Object.assign(new EventEmitter(), { setEncoding: () => undefined })
    const child = Object.assign(new EventEmitter(), { stdout: stream(), stderr: stream(), kill: vi.fn() })
    queueMicrotask(() => {
      const text = existsSync(bin) ? readFileSync(bin, 'utf-8') : ''
      if (text.startsWith('broken')) return child.emit('close', 1)
      child.stdout.emit('data', text.startsWith('deno') ? `${text}\n` : '2026.10.26\n')
      child.emit('close', 0)
    })
    return child
  })
}))
vi.mock('./js-runtime', async (importOriginal) => {
  const real = await importOriginal<typeof import('./js-runtime')>()
  return {
    ...real,
    denoPin: () => ({ asset: 'deno-test.zip', get sha256() { return h.sha } }),
    denoOnPath: () => null,
    denoDirName: () => 'deno-2.9.8-test'
  }
})
vi.mock('./log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('./settings', () => ({ getSettings: () => ({}) }))
vi.mock('./proxy-auth', () => ({ proxyUrl: () => '', withProxyAuth: <T>(req: T) => req }))

function zipOf(n: string, text: string): Buffer {
  const name = Buffer.from(n)
  const data = Buffer.from(text)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt32LE(crc32(data), 14)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(name.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt8(3, 5)
  central.writeUInt32LE(crc32(data), 16)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(name.length, 28)
  central.writeUInt32LE((0o100755 << 16) >>> 0, 38)
  const body = Buffer.concat([local, name, data])
  const cd = Buffer.concat([central, name])
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(body.length, 16)
  return Buffer.concat([body, cd, eocd])
}

const sum = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
const EXE = process.platform === 'win32' ? 'deno.exe' : 'deno'
const GOOD = zipOf(EXE, 'deno 2.9.8 (stable, release, test)')

const base = (): string => (process.platform === 'win32' ? join(h.dir, 'UniversalVideoDownloader') : h.dir)
const root = (): string => join(base(), 'js-runtime')
const exe = (): string => join(root(), 'deno-2.9.8-test', EXE)

async function fresh(): Promise<{ ytdlp: typeof import('./ytdlp'); runtime: typeof import('./js-runtime') }> {
  vi.resetModules()
  const runtime = await import('./js-runtime')
  // A real module reached through `importOriginal` outlives the reset, and a launch starts with none chosen.
  runtime.useJsRuntime(null)
  const ytdlp = await import('./ytdlp')
  ytdlp.ytdlpEvents.on('status', (s: { state: string }) => h.statuses.push(s.state))
  return { ytdlp, runtime }
}

const realLocal = process.env.LOCALAPPDATA

beforeEach(() => {
  h.dir = mkdtempSync(join(tmpdir(), 'uvd-runtime-'))
  process.env.LOCALAPPDATA = h.dir
  h.body = GOOD
  h.sha = sum(GOOD)
  h.requested = []
  h.statuses = []
  h.spawned = []
  h.online = true
})

afterEach(() => {
  rmSync(h.dir, { recursive: true, force: true })
  if (realLocal === undefined) delete process.env.LOCALAPPDATA
  else process.env.LOCALAPPDATA = realLocal
})

describe('fetching the runtime', () => {
  it('puts a verified copy in the private folder and hands it to the engine, without a word on its card', async () => {
    const { ytdlp, runtime } = await fresh()
    expect(runtime.withJsRuntime([])).toEqual(['--no-js-runtimes'])

    await ytdlp.ensureJsRuntime()

    expect(existsSync(exe())).toBe(true)
    expect(runtime.withJsRuntime(['-J'])).toEqual(['--js-runtimes', `deno:${exe()}`, '-J'])
    expect(h.requested).toHaveLength(1)
    expect(h.requested[0]).toMatch(/\/releases\/download\/v[\d.]+\/deno-test\.zip$/)
    expect(h.statuses).toEqual([])
    // Nothing left beside it, and the unpacked file was started before anything used it.
    expect(readdirSync(root())).toEqual(['deno-2.9.8-test'])
    expect(h.spawned[0].args).toEqual(['--version'])
  })

  it('refuses an archive that is not the pinned one, and uses nothing from it', async () => {
    h.sha = 'a'.repeat(64)
    const { ytdlp, runtime } = await fresh()
    await expect(ytdlp.ensureJsRuntime()).resolves.toBeUndefined()
    expect(existsSync(exe())).toBe(false)
    expect(h.spawned).toEqual([])
    expect(runtime.withJsRuntime([])).toEqual(['--no-js-runtimes'])
    expect(readdirSync(root())).toEqual(['fetch-failed'])
  })

  it('does not use a copy that will not start here, as on a Linux too old for the build', async () => {
    h.body = zipOf(EXE, 'broken')
    h.sha = sum(h.body)
    const { ytdlp, runtime } = await fresh()
    await ytdlp.ensureJsRuntime()
    expect(existsSync(exe())).toBe(false)
    expect(runtime.withJsRuntime([])).toEqual(['--no-js-runtimes'])
  })

  it('does not use a file of another version', async () => {
    h.body = zipOf(EXE, 'deno 2.3.0 (stable, release, test)')
    h.sha = sum(h.body)
    const { ytdlp } = await fresh()
    await ytdlp.ensureJsRuntime()
    expect(existsSync(exe())).toBe(false)
  })

  it('leaves the engine alone when the download fails, and waits before the next try', async () => {
    h.body = 503
    const { ytdlp } = await fresh()
    await expect(ytdlp.ensureJsRuntime()).resolves.toBeUndefined()
    expect(existsSync(join(root(), 'fetch-failed'))).toBe(true)
    expect(h.statuses).toEqual([])

    h.requested = []
    h.body = GOOD
    await (await fresh()).ytdlp.ensureJsRuntime()
    expect(h.requested).toEqual([])
  })

  it('tries again once the wait is over, and then forgets the failure', async () => {
    mkdirSync(root(), { recursive: true })
    writeFileSync(join(root(), 'fetch-failed'), JSON.stringify({ at: 0, count: 1 }))
    const { ytdlp } = await fresh()
    await ytdlp.ensureJsRuntime()
    expect(existsSync(exe())).toBe(true)
    expect(existsSync(join(root(), 'fetch-failed'))).toBe(false)
  })

  it('counts nothing against the next try while offline', async () => {
    h.online = false
    const { ytdlp } = await fresh()
    await ytdlp.ensureJsRuntime()
    expect(h.requested).toEqual([])
    expect(existsSync(join(root(), 'fetch-failed'))).toBe(false)
  })

  it('fetches nothing on the next launch, and passes the copy to the engine from its first start', async () => {
    await (await fresh()).ytdlp.ensureJsRuntime()
    h.requested = []
    const { ytdlp, runtime } = await fresh()
    await ytdlp.ensureJsRuntime()
    expect(h.requested).toEqual([])
    expect(runtime.withJsRuntime([])).toEqual(['--js-runtimes', `deno:${exe()}`])
  })

  it('fetches a damaged copy again', async () => {
    await (await fresh()).ytdlp.ensureJsRuntime()
    writeFileSync(exe(), 'broken')
    h.requested = []
    await (await fresh()).ytdlp.ensureJsRuntime()
    expect(h.requested).toHaveLength(1)
    expect(readFileSync(exe(), 'utf-8')).toContain('deno 2.9.8')
  })

  it('clears what an earlier pin and a crash left, and keeps the cache', async () => {
    mkdirSync(join(root(), 'deno-2.9.7-old'), { recursive: true })
    mkdirSync(join(root(), '.unpack-abc'), { recursive: true })
    mkdirSync(join(root(), 'cache'), { recursive: true })
    writeFileSync(join(root(), 'deno-test.zip.download'), 'cut short')
    await (await fresh()).ytdlp.ensureJsRuntime()
    expect(readdirSync(root()).sort()).toEqual(['cache', 'deno-2.9.8-test'])
  })

  it('shares one fetch between callers', async () => {
    const { ytdlp } = await fresh()
    await Promise.all([ytdlp.ensureJsRuntime(), ytdlp.ensureJsRuntime()])
    expect(h.requested).toHaveLength(1)
  })
})

describe('the engine itself', () => {
  it('keeps its cache in the private folder, never a shared one', async () => {
    const { ytdlp } = await fresh()
    const env = ytdlp.ytdlpSpawnOptions().env
    expect(env.DENO_DIR).toBe(join(root(), 'cache'))
    expect(env.DENO_NO_UPDATE_CHECK).toBe('1')
  })
})
