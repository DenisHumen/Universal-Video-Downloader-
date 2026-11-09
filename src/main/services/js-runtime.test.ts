import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, relative } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DENO_PINS,
  denoExeName,
  denoOnPath,
  denoPin,
  denoUrl,
  isPinnedBanner,
  isYoutubeLink,
  jsRuntimeArgs,
  jsRuntimeSettled,
  runtimeFetchBlocked,
  staleRuntimeEntries,
  trackRuntimeInstall,
  useJsRuntime,
  withJsRuntime
} from './js-runtime'

describe('the pins', () => {
  it('cover both architectures on all three systems, each by asset and SHA-256', () => {
    expect(Object.keys(DENO_PINS).sort()).toEqual([
      'darwin-arm64',
      'darwin-x64',
      'linux-arm64',
      'linux-x64',
      'win32-arm64',
      'win32-x64'
    ])
    for (const pin of Object.values(DENO_PINS)) {
      expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/)
      // `denort` cannot run a script from stdin, which is how the engine hands it one.
      expect(pin.asset).toMatch(/^deno-[\w-]+\.zip$/)
    }
  })

  it('name a version, never "latest"', () => {
    expect(denoUrl(DENO_PINS['linux-x64'])).toMatch(
      /^https:\/\/github\.com\/denoland\/deno\/releases\/download\/v\d+\.\d+\.\d+\/deno-x86_64-unknown-linux-gnu\.zip$/
    )
  })

  it('leave a system with no build without one, which is not a failure', () => {
    expect(denoPin('win32', 'ia32')).toBeUndefined()
    expect(denoPin('linux', 'arm')).toBeUndefined()
    expect(denoPin('linux', 'x64')).toBe(DENO_PINS['linux-x64'])
  })

  it('read the banner of the pinned version only', () => {
    expect(isPinnedBanner('deno 2.9.8 (stable, release, x86_64-pc-windows-msvc)\nv8 15.0')).toBe(true)
    expect(isPinnedBanner('deno 2.9.80 (stable)')).toBe(false)
    expect(isPinnedBanner('deno 2.3.0 (stable)')).toBe(false)
    expect(isPinnedBanner('')).toBe(false)
  })
})

describe('the engine arguments', () => {
  afterEach(() => useJsRuntime(null))

  it('name the runtime by its full path, drive letter and all', () => {
    expect(jsRuntimeArgs('C:\\Users\\Мария\\AppData\\Local\\deno.exe')).toEqual([
      '--js-runtimes',
      'deno:C:\\Users\\Мария\\AppData\\Local\\deno.exe'
    ])
  })

  it('turn the engine own search off when there is none', () => {
    expect(jsRuntimeArgs(null)).toEqual(['--no-js-runtimes'])
  })

  it('never fetch the solver at run time or enable a runtime with a weaker sandbox', () => {
    const args = [...jsRuntimeArgs('/x/deno'), ...jsRuntimeArgs(null)].join(' ')
    expect(args).not.toMatch(/remote-components|node|quickjs|bun/)
  })

  it('go ahead of the arguments, so they can never land behind `--`', () => {
    useJsRuntime('/x/deno')
    expect(withJsRuntime(['--ignore-config', '--', 'https://example.com/v'])).toEqual([
      '--js-runtimes',
      'deno:/x/deno',
      '--ignore-config',
      '--',
      'https://example.com/v'
    ])
  })
})

/*
  The engine would run a deno.exe from the folder it was started in, so a spawn
  that forgets this is more than a lower quality. A new spawn fails here, not in
  somebody's Downloads folder.
*/
describe('every engine spawn', () => {
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const path = join(dir, e.name)
      if (e.isDirectory()) return sources(path)
      return /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [path] : []
    })

  it('goes through withJsRuntime', () => {
    const root = join(__dirname, '..')
    const spawns = sources(root).flatMap((file) =>
      [...readFileSync(file, 'utf-8').matchAll(/spawn\(\s*(ytdlpBinaryPath\(\)|bin),\s*([^\n]*)/g)]
        .filter((m) => m[1] !== 'bin' || file.endsWith('ytdlp.ts'))
        .map((m) => `${relative(root, file)}: ${m[2]}`)
    )
    expect(spawns.length).toBeGreaterThanOrEqual(6)
    for (const line of spawns) expect(line).toContain('withJsRuntime(')
  })
})

