import { createHash, randomBytes } from 'crypto'
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'fs'
import { chmod, mkdir, rename, rm, writeFile } from 'fs/promises'
import { dirname, isAbsolute, join, normalize, relative } from 'path'
import { promisify } from 'util'
import * as zlib from 'zlib'

const inflateRaw = promisify(zlib.inflateRaw)

/*
  The engine as a directory rather than a single file.

  yt-dlp's onefile builds are PyInstaller bundles that unpack their whole
  Python runtime into a temp folder on every start. Measured on Linux: 0.86 s
  for `--version` against 0.49 s for the onedir build of the same release, and
  2.2 s against 1.65 s for a YouTube `-J` probe. Every detect and every
  download pays that, and on Windows Defender scans the unpacked files again
  each time. The onedir build is the same program already unpacked.

  This module is the part that needs no Electron: which release asset fits
  this machine, reading and safely unpacking the zip, the checksum list, and
  where the installed copy is recorded. ytdlp.ts does the networking.
*/

export interface EngineAssets {
  /** The release zip with the unpacked build, and the executable's name inside it. */
  onedir?: { zip: string; exe: string }
  /** The single-file build, for machines with no onedir release. */
  onefile?: string
}

/**
 * The release assets for this platform and architecture.
 *
 * Read off the 2026.08.19 release. Windows on ARM and 32-bit Windows used to
 * get the x64 `yt-dlp.exe` (emulated, or not at all); each has a build of its
 * own. 32-bit ARM Linux has no single-file build any more, only the zip.
 */
export function engineAssets(platform: string, arch: string): EngineAssets {
  if (platform === 'win32') {
    if (arch === 'arm64') return { onedir: { zip: 'yt-dlp_win_arm64.zip', exe: 'yt-dlp_arm64.exe' }, onefile: 'yt-dlp_arm64.exe' }
    if (arch === 'ia32') return { onedir: { zip: 'yt-dlp_win_x86.zip', exe: 'yt-dlp_x86.exe' }, onefile: 'yt-dlp_x86.exe' }
    return { onedir: { zip: 'yt-dlp_win.zip', exe: 'yt-dlp.exe' }, onefile: 'yt-dlp.exe' }
  }
  if (platform === 'darwin') return { onedir: { zip: 'yt-dlp_macos.zip', exe: 'yt-dlp_macos' }, onefile: 'yt-dlp_macos' }
  if (platform === 'linux') {
    if (arch === 'arm64') {
      return { onedir: { zip: 'yt-dlp_linux_aarch64.zip', exe: 'yt-dlp_linux_aarch64' }, onefile: 'yt-dlp_linux_aarch64' }
    }
    if (arch === 'arm') return { onedir: { zip: 'yt-dlp_linux_armv7l.zip', exe: 'yt-dlp_linux_armv7l' } }
    if (arch === 'x64') return { onedir: { zip: 'yt-dlp_linux.zip', exe: 'yt-dlp_linux' }, onefile: 'yt-dlp_linux' }
  }
  // Anything else gets the pure-Python zipapp's single file and the system's Python, as before.
  return { onefile: 'yt-dlp_linux' }
}

/** `SHA2-256SUMS`: one `<hex>  <asset>` per line. */
export function parseSums(text: string): Map<string, string> {
  const sums = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(\S+)\s*$/i.exec(line.trim())
    if (m) sums.set(m[2], m[1].toLowerCase())
  }
  return sums
}

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Refuse an asset whose SHA-256, worked out as it downloaded, is not the one the release lists. */
export function verifyHash(actual: string, asset: string, sums: Map<string, string>): string {
  const expected = sums.get(asset)
  if (!expected) throw new Error(`The engine release lists no checksum for ${asset}.`)
  if (actual.toLowerCase() !== expected) {
    throw new Error(`The downloaded ${asset} does not match its published checksum.`)
  }
  return expected
}

/** `verifyHash` for bytes already in hand. */
export function verifySum(data: Buffer, asset: string, sums: Map<string, string>): string {
  return verifyHash(sha256(data), asset, sums)
}

