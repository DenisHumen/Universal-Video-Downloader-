#!/usr/bin/env node
/**
 * Replace the ffmpeg that `ffmpeg-static` installed with a pinned, newer one.
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
 * Every archive is pinned by URL *and* by SHA-256. A build server that quietly
 * republishes something different fails the build instead of shipping it.
 *
 *   node scripts/fetch-ffmpeg.mjs                        this machine's platform
 *   node scripts/fetch-ffmpeg.mjs --target=darwin-arm64 --out=DIR   another one
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const VERSION = '9.0.2'

const PINNED = {
  'win32-x64': {
    url: 'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip',
    sha256: '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba',
    member: 'ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe',
    bin: 'ffmpeg.exe'
  },
  'darwin-arm64': {
    url: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip',
    sha256: 'c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924',
    member: 'ffmpeg',
    bin: 'ffmpeg'
  },
  'darwin-x64': {
    url: 'https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffmpeg.zip',
    sha256: '7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4',
    member: 'ffmpeg',
    bin: 'ffmpeg'
  },
  'linux-x64': {
    url: 'https://ffmpeg.martin-riedl.de/download/linux/amd64/1789931100_9.0.2/ffmpeg.zip',
    sha256: 'fa8ecf4abbd290d98f7d188b8649cc6b391ae209a98452be955a15aab1909d7f',
    member: 'ffmpeg',
    bin: 'ffmpeg'
  }
}

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
  const zip = Buffer.from(await response.arrayBuffer())

  const digest = createHash('sha256').update(zip).digest('hex')
  if (digest !== pin.sha256) {
    throw new Error(`checksum mismatch for ${target}: expected ${pin.sha256}, got ${digest}`)
  }

  const binary = extractMember(zip, pin.member)
  // Write beside, then rename: an interrupted run never leaves half a binary.
  writeFileSync(`${dest}.tmp`, binary)
  if (process.platform !== 'win32') chmodSync(`${dest}.tmp`, 0o755)
  renameSync(`${dest}.tmp`, dest)
  console.log(`  wrote ${dest} (${(binary.length / 1048576).toFixed(1)} MB)`)

  // Only runnable when it is this machine's own platform, which in CI it is.
  if (target === `${process.platform}-${process.arch}`) {
    const banner = execFileSync(dest, ['-hide_banner', '-version'], { encoding: 'utf8' }).split('\n')[0]
    if (!banner.includes(`version ${VERSION}`)) throw new Error(`unexpected binary: ${banner}`)
    console.log(`  runs: ${banner}`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`fetch-ffmpeg: ${err.message}`)
    process.exit(1)
  })
}