describe('a Deno on PATH', () => {
  let dir: string
  const name = denoExeName()
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'uvd-path-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const plant = (folder: string): string => {
    mkdirSync(folder, { recursive: true })
    const file = join(folder, name)
    writeFileSync(file, '')
    chmodSync(file, 0o755)
    return file
  }

  it('is found by absolute path, in PATH order', () => {
    const first = plant(join(dir, 'a'))
    plant(join(dir, 'b'))
    expect(denoOnPath({ PATH: [join(dir, 'none'), join(dir, 'a'), join(dir, 'b')].join(process.platform === 'win32' ? ';' : ':') })).toBe(first)
  })

  it('is not looked for in the current folder, however PATH spells it', () => {
    const before = process.cwd()
    plant(dir)
    process.chdir(dir)
    try {
      expect(denoOnPath({ PATH: `.${process.platform === 'win32' ? ';' : ':'}` })).toBeNull()
    } finally {
      process.chdir(before)
    }
  })

  it('is nothing when there is no PATH at all', () => {
    expect(denoOnPath({})).toBeNull()
  })

  it('takes a folder called deno for what it is', () => {
    mkdirSync(join(dir, name), { recursive: true })
    expect(denoOnPath({ PATH: dir })).toBeNull()
  })
})

describe('clean-up', () => {
  it('takes earlier pins and leftovers, and keeps the active copy, the cache and the back-off', () => {
    expect(
      staleRuntimeEntries(
        ['deno-2.9.8-abc', 'deno-2.9.7-old', '.unpack-1f', 'deno-x.zip.download', 'cache', 'fetch-failed'],
        'deno-2.9.8-abc'
      )
    ).toEqual(['deno-2.9.7-old', '.unpack-1f', 'deno-x.zip.download'])
  })
})

describe('after a failed fetch', () => {
  const MIN = 60_000
  it('waits a little at first and a lot once it keeps failing, up to a week', () => {
    expect(runtimeFetchBlocked(undefined, 0)).toBe(false)
    expect(runtimeFetchBlocked({ at: 0, count: 1 }, 14 * MIN)).toBe(true)
    expect(runtimeFetchBlocked({ at: 0, count: 1 }, 16 * MIN)).toBe(false)
    expect(runtimeFetchBlocked({ at: 0, count: 3 }, 239 * MIN)).toBe(true)
    expect(runtimeFetchBlocked({ at: 0, count: 3 }, 241 * MIN)).toBe(false)
    expect(runtimeFetchBlocked({ at: 0, count: 50 }, 6 * 24 * 60 * MIN)).toBe(true)
    expect(runtimeFetchBlocked({ at: 0, count: 50 }, 7 * 24 * 60 * MIN + 1)).toBe(false)
  })
})

describe('waiting for a fetch under way', () => {
  it('does not wait when none is', async () => {
    await expect(jsRuntimeSettled(60_000)).resolves.toBeUndefined()
  })

  it('ends when the fetch does, failed or not', async () => {
    let fail: (e: Error) => void = () => undefined
    const work = new Promise<void>((_, reject) => (fail = reject))
    work.catch(() => undefined)
    trackRuntimeInstall(work)
    const waited = jsRuntimeSettled(60_000)
    fail(new Error('network'))
    await expect(waited).resolves.toBeUndefined()
  })

  it('gives up at its limit, and on a cancel', async () => {
    trackRuntimeInstall(new Promise(() => undefined))
    await expect(jsRuntimeSettled(5)).resolves.toBeUndefined()
    const cancel = new AbortController()
    const waited = jsRuntimeSettled(60_000, cancel.signal)
    cancel.abort()
    await expect(waited).resolves.toBeUndefined()
  })
})

describe('which links want the runtime', () => {
  it('is YouTube, not a site with the word in its name', () => {
    expect(isYoutubeLink('https://www.youtube.com/watch?v=abc')).toBe(true)
    expect(isYoutubeLink('https://youtu.be/abc')).toBe(true)
    expect(isYoutubeLink('https://music.youtube.com/watch?v=abc')).toBe(true)
    expect(isYoutubeLink('https://notyoutube.com/watch?v=abc')).toBe(false)
    expect(isYoutubeLink('not a link')).toBe(false)
  })
})
