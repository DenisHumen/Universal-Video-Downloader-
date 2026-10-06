import { app } from 'electron'
import { execFile } from 'child_process'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'fs'
import { homedir } from 'os'
import { join, posix } from 'path'
import type { CliInstallMethod, CliInstallResult, CliStatus } from '@shared/types'
import { log } from './log'
import { mt } from './locale'

/**
 * Settings -> system -> terminal command: is `uvd` there, and put it there.
 *
 * The command itself is build/uvd, shipped inside the app; this only decides
 * how a terminal gets to it. The .deb and .rpm link it into /usr/bin when they
 * install, and the AUR package does the same, so those have nothing to do. A
 * disk image cannot touch the PATH, so macOS needed a `sudo ln` copied out of
 * the README; an AppImage is a single file with no script inside it to link,
 * so it needed an alias. Both are one click here now.
 *
 * Everything that decides something is a pure function below, tested in
 * cli-install.test.ts; the rest only reads and writes files.
 */

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Where the command goes on a Mac: on the PATH macOS ships with, in /etc/paths. */
export const MAC_TARGET = '/usr/local/bin/uvd'

/** Where the Linux packages put it, from build/linux/after-install.sh and the PKGBUILD. */
export const PACKAGE_TARGET = '/usr/bin/uvd'

/** The `resources/package-type` values whose package links the command itself. */
const MANAGED_PACKAGES = new Set(['deb', 'rpm', 'pacman'])

export interface CliPlanInput {
  platform: NodeJS.Platform
  packaged: boolean
  /** The contents of `resources/package-type`, if the build has one. */
  packageType?: string
  /** `process.env.APPIMAGE`: the AppImage file this run was started from. */
  appImage?: string
  /** The wrapper script exists inside this build. */
  hasWrapper: boolean
}

/**
 * Which way this build gets the command onto the PATH.
 *
 * Windows first: there is no wrapper for it, so the row is not shown even in
 * development. electron-builder writes `package-type` into the .deb and .rpm
 * (the AUR recipe rewrites it to `pacman`), and electron-updater reads the
 * same file to tell those installs from an AppImage, so it is the one record
 * of how this copy was installed. An AppImage is checked after it because an
 * AppImage never has the file.
 */
export function cliPlan(input: CliPlanInput): CliInstallMethod {
  if (input.platform === 'win32') return 'none'
  if (!input.packaged) return 'development'
  if (input.platform === 'darwin') return input.hasWrapper ? 'link' : 'none'
  if (input.platform !== 'linux') return 'none'
  if (input.packageType && MANAGED_PACKAGES.has(input.packageType.trim())) return 'package'
  if (input.appImage) return 'script'
  return 'none'
}

/**
 * One argument for /bin/sh, whatever it contains.
 *
 * Single quotes keep everything literal - spaces, `$`, backslashes, even a
 * newline - and the one character they cannot hold, a single quote, is closed,
 * escaped and reopened: `'it'\''s'`.
 */
