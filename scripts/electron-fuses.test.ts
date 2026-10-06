import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  FUSES,
  SENTINEL,
  SHIPPED_FUSES,
  WIRE_VERSION,
  flipFuses,
  fuseBinaryPath,
  fuseProblems,
  fuseStates,
  fuseWires
} from './electron-fuses.mjs'

/** The wire Electron 33.4.11 ships with, read out of its electron.exe. */
const ELECTRON_33 = '10110001'

/** As much of an Electron binary as the fuses need: some code, the wire, more code. */
function binary(wire = ELECTRON_33, { version = WIRE_VERSION, copies = 1 } = {}): Buffer {
  const code = (n: number): Buffer => Buffer.alloc(n, 0xcc)
  const parts: Buffer[] = [code(4096)]
  for (let i = 0; i < copies; i++) {
    parts.push(
      Buffer.from(SENTINEL, 'latin1'),
      Buffer.from([version, wire.length]),
      Buffer.from(wire, 'latin1'),
      code(512)
    )
  }
  return Buffer.concat(parts)
}

const wireOf = (buf: Buffer): string[] =>
  fuseWires(buf).map((w) => buf.toString('latin1', w.start, w.start + w.length))

describe('reading the fuse wire', () => {
  it('names each fuse in wire order', () => {
    const buf = binary()
    const [wire] = fuseWires(buf)
    expect(wire.version).toBe(1)
    expect(fuseStates(buf, wire)).toEqual({
      RunAsNode: 'on',
      EnableCookieEncryption: 'off',
      EnableNodeOptionsEnvironmentVariable: 'on',
      EnableNodeCliInspectArguments: 'on',
      EnableEmbeddedAsarIntegrityValidation: 'off',
      OnlyLoadAppFromAsar: 'off',
      LoadBrowserProcessSpecificV8Snapshot: 'off',
      GrantFileProtocolExtraPrivileges: 'on'
    })
  })

  // What every release up to v3.20.0 shipped: all four doors open.
  it('names what is wrong with Electron as it comes', () => {
    expect(fuseProblems(binary())).toEqual([
      'RunAsNode is on, should be off',
      'EnableNodeOptionsEnvironmentVariable is on, should be off',
      'EnableNodeCliInspectArguments is on, should be off',
      'OnlyLoadAppFromAsar is off, should be on'
    ])
  })

  // On a Mac the executable only loads Electron Framework; pointing at it
  // instead of the framework must not pass as "nothing to flip".
  it('refuses a file without a wire', () => {
    expect(fuseProblems(Buffer.alloc(8192, 0xcc))).toEqual([
      expect.stringMatching(/^no fuse wire in this file/)
    ])
  })
})

