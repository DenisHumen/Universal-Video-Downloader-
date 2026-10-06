import { EventEmitter } from 'events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
  The scheduled engine refresh as it is, with a pretend yt-dlp and a pretend
  GitHub around it. The bug this guards against: engine.json was stamped
  "refreshed" whatever `yt-dlp -U` answered, so an attempt refused by GitHub or
  made with no network counted as the day's refresh.
*/

const h = vi.hoisted(() => ({
  dir: '',
  online: true,
  /** Exit code of `yt-dlp -U`. */
  selfUpdate: 0,
  /** HTTP status of the fresh download. */
  download: 200,
  /** Called between `-U` finishing and the fallback deciding. */
  afterSelfUpdate: () => undefined as void,
  spawned: [] as string[][],
  /** Binary downloads requested so far. */
  requests: 0,
  /** While set, every download waits for it before GitHub answers. */
  gate: null as Promise<void> | null
}))

vi.mock('electron', () => ({
  app: { getPath: () => h.dir },
  net: {
    isOnline: () => h.online,
    request: () => {
      const req = Object.assign(new EventEmitter(), { end: vi.fn() })
      req.end.mockImplementation(() => {
        h.requests++
        const res = Object.assign(new EventEmitter(), {
          statusCode: h.download,
          headers: { 'content-length': '7' }
        })
        const respond = (): void => {
          req.emit('response', res)
          if (h.download >= 400) return
          res.emit('data', Buffer.from('fresh!\n'))
          res.emit('end')
        }
        if (h.gate) void h.gate.then(respond)
        else queueMicrotask(respond)
      })
      return req
    }
  },
  powerMonitor: { on: vi.fn(), off: vi.fn() }
}))
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    execFileSync: vi.fn(),
    spawn: vi.fn((_bin: string, args: string[]) => {
      h.spawned.push(args)
      const stream = (): EventEmitter & { setEncoding: () => void } =>
        Object.assign(new EventEmitter(), { setEncoding: () => undefined })
      const child = Object.assign(new EventEmitter(), { stdout: stream(), stderr: stream() })
      queueMicrotask(() => {
        if (args.includes('-U')) {
          h.afterSelfUpdate()
          child.emit('close', h.selfUpdate)
        } else {
          child.stdout.emit('data', '2026.10.01\n')
          child.emit('close', 0)
        }
      })
      return child
    })
  }
})
vi.mock('./log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('./settings', () => ({ getSettings: () => ({}) }))
vi.mock('./proxy-auth', () => ({ proxyUrl: () => '', withProxyAuth: <T>(req: T) => req }))

import { getYtdlpStatus, refreshEngineIfDue, ytdlpBinaryPath } from './ytdlp'

const HOUR = 60 * 60 * 1000
const realPublic = process.env.PUBLIC

function engineJson(): { lastRefresh?: number; lastFailure?: number; failures?: number } {
  const file = join(h.dir, 'engine.json')
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : {}
}

function selfUpdates(): number {
  return h.spawned.filter((args) => args.includes('-U')).length
}

beforeEach(() => {
  h.dir = mkdtempSync(join(tmpdir(), 'uvd-engine-'))
  // On Windows the engine lives under %PUBLIC%, elsewhere under userData.
  process.env.PUBLIC = h.dir
  h.online = true
  h.selfUpdate = 0
  h.download = 200
  h.afterSelfUpdate = () => undefined
  h.spawned = []
  h.requests = 0
  h.gate = null
  const bin = ytdlpBinaryPath()
  mkdirSync(dirname(bin), { recursive: true })
  writeFileSync(bin, 'old\n')
})

afterEach(() => {
  rmSync(h.dir, { recursive: true, force: true })
  if (realPublic === undefined) delete process.env.PUBLIC
  else process.env.PUBLIC = realPublic
})

describe('refreshEngineIfDue', () => {
  it('records a refresh when the self-update succeeds', async () => {
    const before = Date.now()
    await refreshEngineIfDue(() => false)
    expect(selfUpdates()).toBe(1)
    expect(engineJson().lastRefresh).toBeGreaterThanOrEqual(before)
    expect(engineJson().failures).toBe(0)
  })

  it('records a refresh after a failed self-update only once the fresh download worked', async () => {
    h.selfUpdate = 100
    await refreshEngineIfDue(() => false)
    expect(readFileSync(ytdlpBinaryPath(), 'utf-8')).toBe('fresh!\n')
    expect(engineJson().lastRefresh).toBeGreaterThan(0)
    expect(getYtdlpStatus()).toMatchObject({ state: 'ready', version: '2026.10.01' })
  })

  it('does not record a refresh when both fail, and backs off instead of reporting an error', async () => {
    const old = Date.now() - 3 * 24 * HOUR
    writeFileSync(join(h.dir, 'engine.json'), JSON.stringify({ lastRefresh: old }))
    const status = getYtdlpStatus()
    h.selfUpdate = 100
    h.download = 403

    await refreshEngineIfDue(() => false)

    expect(engineJson()).toMatchObject({ lastRefresh: old, failures: 1 })
    expect(readFileSync(ytdlpBinaryPath(), 'utf-8')).toBe('old\n')
    expect(getYtdlpStatus()).toEqual(status)

    // The next hourly tick leaves it alone; the backoff decides when to try again.
    await refreshEngineIfDue(() => false)
    expect(selfUpdates()).toBe(1)
  })

  it('does not replace the file when a download started while the self-update ran', async () => {
    let busy = false
    h.selfUpdate = 1
    h.afterSelfUpdate = () => {
      busy = true
    }
    await refreshEngineIfDue(() => busy)
    expect(readFileSync(ytdlpBinaryPath(), 'utf-8')).toBe('old\n')
    // Not a failure either: nothing was tried, so the next tick may try.
    expect(engineJson()).toEqual({})
  })

  it('tries nothing offline, and counts nothing against the next attempt', async () => {
    h.online = false
    await refreshEngineIfDue(() => false)
    expect(h.spawned).toEqual([])
    expect(engineJson()).toEqual({})
  })

  it('waits a day after a good refresh', async () => {
    writeFileSync(join(h.dir, 'engine.json'), JSON.stringify({ lastRefresh: Date.now() - HOUR }))
    await refreshEngineIfDue(() => false)
    expect(h.spawned).toEqual([])
  })

  it('runs one refresh at a time', async () => {
    await Promise.all([refreshEngineIfDue(() => false), refreshEngineIfDue(() => false)])
    expect(selfUpdates()).toBe(1)
  })
})

/*
  Three paths replace the binary - ensureYtdlp, the scheduled refresh and the
  button in Settings - and each one used to be careful only about the others
  some of the time. These start from a fresh copy of the module, because
  `ensureYtdlp` remembers its answer for the rest of the session.
*/
describe('replacing the engine from more than one place', () => {
  async function fresh(): Promise<typeof import('./ytdlp')> {
    vi.resetModules()
    return import('./ytdlp')
  }

  /** Holds every download until `release` is called. */
  function holdDownloads(): () => void {
    let release!: () => void
    h.gate = new Promise((resolve) => (release = resolve))
    return release
  }

  /** Long enough for the spawned processes and the code after them to run. */
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20))

  it('the scheduled refresh waits while ensureYtdlp replaces an engine that will not start', async () => {
    const m = await fresh()
    const release = holdDownloads()
    // `-U` on the broken file fails, and its fallback used to download over ensureYtdlp's copy.
    h.selfUpdate = 100

    // The file on disk is too small to be an engine, so ensureYtdlp downloads a new one.
    const ensured = m.ensureYtdlp()
    const refreshed = m.refreshEngineIfDue(() => false)
    await settle()
    expect(selfUpdates()).toBe(0)
    expect(h.requests).toBe(1)

    release()
    await expect(ensured).resolves.toBe(m.ytdlpBinaryPath())
    await refreshed
    expect(readFileSync(m.ytdlpBinaryPath(), 'utf-8')).toBe('fresh!\n')
    expect(m.getYtdlpStatus()).toMatchObject({ state: 'ready', version: '2026.10.01' })
  })

  it('a second download waits for the one already on its way instead of writing the same file', async () => {
    const m = await fresh()
    const release = holdDownloads()
    h.selfUpdate = 100

    const ensured = m.ensureYtdlp()
    // The button does not wait for ensureYtdlp; its fallback must not start a download of its own.
    const updated = m.updateYtdlp(() => false)
    await settle()
    expect(selfUpdates()).toBe(1)
    expect(h.requests).toBe(1)

    release()
    await expect(ensured).resolves.toBe(m.ytdlpBinaryPath())
    await expect(updated).resolves.toBe('2026.10.01')
    expect(h.requests).toBe(1)
    expect(readFileSync(m.ytdlpBinaryPath(), 'utf-8')).toBe('fresh!\n')
  })

  it('the button looks for a running download again after waiting on a refresh that failed', async () => {
    const m = await fresh()
    const release = holdDownloads()
    let busy = false
    h.selfUpdate = 100
    h.download = 403

    const refreshed = m.refreshEngineIfDue(() => busy)
    await settle()
    // `-U` failed and the fallback download is waiting on GitHub.
    expect(selfUpdates()).toBe(1)

    // Nothing is running when the button is pressed; a download starts while it waits.
    const refused = expect(m.updateYtdlp(() => busy)).rejects.toMatchObject({ code: 'engineBusy' })
    busy = true
    release()
    await refreshed

    await refused
    expect(selfUpdates()).toBe(1)
    expect(readFileSync(m.ytdlpBinaryPath(), 'utf-8')).toBe('old\n')
  })
})