export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`
}

/** An AppleScript string literal: only the backslash and the double quote need escaping. */
export function appleScriptString(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * The shell command the administrator prompt runs: make the folder, then the link.
 *
 * `-n` so that a `uvd` which is itself a link to a folder is replaced, rather
 * than followed and a new link dropped inside that folder.
 */
export function macInstallCommand(wrapper: string, target = MAC_TARGET): string {
  return `mkdir -p ${shellQuote(posix.dirname(target))} && ln -sfn ${shellQuote(wrapper)} ${shellQuote(target)}`
}

/**
 * The AppleScript that runs `macInstallCommand` as administrator.
 *
 * `do shell script ... with administrator privileges` is the system's own
 * password prompt, the one a user has seen installers use. It is quoted twice
 * over and in this order: the paths for the shell, then the whole command for
 * AppleScript. osascript is started without a shell, so nothing quotes it a
 * third time. The prompt line says what the password is for, because macOS
 * otherwise asks for it with no reason given.
 */
export function macInstallScript(wrapper: string, prompt: string, target = MAC_TARGET): string {
  return (
    `do shell script ${appleScriptString(macInstallCommand(wrapper, target))}` +
    ` with prompt ${appleScriptString(prompt)} with administrator privileges`
  )
}

/**
 * Whether osascript failed because the password prompt was dismissed.
 *
 * AppleScript's "User canceled" is error -128. Closing the prompt is a choice,
 * not a fault, so it gets no error message - only the row left as it was.
 */
export function isUserCancel(stderr: string): boolean {
  return /\(-128\)|user cancel+ed/i.test(stderr)
}

/**
 * Whether the app is running from somewhere a link to it would not outlive.
 *
 * Opened straight from the disk image, it lives under /Volumes until the image
 * is ejected. Still quarantined, macOS runs it from a randomised read-only copy
 * under AppTranslocation that is gone at the next launch. A link to either
 * works for a few minutes and then points at nothing, with no clue why.
 */
export function isTemporaryLocation(wrapper: string): boolean {
  return wrapper.startsWith('/Volumes/') || wrapper.includes('/AppTranslocation/')
}

/**
 * What the link at `linkPath`, whose value is `value`, means for this copy.
 *
 * `ours` when it reaches this app's wrapper. `stale` when it reaches the
 * wrapper inside some other copy of the app - an older one, or this one before
 * it was moved - which installing should simply repoint. `foreign` for
 * anything else: another program that happens to be called uvd.
 */
export function classifyLink(value: string, linkPath: string, wrapper: string): 'ours' | 'stale' | 'foreign' {
  const resolved = posix.resolve(posix.dirname(linkPath), value)
  if (resolved === posix.normalize(wrapper)) return 'ours'
  return /\/Contents\/Resources\/bin\/uvd$/.test(resolved) ? 'stale' : 'foreign'
}

/** The line that marks a script in ~/.local/bin as one this app wrote. */
export const SCRIPT_MARKER = '# Written by Universal Video Downloader (Settings, system)'

/** Whether `text` is a script this app wrote, and so one it may rewrite. */
export function isOurScript(text: string): boolean {
  return text.split('\n').some((line) => line.trim() === SCRIPT_MARKER)
}

/*
  The version electron-builder writes into an AppImage's name, and the
  pre-release tag it may carry. Not a general semver pattern: the name goes on
  with `-linux-x86_64`, which a general pre-release pattern would swallow.
*/
const VERSION_IN_NAME = /\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)(?:\.\d+)*)?/

/**
 * The script in ~/.local/bin that starts the AppImage at `appImage` with --cli.
 *
 * It does what build/uvd does for an installed app, minus the finding: start
 * the binary with `--cli` and the arguments, and with no display at all (an
 * SSH session) tell Chromium not to look for one.
 *
 * The updater does not keep the AppImage's path. When the file name carries a
 * version, as the release downloads' names do, it writes the new version beside
 * the old one under the new name and deletes the old. The app rewrites this
 * script at its next launch, but an update installed on quit has no next launch
 * until somebody opens the app - so the script also looks beside the old path
 * for the file the update put there, by the same name with any version.
 */
export function appImageScript(appImage: string): string {
  const dir = posix.dirname(appImage)
  const name = posix.basename(appImage)
  const version = VERSION_IN_NAME.exec(name)
  const lines = [
    '#!/bin/sh',
    '# uvd - download a video from the terminal with Universal Video Downloader.',
    SCRIPT_MARKER,
    '# to start the AppImage below with --cli. The app rewrites it when the AppImage',
    '# moves; delete this file to remove the command.',
    '',
    `app=${shellQuote(appImage)}`
  ]
  if (version) {
    const before = name.slice(0, version.index)
    const after = name.slice(version.index + version[0].length)
    lines.push(
      'if [ ! -x "$app" ]; then',
      '    # An update replaces the AppImage with one named after the new version.',
      `    for candidate in ${shellQuote(`${dir}/${before}`)}*${shellQuote(after)}; do`,
      '        [ -x "$candidate" ] && app=$candidate',
      '    done',
      'fi'
    )
  }
  lines.push(
    'if [ ! -x "$app" ]; then',
    '    echo "uvd: Universal Video Downloader is no longer at $app." >&2',
    '    echo "     Open the app and install the command again from Settings, system." >&2',
    '    exit 1',
    'fi',
    '',
    '# Without a display (an SSH session, a server) Chromium cannot start its usual',
    '# window system at all, even for a run that never opens a window.',
    'if [ -z "$DISPLAY" ] && [ -z "$WAYLAND_DISPLAY" ]; then',
    '    exec "$app" --ozone-platform=headless --cli "$@"',
    'fi',
    'exec "$app" --cli "$@"',
    ''
  )
  return lines.join('\n')
}

/**
 * Whether `dir` is one of the folders in a PATH value.
 *
 * Entries are compared without a trailing slash, and a literal `~` or `$HOME`
 * at the start - which some profiles write and the shell expands - counts as
 * the home folder.
 */
export function dirOnPath(dir: string, pathValue: string | undefined, home: string): boolean {
  const clean = (entry: string): string =>
    entry.replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, home).replace(/\/+$/, '') || '/'
  const wanted = clean(dir)
  return (pathValue ?? '').split(':').some((entry) => entry && clean(entry) === wanted)
}

// ---------------------------------------------------------------------------
// The machine
// ---------------------------------------------------------------------------

function readPackageType(): string | undefined {
  try {
    return readFileSync(join(process.resourcesPath, 'package-type'), 'utf-8').trim()
  } catch {
    return undefined
  }
}

function macWrapper(): string {
  return join(process.resourcesPath, 'bin', 'uvd')
}

function scriptTarget(): string {
  return posix.join(homedir(), '.local', 'bin', 'uvd')
}

function plan(): CliInstallMethod {
  return cliPlan({
    platform: process.platform,
    packaged: app.isPackaged,
    packageType: process.platform === 'linux' ? readPackageType() : undefined,
    appImage: process.env.APPIMAGE,
    hasWrapper: process.platform === 'darwin' && existsSync(macWrapper())
  })
}

/** What is at `path` without following it: a link's value, a file's text, or nothing. */
function inspect(path: string): { kind: 'missing' } | { kind: 'link'; value: string } | { kind: 'file'; text: string } {
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) return { kind: 'link', value: readlinkSync(path) }
    // Only the first few lines matter, and a stray binary called uvd can be large.
    return { kind: 'file', text: stat.size > 64 * 1024 ? '' : readFileSync(path, 'utf-8') }
  } catch {
    return { kind: 'missing' }
  }
}

export function getCliStatus(): CliStatus {
  const method = plan()
  if (method === 'none' || method === 'development') return { method, installed: false }
  if (method === 'package') return { method, installed: existsSync(PACKAGE_TARGET), path: PACKAGE_TARGET }

  if (method === 'link') {
    const wrapper = macWrapper()
    const found = inspect(MAC_TARGET)
    const link = found.kind === 'link' ? classifyLink(found.value, MAC_TARGET, wrapper) : undefined
    return {
      method,
      installed: link === 'ours',
      path: MAC_TARGET,
      occupied: found.kind === 'file' || link === 'foreign',
      temporary: isTemporaryLocation(wrapper)
    }
  }

  const target = scriptTarget()
  const found = inspect(target)
  const ours = found.kind === 'file' && isOurScript(found.text)
  return {
    method,
    installed: ours,
    path: target,
    occupied: found.kind !== 'missing' && !ours,
    onPath: dirOnPath(posix.dirname(target), process.env.PATH, homedir())
  }
}

function runOsascript(script: string): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    // Two minutes is plenty to type a password, and stops a prompt left open forever from pinning this.
    execFile('/usr/bin/osascript', ['-e', script], { timeout: 120_000 }, (error, _stdout, stderr) => {
      resolve({ ok: !error, stderr: String(stderr || (error ? error.message : '')) })
    })
  })
}

/**
 * Write the AppImage's script into place.
 *
 * Written beside the target and renamed over it, so a terminal never runs half
 * a script, and so a `uvd` that is a symlink is replaced as a link rather than
 * followed - writing through it would overwrite whatever file it points at.
 */
function writeScript(target: string, appImage: string): void {
  mkdirSync(posix.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.tmp`
  try {
    writeFileSync(temporary, appImageScript(appImage), { encoding: 'utf-8', mode: 0o755 })
    chmodSync(temporary, 0o755)
    renameSync(temporary, target)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

export async function installCli(): Promise<CliInstallResult> {
  const before = getCliStatus()
  try {
    if (before.method === 'link') {
      if (before.temporary) return { ok: false, error: 'temporary location', status: before }
      const result = await runOsascript(macInstallScript(macWrapper(), mt('cli.adminPrompt')))
      if (!result.ok) {
        if (isUserCancel(result.stderr)) return { ok: false, canceled: true, status: getCliStatus() }
        log.warn('cli', 'Could not link the terminal command', { why: result.stderr.trim().slice(0, 300) })
        return { ok: false, error: result.stderr.trim(), status: getCliStatus() }
      }
    } else if (before.method === 'script' && process.env.APPIMAGE) {
      writeScript(scriptTarget(), process.env.APPIMAGE)
    } else {
      return { ok: false, error: 'not installable here', status: before }
    }
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    log.warn('cli', 'Could not install the terminal command', { why })
    return { ok: false, error: why, status: getCliStatus() }
  }
  const status = getCliStatus()
  log.info('cli', 'Installed the terminal command', { method: status.method, installed: String(status.installed) })
  return status.installed ? { ok: true, status } : { ok: false, error: 'not found after installing', status }
}

/**
 * Keep an AppImage's script pointing at the AppImage that is running.
 *
 * Called once per launch. An update renames the AppImage, and the script
 * written before it still names the old file; it can find the new one by
 * itself, but only while the old name's pattern still fits. Rewriting it here
 * puts the exact path back. A `uvd` the app did not write is never touched.
 */
export function refreshCliScript(): void {
  const appImage = process.env.APPIMAGE
  if (plan() !== 'script' || !appImage) return
  const target = scriptTarget()
  const found = inspect(target)
  if (found.kind !== 'file' || !isOurScript(found.text)) return
  if (found.text === appImageScript(appImage)) return
  try {
    writeScript(target, appImage)
    log.info('cli', 'Pointed the terminal command at the updated AppImage')
  } catch (error) {
    log.warn('cli', 'Could not update the terminal command', {
      why: error instanceof Error ? error.message : String(error)
    })
  }
}
