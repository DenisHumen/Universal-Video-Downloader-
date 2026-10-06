import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
  settings.json on disk, through the real settings module: what happens when
  it is damaged, locked, or when Electron cannot say where Downloads is. Each
  of these used to end with every setting the user had made replaced by a
  default, or the app not starting at all.
*/

const h = vi.hoisted(() => ({
  dir: '',
  busy: '',
  noDownloads: false,
  keyStore: false
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'downloads' && h.noDownloads) throw new Error('Failed to get downloads path')
      return name === 'downloads' ? join(h.dir, 'Downloads') : h.dir
    }
  },
  safeStorage: {
    isEncryptionAvailable: () => h.keyStore,
    encryptString: (value: string) => Buffer.from(`sealed:${value}`),
    decryptString: (blob: Buffer) => blob.toString().slice('sealed:'.length)
  }
}))

vi.mock('fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs')>()
  const readFileSync = (path: unknown, options?: unknown): unknown => {
    if (h.busy && String(path) === h.busy) {
      throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' })
    }
    return real.readFileSync(path as string, options as BufferEncoding)
  }
  return { ...real, default: { ...real, readFileSync }, readFileSync }
})

type Settings = typeof import('./settings')

async function peek(file: string): Promise<string> {
  const real = await vi.importActual<typeof import('fs')>('fs')
  return real.readFileSync(file, 'utf-8')
}

describe('settings.json', () => {
  let settings: Settings
  let file = ''

  const load = async (): Promise<Settings> => {
    vi.resetModules()
    settings = await import('./settings')
    return settings
  }

  beforeEach(() => {
    h.dir = mkdtempSync(join(tmpdir(), 'uvd-settings-'))
    h.busy = ''
    h.noDownloads = false
    h.keyStore = false
    file = join(h.dir, 'settings.json')
  })

  afterEach(() => {
    vi.useRealTimers()
    h.busy = ''
    settings?.flushSettings()
    rmSync(h.dir, { recursive: true, force: true })
  })

  it('still starts when Electron cannot say where Downloads is', async () => {
    h.noDownloads = true
    const { getSettings } = await load()
    expect(getSettings().downloadDir).toBe(join(homedir(), 'Downloads'))
  })

  it('takes the previous version from settings.json.bak when the file is damaged', async () => {
    writeFileSync(file, '{"downloadDir": "D:/Vid')
    writeFileSync(`${file}.bak`, JSON.stringify({ downloadDir: 'D:/Videos', theme: 'day' }))
    const { getSettings } = await load()
    expect(getSettings()).toMatchObject({ downloadDir: 'D:/Videos', theme: 'day' })
  })

  it('treats a zeroed file as damaged: defaults, with the damaged copy kept', async () => {
    writeFileSync(file, 'null')
    const { getSettings } = await load()
    expect(getSettings().theme).toBe('night')
    expect(readdirSync(h.dir).some((n) => n.startsWith('settings.json.corrupt-'))).toBe(true)
  })

  it('never writes over a file it could not read, and saves the changes once it can', async () => {
    vi.useFakeTimers()
    const original = JSON.stringify({ downloadDir: 'D:/Videos', theme: 'day' })
    writeFileSync(file, original)
    h.busy = file

    const { getSettings, setSettings, flushSettings } = await load()
    expect(getSettings().downloadDir).toBe(join(h.dir, 'Downloads'))
    setSettings({ speedLimit: '2M' })
    flushSettings()
    vi.advanceTimersByTime(1000)
    expect(await peek(file)).toBe(original)

    // The lock lets go. The next look at the settings reads the file and keeps the change.
    h.busy = ''
    vi.advanceTimersByTime(5000)
    expect(getSettings()).toMatchObject({ downloadDir: 'D:/Videos', theme: 'day', speedLimit: '2M' })
    vi.advanceTimersByTime(1000)
    expect(JSON.parse(await peek(file))).toMatchObject({
      downloadDir: 'D:/Videos',
      theme: 'day',
      speedLimit: '2M'
    })
  })

  /*
    The backup is the version before the last save. Taking the proxy password
    out of settings.json and leaving it in settings.json.bak would have undone
    the point of moving it to the key store.
  */
  it('leaves no proxy password in the backup once it has moved to the key store', async () => {
    h.keyStore = true
    writeFileSync(file, JSON.stringify({ proxy: 'http://user:hunter2@192.168.1.10:8080' }))
    const { getSettings, flushSettings } = await load()
    expect(getSettings().proxy).toBe('http://user@192.168.1.10:8080')
    flushSettings()

    expect(await peek(file)).not.toContain('hunter2')
    expect(await peek(`${file}.bak`)).not.toContain('hunter2')
  })
})
