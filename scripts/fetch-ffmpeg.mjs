#!/usr/bin/env node
/**
 * Replace the ffmpeg that `ffmpeg-static` installed with a pinned, newer one,
 * and the README and licence beside it with ones that describe it.
 *
 * `ffmpeg-static` stops at 6.1.1 - its newest binary release - and 6.1.1 has a
 * bug that became everyone's problem when Twitch moved its recordings to HLS
 * built from fragmented-MP4 segments: seeking into such a stream loses the
 * init segment, the demuxer reads garbage ("Invalid NAL unit size"), and a
 * download that starts anywhere but zero writes a 262-byte file that yt-dlp
 * reports as a success. Trimming a VOD before downloading is exactly that
 * download. 9.0.2 reads the same stream correctly; this was measured on a live
 * VOD with both binaries before anything here was written.
 *
 * The binary lands exactly where `ffmpeg-static` puts its own, so nothing that
 * locates ffmpeg changes, and the architecture guard that runs next in CI
 * (`check-ffmpeg-arch.mjs`) checks this file rather than the one it replaced.
 *
 * What is pinned, and why each copy may be passed on, is in ffmpeg-pins.mjs.
 * A wrong checksum, a nonfree build, or one without the encoders the app uses
 * fails here, before anything is written.
 *
 *   node scripts/fetch-ffmpeg.mjs                        this machine's platform
 *   node scripts/fetch-ffmpeg.mjs --target=darwin-arm64 --out=DIR   another one
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'
import {
  NONFREE_MARKER,
  PINNED,
  VERSION,
  bannerMatches,
  ffmpegReadme,
  isNonfree,
  missingLibraries,
  noticeProblems,
  tarArgs
} from './ffmpeg-pins.mjs'

/**
 * Read one file out of a zip.
 *
 * Written out rather than shelling to `unzip` or `tar`, because the three
 * runners do not agree on which of those exists or how it names a member, and
 * a packaging step that behaves differently per OS is the kind that ships the
 * wrong binary. Stored and deflated entries, with the zip64 size fields.
 */
export function extractMember(zip, name) {
  const EOCD = 0x06054b50
  let eocd = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a zip archive')

  let count = zip.readUInt16LE(eocd + 10)
  let at = zip.readUInt32LE(eocd + 16)
  // zip64: the real values live in the zip64 end record the locator points at.
  if (at === 0xffffffff || count === 0xffff) {
    const locator = eocd - 20
    if (zip.readUInt32LE(locator) === 0x07064b50) {
      const record = Number(zip.readBigUInt64LE(locator + 8))
      count = Number(zip.readBigUInt64LE(record + 32))
      at = Number(zip.readBigUInt64LE(record + 48))
    }
  }

  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error('damaged central directory')
    const method = zip.readUInt16LE(at + 10)
    let packed = zip.readUInt32LE(at + 20)
    let size = zip.readUInt32LE(at + 24)
    const nameLen = zip.readUInt16LE(at + 28)
    const extraLen = zip.readUInt16LE(at + 30)
    const commentLen = zip.readUInt16LE(at + 32)
    let local = zip.readUInt32LE(at + 42)
    const entry = zip.toString('utf8', at + 46, at + 46 + nameLen)

    if (entry === name) {
      // zip64 extra field: only the values that overflowed are present, in order.
      let extra = at + 46 + nameLen
      const end = extra + extraLen
      while (extra + 4 <= end) {
        const id = zip.readUInt16LE(extra)
        const len = zip.readUInt16LE(extra + 2)
        if (id === 0x0001) {
          let p = extra + 4
          if (size === 0xffffffff) (size = Number(zip.readBigUInt64LE(p))), (p += 8)
          if (packed === 0xffffffff) (packed = Number(zip.readBigUInt64LE(p))), (p += 8)
          if (local === 0xffffffff) local = Number(zip.readBigUInt64LE(p))
        }
        extra += 4 + len
      }

      if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error('damaged local header')
      const data = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
      const raw = zip.subarray(data, data + packed)
      const out = method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw) : null
      if (!out) throw new Error(`unsupported compression method ${method}`)
      if (out.length !== size) throw new Error(`size mismatch for ${name}`)
      return out
    }
    at += 46 + nameLen + extraLen + commentLen
  }
  throw new Error(`${name} is not in the archive`)
}

