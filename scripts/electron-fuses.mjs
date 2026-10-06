/**
 * Electron's fuses: switches compiled into the Electron binary, read before any
 * of the app's own code runs, and the only way to close the doors Electron
 * leaves open for running other code as this app.
 *
 * With Electron's defaults, any program on the machine could start the
 * installed app as a plain Node runtime (ELECTRON_RUN_AS_NODE=1), have it load
 * a script of its choosing first (NODE_OPTIONS=--require …), attach a debugger
 * to it (--inspect), or drop a loose resources/app folder beside app.asar and
 * have that run instead. Each of those runs under the app's identity, with the
 * key the operating system keeps for it — the one that decrypts the SMB
 * passwords and the Telegram token in secrets.dat — and with the sites the
 * user is signed into.
 *
 * electron-builder 26 flips these with `electronFuses`; 25 rejects the key and
 * every build would fail, and @electron/fuses would be a new dependency. So
 * this is Electron's documented wire format (docs/tutorial/fuses.md), by hand:
 *
 *   <the 32-byte sentinel> <wire version, 1 byte> <fuse count, 1 byte> <fuses>
 *
 * one byte per fuse, '0' off, '1' on, 'r' removed from this Electron, in an
 * order fixed by the wire version. On macOS the wire is not in the app's
 * executable, which only loads Electron Framework; it is in the framework.
 *
 * Imported by scripts/after-pack.mjs, which flips them in every packed app, by
 * scripts/check-fuses.mjs, which reads them back from what electron-builder
 * finally left, and by scripts/check-linux-packages.mjs, from the .deb.
 */
import { join } from 'path'

export const SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'

/** The only wire version there is. Another one means the fuse order below is stale. */
export const WIRE_VERSION = 1

/** Wire version 1, in wire order. Electron 33 carries the first eight. */
export const FUSES = [
  'RunAsNode',
  'EnableCookieEncryption',
  'EnableNodeOptionsEnvironmentVariable',
  'EnableNodeCliInspectArguments',
  'EnableEmbeddedAsarIntegrityValidation',
  'OnlyLoadAppFromAsar',
  'LoadBrowserProcessSpecificV8Snapshot',
  'GrantFileProtocolExtraPrivileges'
]

/**
 * What ships. Everything else stays as Electron sets it, on purpose:
 *  - EnableEmbeddedAsarIntegrityValidation would stop the app at startup on
 *    Windows, where electron-builder 25 embeds no integrity resource to check,
 *    and Linux does not support it at all;
 *  - EnableCookieEncryption converts the cookie store one way only, and can
 *    bring up keyring prompts on Linux. A decision of its own, not this one.
 */
export const SHIPPED_FUSES = {
  RunAsNode: false,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  OnlyLoadAppFromAsar: true
}

const OFF = 0x30
const ON = 0x31
const STATE = { [OFF]: 'off', [ON]: 'on', 0x72: 'removed' }

const NO_WIRE =
  'no fuse wire in this file: it is not an Electron binary, or not the file of the bundle that holds the wire'

/** Every fuse wire in a binary: one, or one per slice of a universal Mac binary. */
export function fuseWires(buf) {
  const sentinel = Buffer.from(SENTINEL, 'latin1')
  const wires = []
  for (let at = buf.indexOf(sentinel); at !== -1; at = buf.indexOf(sentinel, at + 1)) {
    const header = at + sentinel.length
    wires.push({ at, version: buf[header], length: buf[header + 1], start: header + 2 })
  }
  return wires
}

/** The state of each fuse in one wire, by name. */
export function fuseStates(buf, wire) {
  const states = {}
  for (let i = 0; i < wire.length && wire.start + i < buf.length; i++) {
    const byte = buf[wire.start + i]
    states[FUSES[i] ?? `fuse ${i}`] = STATE[byte] ?? `0x${byte.toString(16)}`
  }
  return states
}

/** Why `wanted` cannot be written into this wire. Nothing is changed. */
function wireProblems(buf, wire, wanted) {
  if (wire.version !== WIRE_VERSION) {
    return [
      `the fuse wire is version ${wire.version}, and only version ${WIRE_VERSION} is known here: ` +
        `its fuses may be in another order, so none are flipped`
    ]
  }
  if (wire.start + wire.length > buf.length) return ['the fuse wire runs past the end of the file']
  const states = fuseStates(buf, wire)
  const problems = []
  for (const name of Object.keys(wanted)) {
    const index = FUSES.indexOf(name)
    if (index === -1) problems.push(`${name} is not a fuse of wire version ${WIRE_VERSION}`)
    else if (index >= wire.length)
      problems.push(`${name} is not in this Electron, whose wire has ${wire.length} fuses`)
    else if (states[name] === 'removed') problems.push(`${name} has been removed from this Electron`)
    else if (states[name] !== 'on' && states[name] !== 'off')
      problems.push(`${name} holds ${states[name]}, which is not a fuse state`)
  }
  return problems
}

/** Why this binary's fuses are not set as `wanted`. Empty when they are. */
export function fuseProblems(buf, wanted = SHIPPED_FUSES) {
  const wires = fuseWires(buf)
  if (wires.length === 0) return [NO_WIRE]
  const problems = []
  for (const wire of wires) {
    const broken = wireProblems(buf, wire, wanted)
    if (broken.length > 0) {
      problems.push(...broken)
      continue
    }
    const states = fuseStates(buf, wire)
    for (const [name, on] of Object.entries(wanted)) {
      const want = on ? 'on' : 'off'
      if (states[name] !== want) problems.push(`${name} is ${states[name]}, should be ${want}`)
    }
  }
  return problems
}

/**
 * Set the fuses in `buf` as `wanted`, in place, in every wire it holds, and
 * return how many that was. All or nothing: a wire it cannot read throws
 * before a single byte is changed, since a half-flipped binary is no use.
 */
export function flipFuses(buf, wanted = SHIPPED_FUSES) {
  const wires = fuseWires(buf)
  const problems =
    wires.length === 0 ? [NO_WIRE] : wires.flatMap((wire) => wireProblems(buf, wire, wanted))
  if (problems.length > 0) throw new Error(problems.join('\n'))
  for (const wire of wires) {
    for (const [name, on] of Object.entries(wanted)) {
      buf[wire.start + FUSES.indexOf(name)] = on ? ON : OFF
    }
  }
  return wires.length
}

/**
 * The file that holds the fuse wire in an app electron-builder has packed:
 * the names it gives the executable on each platform, and on macOS the
 * framework the executable loads (Contents/MacOS has no wire in it).
 */
export function fuseBinaryPath(platform, appOutDir, { productFilename, executableName }) {
  switch (platform) {
    case 'darwin':
      return join(
        appOutDir,
        `${productFilename}.app`,
        'Contents',
        'Frameworks',
        'Electron Framework.framework',
        'Electron Framework'
      )
    case 'win32':
      return join(appOutDir, `${productFilename}.exe`)
    case 'linux':
      if (!executableName) throw new Error('a Linux app needs its executable name')
      return join(appOutDir, executableName)
    default:
      throw new Error(`no Electron fuse location known for ${platform}`)
  }
}