// ---- Zip -----------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/** Node's own CRC-32 where it has one (20.15+), which is native and so does not hold the thread. */
const nativeCrc32 = (zlib as unknown as { crc32?: (data: Buffer) => number }).crc32

export function crc32(data: Buffer): number {
  if (nativeCrc32) return nativeCrc32(data) >>> 0
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  name: string
  method: number
  crc: number
  compressedSize: number
  size: number
  /** Offset of the entry's local header. */
  offset: number
  /** The Unix mode, when the archive was made on Unix; 0 otherwise. */
  mode: number
  isDir: boolean
}

const S_IFMT = 0o170000
const S_IFREG = 0o100000
const S_IFDIR = 0o040000

/** The central directory of a zip, read straight from its bytes. ZIP64 is refused: no engine build needs it. */
export function readZip(buf: Buffer): ZipEntry[] {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a zip archive.')
  const count = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('ZIP64 archives are not supported.')
  const entries: ZipEntry[] = []
  let p = cdOffset
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('The zip directory is damaged.')
    const madeBy = buf.readUInt8(p + 5)
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const crc = buf.readUInt32LE(p + 16)
    const compressedSize = buf.readUInt32LE(p + 20)
    const size = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const external = buf.readUInt32LE(p + 38)
    const offset = buf.readUInt32LE(p + 42)
    if (flags & 0x1) throw new Error('Encrypted zip entries are not supported.')
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    const mode = madeBy === 3 ? external >>> 16 : 0
    entries.push({
      name,
      method,
      crc,
      compressedSize,
      size,
      offset,
      mode,
      isDir: name.endsWith('/') || (mode & S_IFMT) === S_IFDIR || (madeBy === 0 && (external & 0x10) !== 0)
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** One entry's bytes, checked against its CRC. Inflated on the thread pool, not the main thread. */
export async function entryData(buf: Buffer, entry: ZipEntry): Promise<Buffer> {
  const p = entry.offset
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new Error(`The zip entry ${entry.name} is damaged.`)
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28)
  const raw = buf.subarray(start, start + entry.compressedSize)
  let data: Buffer
  if (entry.method === 0) data = Buffer.from(raw)
  else if (entry.method === 8) data = await inflateRaw(raw)
  else throw new Error(`The zip entry ${entry.name} uses an unsupported compression method.`)
  if (data.length !== entry.size || crc32(data) !== entry.crc) {
    throw new Error(`The zip entry ${entry.name} failed its integrity check.`)
  }
  return data
}

/**
 * Where an entry may be written under `root`, or null when it may not.
 *
 * The archive is someone else's bytes until proven otherwise. A name that is
 * absolute, carries a drive letter, or climbs out with `..` would write
 * anywhere the user can; only plain relative paths that stay inside are
 * accepted.
 */
export function safeTarget(root: string, name: string): string | null {
  if (!name || name.includes('\0')) return null
  const unified = name.replace(/\\/g, '/')
  if (unified.startsWith('/') || /^[a-zA-Z]:/.test(unified) || isAbsolute(unified)) return null
  if (unified.split('/').some((part) => part === '..')) return null
  const target = normalize(join(root, unified))
  const rel = relative(root, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  return target
}

/**
 * Unpack `buf` into `dest`, which must be a fresh empty directory.
 *
 * Only plain files and directories. A symlink entry is refused outright - one
 * pointing out of the folder would let a later entry write through it - and
 * so is anything else that is not a regular file. Executable bits come from
 * the archive where it has Unix modes; `exe` is always made executable.
 *
 * Asynchronous throughout, one entry at a time: done synchronously, the
 * engine's 175 files took half a second of the main process, during which the
 * window's every IPC call waited. Every path is checked before anything is
 * written, so a hostile entry late in the archive cannot leave a half-written
 * tree for the caller to clean up first.
 */
export async function unpackZip(buf: Buffer, dest: string, exe?: string): Promise<void> {
  const entries = readZip(buf)
  const plan = entries.map((entry) => {
    const target = safeTarget(dest, entry.name)
    if (!target) throw new Error(`The engine archive has an unsafe path: ${entry.name}`)
    const type = entry.mode & S_IFMT
    if (entry.mode && type !== 0 && type !== S_IFREG && type !== S_IFDIR) {
      throw new Error(`The engine archive has an entry that is not a file: ${entry.name}`)
    }
    return { entry, target }
  })
  for (const { entry, target } of plan) {
    if (entry.isDir) {
      await mkdir(target, { recursive: true })
      continue
    }
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, await entryData(buf, entry), { flag: 'wx' })
    if (process.platform !== 'win32') {
      const executable = (entry.mode & 0o111) !== 0 || entry.name === exe
      await chmod(target, executable ? 0o755 : 0o644)
    }
  }
}

// ---- The installed copy ----------------------------------------------------

/** What `current.json` in the engine folder records: the active onedir copy. */
export interface EnginePointer {
  /** Folder name under the engine folder. */
  dir: string
  exe: string
  /** SHA-256 of the zip it came from, which is how a refresh tells whether it is current. */
  sha256: string
}

export const POINTER_FILE = 'current.json'
export const DIST_PREFIX = 'yt-dlp-dist-'
const UNPACK_PREFIX = '.unpack-'

export function readPointer(binDir: string): EnginePointer | null {
  try {
    const raw = JSON.parse(readFileSync(join(binDir, POINTER_FILE), 'utf-8')) as Partial<EnginePointer>
    if (
      typeof raw.dir === 'string' &&
      raw.dir.startsWith(DIST_PREFIX) &&
      !/[\\/]/.test(raw.dir) &&
      typeof raw.exe === 'string' &&
      !/[\\/]/.test(raw.exe) &&
      typeof raw.sha256 === 'string'
    ) {
      return { dir: raw.dir, exe: raw.exe, sha256: raw.sha256 }
    }
  } catch {
    /* none yet, or unreadable: as good as none */
  }
  return null
}

/** The active onedir executable, when there is one on disk. */
export function onedirExe(binDir: string): string | null {
  const pointer = readPointer(binDir)
  if (!pointer) return null
  const exe = join(binDir, pointer.dir, pointer.exe)
  return existsSync(exe) ? exe : null
}

/**
 * Unpack a verified zip into a folder of its own, beside the active one.
 *
 * Into a scratch folder first and renamed into place once complete, so a copy
 * cut short by a crash or a full disk is never the one anything runs. The
 * pointer is not touched here: the caller switches it with `activate` only
 * once the new copy has been seen to start.
 */
export async function stageOnedir(zip: Buffer, binDir: string, exe: string, sum: string): Promise<EnginePointer> {
  const scratch = join(binDir, `${UNPACK_PREFIX}${randomBytes(6).toString('hex')}`)
  await mkdir(scratch, { recursive: false })
  try {
    await unpackZip(zip, scratch, exe)
    if (!existsSync(join(scratch, exe))) throw new Error(`The engine archive has no ${exe} in it.`)
    const dir = `${DIST_PREFIX}${sum.slice(0, 16)}`
    const final = join(binDir, dir)
    // The same release unpacked before: the fresh copy replaces it.
    if (existsSync(final)) await rm(final, { recursive: true, force: true })
    await rename(scratch, final)
    return { dir, exe, sha256: sum }
  } catch (err) {
    await rm(scratch, { recursive: true, force: true })
    throw err
  }
}

/** Make `pointer` the active copy. A rename over the old file, so readers see one or the other. */
export function activate(binDir: string, pointer: EnginePointer): void {
  const tmp = join(binDir, `${POINTER_FILE}.${randomBytes(4).toString('hex')}`)
  writeFileSync(tmp, JSON.stringify(pointer), 'utf-8')
  renameSync(tmp, join(binDir, POINTER_FILE))
}

/** How far a clean-up of the engine folder may go. */
export interface CleanScope {
  /**
   * The active onedir copy has just been seen to start. Only then do the
   * engines it replaces go - the single file and older copies - since until
   * then the single file may be the only engine that runs.
   */
  onedirVerified: boolean
}

/**
 * Leftovers in the engine folder that may go: unpacks a crash cut short and
 * half-downloaded files always; other onedir copies and the single-file
 * engine only once the active copy is verified. Deletion is best effort; a
 * copy still running a download on Windows simply stays until the next launch.
 */
export function staleEntries(
  names: string[],
  pointer: EnginePointer | null,
  onefileName: string,
  scope: CleanScope
): string[] {
  return names.filter((name) => {
    if (name.startsWith(UNPACK_PREFIX) || name.endsWith('.download')) return true
    if (name.startsWith(`${POINTER_FILE}.`)) return true
    if (!scope.onedirVerified || !pointer) return false
    if (name.startsWith(DIST_PREFIX)) return name !== pointer.dir
    return name === onefileName
  })
}

export function cleanEngineDir(binDir: string, onefileName: string, scope: CleanScope): void {
  let names: string[]
  try {
    names = readdirSync(binDir)
  } catch {
    return
  }
  const pointer = onedirExe(binDir) ? readPointer(binDir) : null
  for (const name of staleEntries(names, pointer, onefileName, scope)) {
    try {
      rmSync(join(binDir, name), { recursive: true, force: true })
    } catch {
      /* in use; next launch */
    }
  }
}

// ---- What to do at launch ------------------------------------------------

export type EnginePlan =
  /** The onedir copy runs: use it. */
  | 'use-onedir'
  /** The old single file runs and a onedir build exists: use it now, migrate behind it. */
  | 'use-onefile-then-migrate'
  /** The single file runs and there is nothing better to move to, or moving failed lately. */
  | 'use-onefile'
  /** Nothing runs: install the onedir build, falling back to the single file. */
  | 'install'

/** After a failed migration, how long before the next try; it doubles with each failure in a row. */
export const MIGRATE_RETRY_MS = 24 * 3_600_000
const MIGRATE_RETRY_MAX_MS = 30 * MIGRATE_RETRY_MS

/** The failed onedir attempts in a row, and when the last one was. */
export interface MigrationFailure {
  at: number
  count: number
}

/**
 * Whether the onedir build is off the table for now.
 *
 * A build that will not start on this machine fails the same way every time,
 * and each try is a ~60 MB download. A day after the first failure, two after
 * the second, and so on up to a month: a passing network hiccup costs a day,
 * a build that cannot run here stops being fetched.
 */
export function migrationBlocked(failure: MigrationFailure | undefined, now: number): boolean {
  if (!failure) return false
  const wait = Math.min(MIGRATE_RETRY_MAX_MS, MIGRATE_RETRY_MS * 2 ** Math.max(0, failure.count - 1))
  return now - failure.at < wait
}

/** The failure file's contents, from either its current JSON or the bare timestamp it once was. */
export function parseMigrationFailure(text: string): MigrationFailure | undefined {
  try {
    const raw = JSON.parse(text) as unknown
    if (typeof raw === 'number' && Number.isFinite(raw)) return { at: raw, count: 1 }
    const o = raw as Partial<MigrationFailure>
    if (typeof o?.at === 'number' && typeof o.count === 'number') return { at: o.at, count: o.count }
  } catch {
    /* unreadable: as if none */
  }
  return undefined
}

/**
 * The launch decision. The single file keeps working until a onedir copy has
 * been unpacked, started and switched to, so a failed or interrupted
 * migration never leaves the app without an engine - it only means trying
 * again tomorrow.
 */
export function planEngine(input: {
  onedirRuns: boolean
  onefileRuns: boolean
  onedirAvailable: boolean
  migrationFailure?: MigrationFailure
  now: number
}): EnginePlan {
  if (input.onedirRuns) return 'use-onedir'
  if (input.onefileRuns) {
    const blocked = migrationBlocked(input.migrationFailure, input.now)
    return input.onedirAvailable && !blocked ? 'use-onefile-then-migrate' : 'use-onefile'
  }
  return 'install'
}
