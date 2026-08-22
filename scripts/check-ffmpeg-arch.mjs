/**
 * Refuse to package an ffmpeg built for the wrong machine.
 *
 * `ffmpeg-static` downloads exactly one binary at install time, chosen by
 * `npm_config_arch || os.arch()` — the architecture of whatever ran `npm ci`.
 * electron-builder then copies that same `node_modules` into every target it
 * was asked for. Build `--mac --arm64 --x64` on an Apple Silicon runner and the
 * Intel disk image receives the Apple Silicon ffmpeg.
 *
 * Nothing catches that: ffmpeg-static is not a native node module, so
 * `@electron/rebuild` never looks at it, and the failure only appears on a
 * user's Intel Mac as `spawn … Bad CPU type in executable` — surfaced by
 * `runFfmpeg` as a bare OS string, on every merge, trim and convert. Which is
 * to say on essentially every video download, since the default format is a
 * separate video and audio stream that have to be merged.
 *
 * So: read the binary's own header and compare it against the architecture we
 * are about to package for. No `file(1)`, no platform-specific tooling — the
 * three executable formats all state their machine type in the first few bytes.
 *
 *   node scripts/check-ffmpeg-arch.mjs            # against the host
 *   node scripts/check-ffmpeg-arch.mjs --arch=x64 # against a cross-build target
 */
import { openSync, readSync, closeSync } from 'fs'
import { arch as hostArch } from 'os'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

const wanted = (process.argv.find((a) => a.startsWith('--arch=')) || '').slice(7) || hostArch()

/** Mach-O (macOS). `cputype` sits right after the magic, little-endian. */
const MACHO_CPU = { 0x01000007: 'x64', 0x0100000c: 'arm64', 0x00000007: 'ia32', 0x0000000c: 'arm' }
/** ELF (Linux). `e_machine`, a 16-bit value at offset 0x12. */
const ELF_MACHINE = { 0x3e: 'x64', 0xb7: 'arm64', 0x03: 'ia32', 0x28: 'arm' }
/** PE (Windows). `Machine`, the first field of the COFF header. */
const PE_MACHINE = { 0x8664: 'x64', 0xaa64: 'arm64', 0x014c: 'ia32', 0x01c0: 'arm' }

/**
 * The architecture a binary is built for, or a description of why we can't say.
 * A universal/fat Mach-O counts as every arch it contains.
 */
export function readArch(buf, readAt) {
  const be32 = (o) => buf.readUInt32BE(o)
  const le32 = (o) => buf.readUInt32LE(o)

  // Mach-O, thin: cffaedfe (64-bit) / cefaedfe (32-bit), little-endian on disk.
  const magic = be32(0)
  if (magic === 0xcffaedfe || magic === 0xcefaedfe) {
    return { arches: [MACHO_CPU[le32(4)] ?? `mach-o:0x${le32(4).toString(16)}`], format: 'Mach-O' }
  }
  // Mach-O, universal: a count of (cputype, …) records after the magic.
  if (magic === 0xcafebabe || magic === 0xcafebabf) {
    const count = be32(4)
    const arches = []
    for (let i = 0; i < Math.min(count, 8); i++) {
      const cpu = be32(8 + i * 20)
      arches.push(MACHO_CPU[cpu] ?? `mach-o:0x${cpu.toString(16)}`)
    }
    return { arches, format: 'Mach-O universal' }
  }
  // ELF
  if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
    const machine = buf.readUInt16LE(0x12)
    return { arches: [ELF_MACHINE[machine] ?? `elf:0x${machine.toString(16)}`], format: 'ELF' }
  }
  // PE: 'MZ', then a pointer at 0x3c to the 'PE\0\0' signature.
  if (buf[0] === 0x4d && buf[1] === 0x5a) {
    const peAt = buf.readUInt32LE(0x3c)
    const head = readAt(peAt, 6)
    if (head.readUInt32LE(0) === 0x00004550) {
      const machine = head.readUInt16LE(4)
      return { arches: [PE_MACHINE[machine] ?? `pe:0x${machine.toString(16)}`], format: 'PE' }
    }
  }
  return { arches: [], format: 'unrecognised' }
}

const binary = require('ffmpeg-static')
if (!binary) {
  console.error('ffmpeg-static resolved to null — no binary for this platform/arch.')
  process.exit(1)
}

const fd = openSync(binary, 'r')
const readAt = (pos, len) => {
  const b = Buffer.alloc(len)
  readSync(fd, b, 0, len, pos)
  return b
}
const head = readAt(0, 4096)
// Closed after readArch, not before: the PE branch follows a pointer out of the
// header and needs the descriptor to still be open.
const { arches, format } = readArch(head, readAt)
closeSync(fd)
const ok = arches.includes(wanted)

console.log(`ffmpeg: ${binary}`)
console.log(`  format   ${format}`)
console.log(`  built for ${arches.join(', ') || 'unknown'}`)
console.log(`  packaging for ${wanted}`)

if (!ok) {
  console.error(
    `\n✗ This ffmpeg cannot run on ${wanted}.\n` +
      `  ffmpeg-static downloads one binary for the machine that ran npm install.\n` +
      `  Build each architecture on its own runner, or reinstall it first:\n` +
      `      npm_config_arch=${wanted} npm rebuild ffmpeg-static\n`
  )
  process.exit(1)
}
console.log('\n✓ ffmpeg matches the target architecture')