/**
 * Read files out of a .tar.xz by their exact paths.
 *
 * Node has no xz, so this is the one place tar is used - unpacked into a
 * scratch directory and read back, so the binary still goes through the same
 * checks and the same write-beside-then-rename as one out of a zip. The
 * archive is named relative to tar's working directory because GNU tar takes
 * the `C:` of a Windows path for a remote host.
 */
function extractTarMembers(archive, names) {
  const work = mkdtempSync(join(tmpdir(), 'uvd-ffmpeg-'))
  try {
    writeFileSync(join(work, 'archive.tar.xz'), archive)
    execFileSync('tar', tarArgs('archive.tar.xz', names), {
      cwd: work,
      stdio: ['ignore', 'ignore', 'pipe']
    })
    return names.map((name) => readFileSync(join(work, ...name.split('/'))))
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/** Write beside, then rename: an interrupted run never leaves half a file. */
function writeAtomic(path, data, mode) {
  writeFileSync(`${path}.tmp`, data)
  if (mode && process.platform !== 'win32') chmodSync(`${path}.tmp`, mode)
  renameSync(`${path}.tmp`, path)
}

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit?.slice(name.length + 3)
}

async function main() {
  const target = arg('target') ?? `${process.platform}-${process.arch}`
  const pin = PINNED[target]
  if (!pin) {
    console.error(`No pinned ffmpeg for ${target}; keeping the one ffmpeg-static installed.`)
    return
  }

  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const outDir = arg('out') ? resolve(arg('out')) : join(root, 'node_modules', 'ffmpeg-static')
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  const dest = join(outDir, pin.bin)

  console.log(`ffmpeg ${VERSION} for ${target}: ${pin.url}`)
  const response = await fetch(pin.url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`)
  const archive = Buffer.from(await response.arrayBuffer())

  const digest = createHash('sha256').update(archive).digest('hex')
  if (digest !== pin.sha256) {
    throw new Error(`checksum mismatch for ${target}: expected ${pin.sha256}, got ${digest}`)
  }

  const names = [pin.member, pin.readme, pin.licence].filter(Boolean)
  const contents =
    pin.extract === 'tar.xz'
      ? extractTarMembers(archive, names)
      : names.map((name) => extractMember(archive, name))
  const files = new Map(names.map((name, i) => [name, contents[i]]))
  const binary = files.get(pin.member)

  if (isNonfree(binary)) {
    throw new Error(
      `${target}: this build was configured with --enable-nonfree ("${NONFREE_MARKER}"), ` +
        `so FFmpeg's licence forbids passing it on. Pin a GPL build instead.`
    )
  }
  const missing = missingLibraries(binary)
  if (missing.length > 0) {
    throw new Error(`${target}: this build has no ${missing.join(', ')}, which trim and convert use`)
  }

  writeAtomic(dest, binary, 0o755)
  console.log(`  wrote ${dest} (${(binary.length / 1048576).toFixed(1)} MB)`)

  let body = pin.readme ? files.get(pin.readme).toString('utf8') : ''
  // Only runnable when it is this machine's own platform, which in CI it is.
  if (target === `${process.platform}-${process.arch}`) {
    const banner = execFileSync(dest, ['-hide_banner', '-version'], { encoding: 'utf8' }).split('\n')[0]
    if (!bannerMatches(banner)) throw new Error(`unexpected binary: ${banner}`)
    console.log(`  runs: ${banner}`)
    if (!pin.readme) {
      const conf = execFileSync(dest, ['-hide_banner', '-buildconf'], { encoding: 'utf8' })
      body = `Build configuration (ffmpeg -buildconf):\n\n${conf.replace(/^\s*\n/, '')}`
    }
  }

  const readme = ffmpegReadme(target, pin, body)
  const licence = pin.licence
    ? files.get(pin.licence)
    : readFileSync(join(root, 'node_modules', 'ffmpeg-static', 'LICENSE'))
  const problems = noticeProblems({
    name: pin.bin,
    binary,
    readme,
    licence: licence.toString('utf8')
  })
  if (problems.length > 0) throw new Error(problems.join('; '))

  writeAtomic(`${dest}.README`, readme)
  writeAtomic(`${dest}.LICENSE`, licence)
  console.log(`  wrote ${pin.bin}.README and ${pin.bin}.LICENSE beside it`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`fetch-ffmpeg: ${err.message}`)
    process.exit(1)
  })
}