describe('flipping the fuses', () => {
  it('turns off RunAsNode, NODE_OPTIONS and --inspect, and loads only app.asar', () => {
    const buf = binary()
    expect(flipFuses(buf)).toBe(1)
    expect(wireOf(buf)).toEqual(['00000101'])
    expect(fuseProblems(buf)).toEqual([])
  })

  // It rewrites a 180 MB executable in place: anything beyond those four bytes
  // would be a corrupt app.
  it('changes those four bytes and nothing else', () => {
    const before = binary()
    const after = Buffer.from(before)
    flipFuses(after)
    const changed = [...before.keys()].filter((i) => before[i] !== after[i])
    const start = fuseWires(before)[0].start
    expect(changed).toEqual([0, 2, 3, 5].map((i) => start + i))
  })

  it('is the same app the second time', () => {
    const once = binary()
    flipFuses(once)
    const twice = Buffer.from(once)
    flipFuses(twice)
    expect(twice.equals(once)).toBe(true)
  })

  // A universal Mac binary carries one wire per architecture; Electron reads
  // whichever slice runs.
  it('flips every wire in the file', () => {
    const buf = binary(ELECTRON_33, { copies: 2 })
    expect(flipFuses(buf)).toBe(2)
    expect(wireOf(buf)).toEqual(['00000101', '00000101'])
  })

  // The order of the fuses belongs to the wire version; under another version
  // the same offsets could switch on something else entirely.
  it('refuses a wire version it does not know, and changes nothing', () => {
    const buf = binary(ELECTRON_33, { version: 2 })
    const copy = Buffer.from(buf)
    expect(() => flipFuses(buf)).toThrow(/version 2, and only version 1 is known/)
    expect(buf.equals(copy)).toBe(true)
  })

  it('refuses an Electron too old to have the fuse, and changes nothing', () => {
    const buf = binary('1011')
    const copy = Buffer.from(buf)
    expect(() => flipFuses(buf)).toThrow(/OnlyLoadAppFromAsar is not in this Electron/)
    expect(buf.equals(copy)).toBe(true)
  })

  it('refuses a fuse Electron has removed', () => {
    expect(() => flipFuses(binary('r0110001'))).toThrow(/RunAsNode has been removed/)
  })

  it('refuses a byte that is not a fuse state', () => {
    expect(() => flipFuses(binary('101x0001'))).toThrow(/EnableNodeCliInspectArguments holds 0x78/)
  })

  it('refuses a file without a wire', () => {
    expect(() => flipFuses(Buffer.alloc(64))).toThrow(/no fuse wire/)
  })
})

describe('what ships', () => {
  // Asar integrity would stop the app at startup on Windows, where
  // electron-builder 25 embeds nothing to check; cookie encryption converts
  // the store one way and brings up keyring prompts on Linux.
  it('leaves asar integrity and cookie encryption as Electron sets them', () => {
    expect(Object.keys(SHIPPED_FUSES)).not.toContain('EnableEmbeddedAsarIntegrityValidation')
    expect(Object.keys(SHIPPED_FUSES)).not.toContain('EnableCookieEncryption')
    for (const name of Object.keys(SHIPPED_FUSES)) expect(FUSES).toContain(name)
  })
})

describe('where the wire is', () => {
  const names = { productFilename: 'Universal Video Downloader', executableName: 'uvd' }

  it('is the executable on Windows and Linux, under the names electron-builder gives it', () => {
    expect(fuseBinaryPath('win32', 'out', names)).toBe(join('out', 'Universal Video Downloader.exe'))
    expect(fuseBinaryPath('linux', 'out', names)).toBe(join('out', 'uvd'))
  })

  // Contents/MacOS holds a small launcher; Electron itself is the framework.
  it('is Electron Framework on a Mac', () => {
    expect(fuseBinaryPath('darwin', 'out', names)).toBe(
      join(
        'out',
        'Universal Video Downloader.app',
        'Contents',
        'Frameworks',
        'Electron Framework.framework',
        'Electron Framework'
      )
    )
  })
})

// The Electron this repository actually builds with, wherever the tests run:
// the format above is only worth anything if it is the one in that binary.
// path.txt names the executable; on a Mac the wire is in the framework instead.
const dist = join('node_modules', 'electron', 'dist')
const pathTxt = join('node_modules', 'electron', 'path.txt')
const realElectron = !existsSync(pathTxt)
  ? ''
  : process.platform === 'darwin'
    ? fuseBinaryPath('darwin', dist, { productFilename: 'Electron' })
    : join(dist, readFileSync(pathTxt, 'utf-8').trim())

describe.skipIf(!realElectron || !existsSync(realElectron))('the Electron in node_modules', () => {
  it('carries one version 1 wire with every fuse named here, and it flips cleanly', () => {
    const buf = readFileSync(realElectron)
    const wires = fuseWires(buf)
    expect(wires.length).toBe(1)
    expect(wires[0].version).toBe(WIRE_VERSION)
    expect(wires[0].length).toBeGreaterThanOrEqual(FUSES.length)
    flipFuses(buf)
    expect(fuseProblems(buf)).toEqual([])
  })
})
