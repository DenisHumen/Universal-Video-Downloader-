import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { deflateRawSync } from 'zlib'
import { describe, expect, it } from 'vitest'
import {
  activate,
  cleanEngineDir,
  crc32,
  engineAssets,
  MIGRATE_RETRY_MS,
  onedirExe,
  parseSums,
  planEngine,
  readPointer,
  readZip,
  safeTarget,
  sha256,
  stageOnedir,
  staleEntries,
  unpackZip,
  verifySum
} from './engine-dist'

interface FakeEntry {
  name: string
  data?: string
  mode?: number
  deflate?: boolean
}

/** A minimal zip writer, enough to build the archives these tests need, hostile ones included. */
function makeZip(entries: FakeEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const data = Buffer.from(e.data ?? '', 'utf8')
    const body = e.deflate ? deflateRawSync(data) : data
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(e.deflate ? 8 : 0, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, body)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt8(20, 4)
    central.writeUInt8(3, 5) // made on Unix
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(e.deflate ? 8 : 0, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(((e.mode ?? (e.name.endsWith('/') ? 0o40755 : 0o100644)) << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += 30 + name.length + body.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

const fresh = (): string => mkdtempSync(join(tmpdir(), 'uvd-engine-'))

describe('engineAssets', () => {
  it('picks the onedir zip and its executable for every supported machine', () => {
    expect(engineAssets('linux', 'x64')).toEqual({
      onedir: { zip: 'yt-dlp_linux.zip', exe: 'yt-dlp_linux' },
      onefile: 'yt-dlp_linux'
    })
    expect(engineAssets('linux', 'arm64').onedir).toEqual({ zip: 'yt-dlp_linux_aarch64.zip', exe: 'yt-dlp_linux_aarch64' })
    expect(engineAssets('win32', 'x64').onedir).toEqual({ zip: 'yt-dlp_win.zip', exe: 'yt-dlp.exe' })
    expect(engineAssets('win32', 'arm64').onedir).toEqual({ zip: 'yt-dlp_win_arm64.zip', exe: 'yt-dlp_arm64.exe' })
    expect(engineAssets('win32', 'ia32').onedir).toEqual({ zip: 'yt-dlp_win_x86.zip', exe: 'yt-dlp_x86.exe' })
    expect(engineAssets('darwin', 'arm64').onedir).toEqual({ zip: 'yt-dlp_macos.zip', exe: 'yt-dlp_macos' })
  })

  it('falls back to a single file where there is no onedir build, and knows where there is no single file', () => {
    expect(engineAssets('freebsd', 'x64')).toEqual({ onefile: 'yt-dlp_linux' })
    expect(engineAssets('linux', 'arm').onefile).toBeUndefined()
  })
})

describe('checksums', () => {
  it('reads the release list and refuses bytes that do not match', () => {
    const data = Buffer.from('engine')
    const sums = parseSums(`${sha256(data)}  yt-dlp_linux.zip\n${'0'.repeat(64)}  other\nnot a line\n`)
    expect(verifySum(data, 'yt-dlp_linux.zip', sums)).toBe(sha256(data))
    expect(() => verifySum(Buffer.from('tampered'), 'yt-dlp_linux.zip', sums)).toThrow(/checksum/)
    expect(() => verifySum(data, 'missing.zip', sums)).toThrow(/no checksum/)
  })
})

describe('safeTarget', () => {
  it('keeps plain relative paths inside the folder', () => {
    expect(safeTarget('/root', '_internal/lib.so')).toBe(join('/root', '_internal/lib.so'))
  })

  it('refuses anything that would write elsewhere', () => {
    for (const name of ['../evil', 'a/../../evil', '/etc/passwd', 'C:\\Windows\\x', '..\\evil', '', 'a\0b', '.']) {
      expect(safeTarget('/root', name), name).toBeNull()
    }
  })
})

describe('unpackZip', () => {
  it('writes files and folders, inflated and stored, with their executable bits', () => {
    const dest = fresh()
    unpackZip(
      makeZip([
        { name: '_internal/' },
        { name: '_internal/lib.so', data: 'x'.repeat(1000), deflate: true },
        { name: 'yt-dlp_linux', data: '#!engine', mode: 0o100755 }
      ]),
      dest,
      'yt-dlp_linux'
    )
    expect(readFileSync(join(dest, '_internal/lib.so'), 'utf8')).toBe('x'.repeat(1000))
    if (process.platform !== 'win32') expect(statSync(join(dest, 'yt-dlp_linux')).mode & 0o111).not.toBe(0)
  })

  it('refuses path traversal and symlinks', () => {
    expect(() => unpackZip(makeZip([{ name: '../escape', data: 'x' }]), fresh())).toThrow(/unsafe path/)
    expect(() =>
      unpackZip(makeZip([{ name: 'link', data: '/etc', mode: 0o120777 }]), fresh())
    ).toThrow(/not a file/)
  })

  it('refuses an entry whose bytes do not match its CRC', () => {
    const zip = makeZip([{ name: 'a', data: 'hello' }])
    zip[30 + 1] = 'X'.charCodeAt(0) // the data byte right after the one-letter name
    expect(() => unpackZip(zip, fresh())).toThrow(/integrity/)
  })

  it('reads a central directory', () => {
    const entries = readZip(makeZip([{ name: 'd/' }, { name: 'd/f', data: 'abc' }]))
    expect(entries.map((e) => [e.name, e.isDir, e.size])).toEqual([
      ['d/', true, 0],
      ['d/f', false, 3]
    ])
  })
})

describe('staging and activating a onedir copy', () => {
  const zip = makeZip([{ name: '_internal/' }, { name: 'yt-dlp_linux', data: '#!', mode: 0o100755 }])

  it('unpacks beside the active copy and switches only on activate', () => {
    const bin = fresh()
    const pointer = stageOnedir(zip, bin, 'yt-dlp_linux', sha256(zip))
    expect(onedirExe(bin)).toBeNull()
    activate(bin, pointer)
    expect(onedirExe(bin)).toBe(join(bin, pointer.dir, 'yt-dlp_linux'))
    expect(readPointer(bin)).toEqual(pointer)
    // No scratch folder left behind.
    expect(readdirSync(bin).filter((n) => n.startsWith('.unpack-'))).toEqual([])
  })

  it('leaves nothing behind when the archive is bad', () => {
    const bin = fresh()
    expect(() => stageOnedir(makeZip([{ name: 'other' }]), bin, 'yt-dlp_linux', 'f'.repeat(64))).toThrow()
    expect(readdirSync(bin)).toEqual([])
  })

  it('distrusts a pointer that names a path', () => {
    const bin = fresh()
    writeFileSync(join(bin, 'current.json'), JSON.stringify({ dir: '../x', exe: 'yt-dlp', sha256: 'a' }))
    expect(readPointer(bin)).toBeNull()
  })

  it('cleans up other copies, leftovers and the single file once onedir is active', () => {
    const bin = fresh()
    const pointer = stageOnedir(zip, bin, 'yt-dlp_linux', sha256(zip))
    activate(bin, pointer)
    mkdirSync(join(bin, 'yt-dlp-dist-old'))
    mkdirSync(join(bin, '.unpack-abc'))
    writeFileSync(join(bin, 'yt-dlp'), 'onefile')
    writeFileSync(join(bin, 'yt-dlp.download'), 'half')
    cleanEngineDir(bin, 'yt-dlp')
    expect(readdirSync(bin).sort()).toEqual(['current.json', pointer.dir].sort())
  })

  it('keeps the single file while no onedir copy is active', () => {
    expect(staleEntries(['yt-dlp', 'yt-dlp-dist-a', 'yt-dlp.download'], null, 'yt-dlp')).toEqual([
      'yt-dlp-dist-a',
      'yt-dlp.download'
    ])
    const bin = fresh()
    writeFileSync(join(bin, 'yt-dlp'), 'onefile')
    cleanEngineDir(bin, 'yt-dlp')
    expect(existsSync(join(bin, 'yt-dlp'))).toBe(true)
  })
})

describe('planEngine', () => {
  const now = 10 * MIGRATE_RETRY_MS

  it('uses a working onedir copy', () => {
    expect(planEngine({ onedirRuns: true, onefileRuns: true, onedirAvailable: true, now })).toBe('use-onedir')
  })

  it('keeps a working single file and migrates behind it', () => {
    expect(planEngine({ onedirRuns: false, onefileRuns: true, onedirAvailable: true, now })).toBe(
      'use-onefile-then-migrate'
    )
  })

  it('waits a day after a failed migration, and never migrates where no onedir build exists', () => {
    expect(
      planEngine({ onedirRuns: false, onefileRuns: true, onedirAvailable: true, lastMigrationFailure: now - 1000, now })
    ).toBe('use-onefile')
    expect(
      planEngine({
        onedirRuns: false,
        onefileRuns: true,
        onedirAvailable: true,
        lastMigrationFailure: now - MIGRATE_RETRY_MS - 1,
        now
      })
    ).toBe('use-onefile-then-migrate')
    expect(planEngine({ onedirRuns: false, onefileRuns: true, onedirAvailable: false, now })).toBe('use-onefile')
  })

  it('installs when nothing runs', () => {
    expect(planEngine({ onedirRuns: false, onefileRuns: false, onedirAvailable: true, now })).toBe('install')
  })
})
