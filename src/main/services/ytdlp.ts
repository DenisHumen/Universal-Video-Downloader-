import { app, net, powerMonitor } from 'electron'
import { EventEmitter } from 'events'
import { spawn, execFileSync } from 'child_process'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  chmodSync,
  readFileSync,
  statSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'fs'
import { mkdir, readFile, readdir, rename, rm } from 'fs/promises'
import { createHash, randomBytes } from 'crypto'
import { homedir } from 'os'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import type { YtDlpStatus } from '@shared/types'
import {
  denoDirName,
  denoExeName,
  denoOnPath,
  denoPin,
  denoUrl,
  isPinnedBanner,
  runtimeFetchBlocked,
  staleRuntimeEntries,
  trackRuntimeInstall,
  useJsRuntime,
  withJsRuntime,
  type DenoPin
} from './js-runtime'
import {
  activate,
  cleanEngineDir,
  engineAssets,
  migrationBlocked,
  onedirExe,
  parseMigrationFailure,
  parseSums,
  planEngine,
  readPointer,
  stageOnedir,
  unpackZip,
  verifyHash,
  type EngineAssets,
  type MigrationFailure
} from './engine-dist'
import { EngineTrustError, verifyDetached } from './engine-signature'
import { groupSpawnOptions } from './process'
import { log } from './log'
import { proxyEnv } from './options'
import { getSettings } from './settings'
import { proxyMayBeWhy } from '../../renderer/src/lib/engineError'
import { proxyUrl, withProxyAuth } from './proxy-auth'
import {
  afterFailure,
  afterRefusal,
  afterSuccess,
  parseRefreshState,
  refreshDue,
  REFRESH_LAUNCH_DELAY,
  REFRESH_RESUME_DELAY,
  REFRESH_TICK,
  retryDelay,
  runRefresh,
  type RefreshState
} from './engine-refresh'

export const ytdlpEvents = new EventEmitter()

let currentStatus: YtDlpStatus = { state: 'idle' }
let ensurePromise: Promise<string> | null = null
/** Where the engine was when `ensurePromise` last answered, to notice it gone. */
let ensuredAt: string | null = null
/** This install is the move out of the shared folder, which the window says in its own words. */
let movingFromShared = false

function emit(given: YtDlpStatus): void {
  const status: YtDlpStatus = movingFromShared ? { ...given, moving: true } : { ...given }
  // Whatever says "ready" also carries a refused update, so nothing has to remember to.
  if (status.state === 'ready' && readRefreshState().refusedAt) status.refused = true
  currentStatus = status
  ytdlpEvents.emit('status', status)
}

export function getYtdlpStatus(): YtDlpStatus {
  return currentStatus
}

/**
 * Base directory for the engine binary and its scratch space.
 *
 * On Windows this was %PUBLIC%, because the one-file yt-dlp.exe would not unpack
 * under a non-Latin account name (`[PYI...] Failed to extract entry`). But every
 * local user can modify anything in there, so on a shared PC any one of them could
 * replace the program every other account then ran. The engine has been a onedir
 * copy for a while now, with nothing to unpack: checked with the real build, it
 * starts and downloads from a folder and a TEMP in Cyrillic, Chinese, Hebrew and
 * accented Latin. %LOCALAPPDATA% is the one account's alone.
 */
function engineBaseDir(): string {
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'UniversalVideoDownloader')
  }
  return app.getPath('userData')
}

/**
 * Whether this account was using the old folder, going by what is in it.
 *
 * Only ever looked at. What is in there cannot be vouched for, since anybody on
 * the machine could have changed it, so it is neither run nor copied, and a
 * fresh copy is fetched instead. It is not deleted either: another account on an
 * older build may be running from it this minute.
 */
function hadSharedEngine(): boolean {
  if (process.platform !== 'win32') return false
  const shared = process.env.PUBLIC || 'C:\\Users\\Public'
  return existsSync(join(shared, 'UniversalVideoDownloader', 'bin'))
}

function binDir(): string {
  const dir = join(engineBaseDir(), 'bin')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** Deno and its cache, apart from `bin`, whose clean-up knows only the engine's own files. */
function jsRuntimeDir(): string {
  return join(engineBaseDir(), 'js-runtime')
}

/** ASCII-safe scratch dir used as TEMP/TMP for the engine on Windows. */
function engineTmpDir(): string {
  const dir = join(engineBaseDir(), 'tmp')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Spawn options shared by every yt-dlp invocation. On Windows we redirect the
 * child's TEMP/TMP to an ASCII path so the PyInstaller bootloader can extract.
 * The proxy travels here too, so it reaches every invocation - the version check
 * included, which never had it - and never the command line.
 */
export function ytdlpSpawnOptions(): {
  windowsHide: boolean
  env: NodeJS.ProcessEnv
  detached?: boolean
} {
  const env = proxyEnv({ ...process.env }, proxyUrl(getSettings()))
  /*
    These two do not make the engine speak UTF-8, whatever they look like.

    The binaries we ship are PyInstaller bundles, and measured with both set,
    yt-dlp.exe still wrote its pipes in the console's code page - cp1251 for a
    Cyrillic title. The comment that used to sit here claimed otherwise, and
    the destination paths parsed out of that output pointed at files that did
    not exist. What does the work is `--encoding utf-8`, which every engine
    command line now carries (buildArgs in downloader.ts, the probes in
    detector.ts, search.ts, and `spawnYtdlp` below). The variables stay only
    because they are harmless.
  */
  env.PYTHONIOENCODING = 'utf-8'
  env.PYTHONUTF8 = '1'
  /*
    The one thing Deno writes however it is run, its analysis cache, goes in the
    private folder rather than a shared %LOCALAPPDATA%\deno or ~/.cache/deno.
  */
  env.DENO_DIR = join(jsRuntimeDir(), 'cache')
  env.DENO_NO_UPDATE_CHECK = '1'
  if (process.platform === 'win32') {
    const tmp = engineTmpDir()
    env.TMP = tmp
    env.TEMP = tmp
  }
  // Group-spawned so `killTree` can take yt-dlp's own ffmpeg children with it.
  return { windowsHide: true, env, ...groupSpawnOptions() }
}

/** What the release offers this machine; see engine-dist.ts. Read once: neither can change while running. */
const ASSETS: EngineAssets = engineAssets(process.platform, process.arch)

/** The single-file engine's own name in the engine folder. */
function onefileName(): string {
  return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
}

/** Where the single-file engine lives, whether or not it is the one in use. */
function onefilePath(): string {
  return join(binDir(), onefileName())
}

/**
 * The engine every spawn runs: the active onedir copy when there is one,
 * otherwise the single file. Asked on every spawn, so a migration that
 * finishes mid-session takes effect at the next detect or download without
 * touching the ones already running.
 */
export function ytdlpBinaryPath(): string {
  return onedirExe(binDir()) ?? onefilePath()
}

const RELEASE_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'

/** When a migration to the onedir build last failed, so the next try waits a day. */
function migrationFailureFile(): string {
  return join(binDir(), 'migration-failed')
}

function lastMigrationFailure(): MigrationFailure | undefined {
  try {
    return parseMigrationFailure(readFileSync(migrationFailureFile(), 'utf-8'))
  } catch {
    return undefined
  }
}

function recordMigrationFailure(): void {
  const count = (lastMigrationFailure()?.count ?? 0) + 1
  try {
    writeFileSync(migrationFailureFile(), JSON.stringify({ at: Date.now(), count }), 'utf-8')
  } catch {
    /* the back-off is an optimisation */
  }
}

/** The onedir build is backing off after failing here; see `migrationBlocked`. */
function onedirBlocked(): boolean {
  return migrationBlocked(lastMigrationFailure(), Date.now())
}

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

/**
 * Download the engine binary using Electron's net module (Chromium's network
 * stack). This is far more reliable in the main process than Node's global
 * fetch (which can hang there) and transparently honours system proxies and
 * GitHub's redirect to the release asset.
 */
function fetchToFile(url: string, tmp: string, quietly = false): Promise<string> {
  return new Promise((resolve, reject) => {
    // Hashed as it arrives, so verifying a 60 MB zip never reads it whole on the main thread.
    const hash = createHash('sha256')
    const request = withProxyAuth(net.request({ url, redirect: 'follow' }), url)
    request.on('response', (response) => {
      const status = response.statusCode
      if (status >= 400) {
        reject(new Error(`Failed to download yt-dlp (HTTP ${status})`))
        return
      }
      const total = Number(headerValue(response.headers['content-length']) || 0)
      let received = 0
      const out = createWriteStream(tmp)
      out.on('error', reject)
      response.on('data', (chunk: Buffer) => {
        received += chunk.length
        hash.update(chunk)
        out.write(chunk)
        if (total && !quietly) {
          emit({
            state: 'downloading',
            percent: Math.min(99, Math.round((received / total) * 100)),
            message: 'Downloading download engine…'
          })
        }
      })
      response.on('end', () => out.end(() => resolve(hash.digest('hex'))))
      response.on('error', reject)
    })
    request.on('error', reject)
    request.end()
  })
}

/** Far more than the checksum list or its signature will ever be. */
const SMALL_FILE_LIMIT = 1024 * 1024

class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`Failed to download the engine's checksums (HTTP ${status})`)
  }
}

/** A small file from the release, as bytes: a signature is over bytes, not over what they decode to. */
function fetchSmallFile(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request = withProxyAuth(net.request({ url, redirect: 'follow' }), url)
    request.on('response', (response) => {
      if (response.statusCode >= 400) {
        reject(new HttpStatusError(response.statusCode))
        return
      }
      const chunks: Buffer[] = []
      let received = 0
      response.on('data', (chunk: Buffer) => {
        received += chunk.length
        if (received > SMALL_FILE_LIMIT) {
          request.abort()
          reject(new Error('The engine release sent far more than a checksum list.'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => resolve(Buffer.concat(chunks)))
      response.on('error', reject)
    })
    request.on('error', reject)
    request.end()
  })
}

/**
 * The release's SHA-256 of every asset, once yt-dlp's signature on the list has been checked.
 *
 * Every route that replaces the engine starts here, before a byte of it is
 * downloaded. A release with no signature is refused rather than excused: taking
 * it away is the first thing someone replacing the files would do. Only a clear
 * 404 means that, though; a 503 or a dropped connection is an ordinary failure to
 * fetch, and is reported as one.
 */
async function releaseSums(): Promise<Map<string, string>> {
  const [list, signature] = await Promise.all([
    fetchSmallFile(`${RELEASE_BASE}/SHA2-256SUMS`),
    fetchSmallFile(`${RELEASE_BASE}/SHA2-256SUMS.sig`).catch((err: unknown) => {
      if (err instanceof HttpStatusError && err.status === 404) {
        throw new EngineTrustError('no-signature', 'the release has no signature.')
      }
      throw err
    })
  ])
  const signed = verifyDetached(list, signature)
  log.info('engine', 'Checksum list signature is good', {
    signer: signed.fingerprint,
    signedAt: signed.signedAt.toISOString()
  })
  return parseSums(list.toString('utf-8'))
}

/**
 * Write down that an update failed its authenticity check, and why.
 *
 * The engine in use is not touched and is not the thing in doubt, so downloads
 * carry on. There is deliberately no way to accept the update anyway: an answer
 * to "install it regardless" is what someone who controls the release would most
 * like a person to give.
 */
function noteRefusal(err: EngineTrustError): void {
  log.warn('engine', 'Refused an engine update', { reason: err.reason, error: err.message })
  writeRefreshState(afterRefusal(readRefreshState(), Date.now()))
}

/** SHA-256 of a file on disk, read without holding the main thread. */
async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

/** The binary download in flight, shared by everyone who asks for one meanwhile. */
let downloading: Promise<void> | null = null

/**
 * A fresh copy of the engine over the old one, one at a time.
 *
 * Three paths can ask for this: `ensureYtdlp` replacing a binary that will not
 * start, the scheduled refresh finding a newer release, and the button
 * in Settings doing the same. All of them write the same `.download` file and
 * rename it over the same binary, so two at once truncated each other's half
 * of the file and whichever finished first moved the other's still-growing copy
 * into place - a corrupt engine that the next `--version` could not start. A
 * second caller now waits for the copy already on its way, which is the same
 * latest release it would have fetched itself.
 */
function downloadBinary(fallback: 'onefile' | 'none' = 'none'): Promise<void> {
  if (!downloading) {
    downloading = fetchBinary(fallback).finally(() => {
      downloading = null
    })
  }
  return downloading
}

/**
 * The newest engine.
 *
 * As a onedir copy where the release has one and it has not been failing
 * here. A onedir copy that fails - to download, to verify, to start - leaves
 * the engine that was active where it was and is rethrown. The single file is
 * fetched instead only when the caller says there is no engine at all to keep
 * (`fallback: 'onefile'`, a first install or a broken one), or when onedir is
 * backing off and a single file is what is in use: then this is that file's
 * ordinary refresh, run only by a caller that checked nothing is using it.
 * A background migration passes neither, so it can never overwrite a single
 * file a download is running from.
 */
async function fetchBinary(fallback: 'onefile' | 'none'): Promise<void> {
  const onedirActive = onedirExe(binDir()) !== null
  if (ASSETS.onedir && (onedirActive || !onedirBlocked())) {
    try {
      await installOnedir(ASSETS.onedir)
      return
    } catch (err) {
      /*
        Not a build that fails here, so no back-off, which would stop the next
        attempt from finding the problem gone. And no fallback: the single file
        is vouched for by the same list.
      */
      if (err instanceof EngineTrustError) throw err
      recordMigrationFailure()
      log.warn('engine', 'The onedir engine could not be installed', {
        error: err instanceof Error ? err.message : String(err)
      })
      if (fallback !== 'onefile' || onedirActive || !ASSETS.onefile) throw err
    }
  }
  if (onedirActive) throw new Error('The engine update is waiting after a failed attempt.')
  await installOnefile()
}

/** Download, verify, unpack and start a onedir copy, and only then switch to it. */
async function installOnedir(asset: { zip: string; exe: string }): Promise<void> {
  emit({ state: 'downloading', percent: 0, message: 'Downloading download engine…' })
  const sums = await releaseSums()
  const dir = binDir()
  const tmp = join(dir, `${asset.zip}.download`)
  let zip: Buffer
  let sum: string
  try {
    sum = verifyHash(await fetchToFile(`${RELEASE_BASE}/${asset.zip}`, tmp), asset.zip, sums)
    zip = await readFile(tmp)
  } finally {
    await rm(tmp, { force: true })
  }
  const pointer = await stageOnedir(zip, dir, asset.exe, sum)
  const staged = join(dir, pointer.dir)
  const exe = join(staged, pointer.exe)
  if (process.platform === 'darwin') {
    try {
      execFileSync('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', staged], { stdio: 'ignore' })
    } catch {
      /* nothing to strip */
    }
  }
  let version = await versionOf(exe)
  if (!version) {
    repairMacSignature(exe)
    version = await versionOf(exe)
  }
  if (!version) {
    rmSync(staged, { recursive: true, force: true })
    throw new Error('The onedir engine was unpacked but failed to start on this system.')
  }
  activate(dir, pointer)
  rmSync(migrationFailureFile(), { force: true })
  log.info('engine', 'Onedir engine active', { version })
}

/** The single-file engine, over the old one. */
async function installOnefile(): Promise<void> {
  const asset = ASSETS.onefile
  if (!asset) throw new Error('No download engine is published for this system.')
  const url = `${RELEASE_BASE}/${asset}`
  const dest = onefilePath()
  const tmp = `${dest}.download`

  emit({ state: 'downloading', percent: 0, message: 'Downloading download engine…' })

  const sums = await releaseSums()
  const hash = await fetchToFile(url, tmp)
  try {
    verifyHash(hash, asset, sums)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }

  // Atomic-ish replace
  try {
    if (existsSync(dest)) rmSync(dest)
  } catch {
    /* ignore */
  }
  renameSync(tmp, dest)

  if (process.platform !== 'win32') {
    chmodSync(dest, 0o755)
  }

  if (process.platform === 'darwin') {
    // The official yt-dlp_macos build is already ad-hoc signed and runs as-is.
    // We only strip a quarantine flag if one is present (harmless otherwise).
    // We deliberately do NOT re-sign here: codesign --force first removes the
    // existing signature and, if it then fails, leaves the binary unsigned —
    // which the kernel SIGKILLs on Apple Silicon. Signature repair only happens
    // on demand (see repairMacSignature) when the binary actually fails to run.
    try {
      execFileSync('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', dest], { stdio: 'ignore' })
    } catch {
      /* nothing to strip */
    }
  }
}

/**
 * Last-resort repair for macOS: if a freshly downloaded engine won't run (e.g. a
 * future release ships unsigned), apply an ad-hoc signature so the kernel will
 * allow it. Best-effort; callers re-verify with --version afterwards.
 */
function repairMacSignature(path: string): void {
  if (process.platform !== 'darwin') return
  try {
    execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', path], { stdio: 'ignore' })
  } catch {
    /* leave as-is; caller will surface an error */
  }
}

function spawnYtdlp(
  args: string[],
  bin: string = ytdlpBinaryPath()
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    /*
      `--ignore-config`, as on every other engine command line. The engine reads a
      yt-dlp.conf from the folder it was started in, and this one includes `-U`:
      checked on the real engine, a file left in that folder changes what it does.
    */
    const child = spawn(bin, withJsRuntime(['--ignore-config', '--encoding', 'utf-8', ...args]), ytdlpSpawnOptions())
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d: string) => (stdout += d))
    child.stderr.on('data', (d: string) => (stderr += d))
    child.on('error', () => resolve({ code: -1, stdout, stderr }))
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

/** What `--version` says for this executable, or nothing when it will not start. */
async function versionOf(bin: string): Promise<string | undefined> {
  if (!existsSync(bin)) return undefined
  const { code, stdout } = await spawnYtdlp(['--version'], bin)
  if (code === 0) return stdout.trim()
  return undefined
}

export async function getVersion(): Promise<string | undefined> {
  return versionOf(ytdlpBinaryPath())
}

/**
 * Move a working single-file install to the onedir build, behind its back.
 *
 * The single file stays active until the new copy has been unpacked and seen
 * to start, and stays on disk until the next launch's clean-up, so a download
 * running from it now is never pulled out from under. A failure is logged and
 * tried again in a day; nothing is shown, since the engine in use still works.
 */
function migrateInBackground(): void {
  void downloadBinary()
    .then(async () => {
      const version = await getVersion()
      if (version && onedirExe(binDir())) emit({ state: 'ready', version, message: 'Ready' })
    })
    .catch(async (err: unknown) => {
      if (!(err instanceof EngineTrustError)) return
      noteRefusal(err)
      emit({ state: 'ready', version: await getVersion(), message: 'Ready' })
    })
}

/**
 * Ensure the yt-dlp engine binary is present and ready. Downloads it on first
 * launch. Safe to call multiple times — concurrent calls share one promise.
 */
export function ensureYtdlp(): Promise<string> {
  /*
    Checked once is not checked for good. An antivirus that takes the engine an
    hour into the session left this answering "ready" with a path to nothing:
    every download then failed to start, and Retry asked here and was told
    "ready" again, until the app was restarted. A file that has gone is looked
    for, and fetched, like on a first launch.
  */
  if (ensurePromise && ensuredAt && !existsSync(ensuredAt)) {
    log.warn('engine', 'The engine is no longer where it was; setting it up again')
    ensurePromise = null
    ensuredAt = null
  }
  if (ensurePromise) return ensurePromise
  ensuredAt = null
  ensurePromise = (async () => {
    try {
      selectJsRuntime()
      const dir = binDir()
      // Half-finished downloads and unpacks. What they replace goes only once a onedir copy is proven.
      cleanEngineDir(dir, onefileName(), { onedirVerified: false, keepPartials: downloading !== null })
      emit({ state: 'checking', message: 'Checking download engine…' })
      const onedir = onedirExe(dir)
      const onedirVersion = onedir ? await versionOf(onedir) : undefined
      const onefile = onefilePath()
      const onefileVersion =
        !onedirVersion && existsSync(onefile) && statSync(onefile).size > 1_000_000
          ? await versionOf(onefile)
          : undefined
      const plan = planEngine({
        onedirRuns: Boolean(onedirVersion),
        onefileRuns: Boolean(onefileVersion),
        onedirAvailable: Boolean(ASSETS.onedir),
        migrationFailure: lastMigrationFailure(),
        now: Date.now()
      })
      if (plan === 'use-onedir') {
        // It started: the single file and older copies are no longer anyone's fallback.
        cleanEngineDir(dir, onefileName(), { onedirVerified: true, keepPartials: downloading !== null })
        emit({ state: 'ready', version: onedirVersion, message: 'Ready' })
        log.info('engine', 'Ready', { version: onedirVersion, build: 'onedir' })
        return onedir as string
      }
      if (plan !== 'install') {
        // A onedir copy that will not start must not shadow the single file that does.
        if (readPointer(dir)) rmSync(join(dir, 'current.json'), { force: true })
        emit({ state: 'ready', version: onefileVersion, message: 'Ready' })
        log.info('engine', 'Ready', { version: onefileVersion, build: 'onefile' })
        if (plan === 'use-onefile-then-migrate') migrateInBackground()
        return onefile
      }
      // Nothing that runs (a first launch, a broken download): install.
      if (onedir || existsSync(onefile)) log.warn('engine', 'The installed engine does not start; fetching it again')
      if (readPointer(dir) && !onedirVersion) rmSync(join(dir, 'current.json'), { force: true })
      movingFromShared = !onedir && !existsSync(onefile) && hadSharedEngine()
      if (movingFromShared) log.info('engine', 'Fetching a private copy; the shared folder is left as it is')
      emit({ state: 'checking', message: 'Preparing download engine…' })
      // No engine runs, so the single file is a fallback worth having.
      await downloadBinary('onefile')
      const path = ytdlpBinaryPath()
      let version = await getVersion()
      if (!version) {
        // The stock binary normally runs as-is; if not, try an ad-hoc re-sign.
        repairMacSignature(path)
        version = await getVersion()
      }
      if (!version) {
        throw new Error('The download engine was installed but failed to start on this system.')
      }
      movingFromShared = false
      emit({ state: 'ready', version, message: 'Ready' })
      log.info('engine', 'Installed', { version })
      return path
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (err instanceof EngineTrustError) {
        log.warn('engine', 'Refused to install an engine', { reason: err.reason, error: message })
      }
      emit({ state: 'error', message })
      ensurePromise = null // allow retry
      throw err
    }
  })()
  void ensurePromise.then(
    (path) => {
      ensuredAt = path
    },
    () => undefined
  )
  return ensurePromise
}

// ---- The JavaScript runtime; see js-runtime.ts for why this one ------------

const DENO_PIN: DenoPin | undefined = denoPin(process.platform, process.arch)

function pinnedDeno(pin: DenoPin): string {
  return join(jsRuntimeDir(), denoDirName(pin), denoExeName())
}

/** The pinned copy once it is on disk (renamed into place whole), or else one the person has. */
function selectJsRuntime(): void {
  const pinned = DENO_PIN ? pinnedDeno(DENO_PIN) : null
  useJsRuntime(pinned && existsSync(pinned) ? pinned : denoOnPath())
}

/** Whether this file starts, and is the version it was fetched as. */
function denoStarts(exe: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(exe, ['--version'], { windowsHide: true, env: { ...process.env, DENO_NO_UPDATE_CHECK: '1' } })
    const timer = setTimeout(() => {
      child.kill()
      resolve(false)
    }, 20_000)
    let stdout = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (d: string) => (stdout += d))
    child.on('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code === 0 && isPinnedBanner(stdout))
    })
  })
}

/** Fetch, verify, unpack and start the pinned copy; only then does anything use it. */
async function installDeno(pin: DenoPin): Promise<void> {
  const root = jsRuntimeDir()
  const exe = denoExeName()
  await mkdir(root, { recursive: true })
  const tmp = join(root, `${pin.asset}.download`)
  const scratch = join(root, `.unpack-${randomBytes(6).toString('hex')}`)
  const final = join(root, denoDirName(pin))
  try {
    const hash = await fetchToFile(denoUrl(pin), tmp, true)
    if (hash !== pin.sha256) throw new Error(`The downloaded ${pin.asset} does not match its pinned checksum.`)
    await mkdir(scratch)
    await unpackZip(await readFile(tmp), scratch, exe)
    if (!existsSync(join(scratch, exe))) throw new Error(`${pin.asset} has no ${exe} in it.`)
    if (process.platform === 'darwin') {
      try {
        execFileSync('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', scratch], { stdio: 'ignore' })
      } catch {
        /* nothing to strip */
      }
    }
    let started = await denoStarts(join(scratch, exe))
    if (!started) {
      repairMacSignature(join(scratch, exe))
      started = await denoStarts(join(scratch, exe))
    }
    if (!started) throw new Error(`Deno was unpacked but failed to start on this system.`)
    await rm(final, { recursive: true, force: true })
    await rename(scratch, final)
  } finally {
    await rm(tmp, { force: true })
    await rm(scratch, { recursive: true, force: true })
  }
}

function jsRuntimeFailureFile(): string {
  return join(jsRuntimeDir(), 'fetch-failed')
}

function lastJsRuntimeFailure(): MigrationFailure | undefined {
  try {
    return parseMigrationFailure(readFileSync(jsRuntimeFailureFile(), 'utf-8'))
  } catch {
    return undefined
  }
}

async function setUpJsRuntime(pin: DenoPin): Promise<void> {
  const exe = pinnedDeno(pin)
  if (existsSync(exe)) {
    if (await denoStarts(exe)) {
      useJsRuntime(exe)
      denoProven = true
    } else {
      // Damaged, or removed by antivirus in part. Not a failed fetch: nothing was tried yet.
      log.warn('engine', 'The JavaScript runtime does not start; fetching it again')
      useJsRuntime(denoOnPath())
      await rm(join(jsRuntimeDir(), denoDirName(pin)), { recursive: true, force: true })
    }
  }
  if (!existsSync(exe)) {
    if (!net.isOnline() || runtimeFetchBlocked(lastJsRuntimeFailure(), Date.now())) return
    try {
      await installDeno(pin)
      useJsRuntime(exe)
      denoProven = true
      rmSync(jsRuntimeFailureFile(), { force: true })
      log.info('engine', 'JavaScript runtime ready', { asset: pin.asset })
    } catch (err) {
      const count = (lastJsRuntimeFailure()?.count ?? 0) + 1
      try {
        writeFileSync(jsRuntimeFailureFile(), JSON.stringify({ at: Date.now(), count }), 'utf-8')
      } catch {
        /* the back-off is an optimisation */
      }
      log.warn('engine', 'The JavaScript runtime could not be installed', {
        error: err instanceof Error ? err.message : String(err)
      })
      return
    }
  }
  const root = jsRuntimeDir()
  for (const name of staleRuntimeEntries(await readdir(root), denoDirName(pin))) {
    // An older copy a running engine still has open on Windows goes at the next launch.
    await rm(join(root, name), { recursive: true, force: true }).catch(() => undefined)
  }
}

let jsRuntimeWork: Promise<void> | null = null
/** The pinned copy has been seen to start this session, so the hourly look can stop. */
let denoProven = false

/**
 * Get the pinned Deno in place, if this machine has one and it is not there yet.
 *
 * Never rejects, and nothing on the way depends on it: without a runtime the
 * engine still works, and YouTube's answer says for itself what that cost (see
 * `qualityLimitIn` in options.ts). No build for this system is not a failure either.
 */
export function ensureJsRuntime(): Promise<void> {
  if (jsRuntimeWork) return jsRuntimeWork
  const pin = DENO_PIN
  if (!pin) {
    useJsRuntime(denoOnPath())
    return Promise.resolve()
  }
  if (denoProven) return Promise.resolve()
  const work = setUpJsRuntime(pin)
    .catch((err) => log.warn('engine', 'JavaScript runtime setup failed', { error: String(err) }))
    .finally(() => {
      jsRuntimeWork = null
    })
  jsRuntimeWork = work
  trackRuntimeInstall(work)
  return work
}

let jsRuntimeScheduled = false

/** Once the engine is in place, and again while the runtime is missing: a dead network comes back. */
export function scheduleJsRuntime(): void {
  if (jsRuntimeScheduled) return
  jsRuntimeScheduled = true
  const tick = (): void => void ensureJsRuntime()
  ensureYtdlp().then(tick, () => undefined)
  setInterval(tick, REFRESH_TICK)
  powerMonitor.on('resume', () => setTimeout(tick, REFRESH_RESUME_DELAY))
}

export interface EngineFailure {
  ok: false
  error: string
  errorCode: 'engineMissing' | 'engineProxy'
}

/**
 * Get the engine ready, or say why it can't be in a form a result can carry.
 *
 * Detection and search both start by waiting on the engine, and when it can't
 * be installed — offline on the very first run, say — `ensureYtdlp` throws.
 * That rejection crossed the IPC bridge as "Error invoking remote method
 * 'media:detect': Error: …" and was printed verbatim on the home card, the one
 * untranslated line in the window at the moment the user most needed to read
 * it. As a coded failure it arrives as a sentence in their language, with the
 * engine's own English kept as the fallback.
 */
export async function engineUnavailable(): Promise<EngineFailure | undefined> {
  try {
    await ensureYtdlp()
    return undefined
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return { ok: false, error, errorCode: proxyMayBeWhy(error, getSettings().proxy) ? 'engineProxy' : 'engineMissing' }
  }
}

/** The engine is in use, so replacing it now would break a running download. */
export class EngineBusyError extends Error {
  readonly code = 'engineBusy'
  constructor() {
    super('Pause or finish your downloads first — updating replaces the file they run from.')
    this.name = 'EngineBusyError'
  }
}

let updating: Promise<string | undefined> | null = null
/** The scheduled refresh while it runs; resolves to whether it brought the engine up to date. */
let refreshing: Promise<boolean> | null = null

/**
 * Whether the engine is the latest release, going by the signed checksum list.
 *
 * Equal is "already current"; anything else sends the refresh on to a fresh copy.
 * A single file on a machine with a onedir build answers "not current" too, which
 * is how an install that missed the launch migration moves over.
 *
 * The single file used to be left to update itself with `-U`, and never is now.
 * yt-dlp's updater checks the checksum list from the same release and not the
 * signature (yt_dlp/update.py), so that one route would have put an unchecked file
 * in place of the engine. All replacing goes through `fetchBinary`. A failure of
 * any kind here only means "not known to be current": the download that follows
 * makes the same check, and that is where a refusal is reported from.
 */
async function checkCurrent(): Promise<number> {
  const dir = binDir()
  const pointer = onedirExe(dir) ? readPointer(dir) : null
  if (pointer && ASSETS.onedir) {
    // A newer build that failed to start here is not retried daily: the one in use is kept as current.
    if (onedirBlocked()) return 0
    try {
      return (await releaseSums()).get(ASSETS.onedir.zip) === pointer.sha256 ? 0 : 1
    } catch {
      return 1
    }
  }
  // No onedir copy: move to one, unless that has been failing - then the single file updates itself.
  if ((ASSETS.onedir && !onedirBlocked()) || !ASSETS.onefile || !existsSync(onefilePath())) return 1
  try {
    return (await releaseSums()).get(ASSETS.onefile) === (await hashFile(onefilePath())) ? 0 : 1
  } catch {
    return 1
  }
}

/**
 * A new binary over the old one, and proof that it starts.
 *
 * The same check `ensureYtdlp` makes after its first download, ad-hoc re-sign
 * included. If the new file still will not run, the old one is already gone,
 * so the cached "engine is ready" answer is dropped: the next detection or
 * download then installs it again through `ensureYtdlp`, which reports a
 * failure where the user can see it.
 */
async function freshCopy(): Promise<void> {
  await downloadBinary()
  if (await getVersion()) return
  repairMacSignature(ytdlpBinaryPath())
  if (await getVersion()) return
  ensurePromise = null
  throw new Error('The download engine was installed but failed to start on this system.')
}

/**
 * Force update the engine to the latest release.
 *
 * `refreshEngineIfDue` refuses to do this while the engine is in use, and
 * documents why: an update replaces the very executable a running transfer was
 * started from, which on Windows cannot be done at all while it is loaded. The
 * button in Settings ran the same command with none of that care, so clicking
 * it mid-download hit exactly the case the automatic path is written to avoid.
 *
 * Two clicks used to start two updates over one path, and a failure left the
 * status stuck on "checking" with the spinner turning for the rest of the
 * session — the caller had nothing to catch and nothing to show.
 */
export async function updateYtdlp(isBusy: () => boolean = () => false): Promise<string | undefined> {
  if (isBusy()) throw new EngineBusyError()
  if (updating) return updating

  updating = (async () => {
    /*
      The scheduled refresh may be replacing the file right now, and two at
      once would race over one path. Wait for it, and if it worked there is
      nothing left to do. If it did not, run our own: a failure must reach the
      person who pressed the button, not be swallowed the way the background
      one's is.
    */
    if (refreshing) {
      if (await refreshing) {
        const version = await getVersion()
        emit({ state: 'ready', version, message: 'Ready' })
        return version
      }
      /*
        The busy check at the top is stale by now. That wait lasts minutes
        when the refresh fell back to a download, and a transfer started in
        them is often why the refresh gave up: on Windows the rename over a
        running yt-dlp.exe fails. Updating beside it would replace the
        file it runs from. Nothing has been emitted yet, so the engine card
        still shows what the refresh left there.
      */
      if (isBusy()) throw new EngineBusyError()
    }
    emit({ state: 'checking', message: 'Updating download engine…' })
    try {
      const outcome = await runRefresh({ checkCurrent, download: freshCopy, isBusy })
      if (outcome.kind === 'busy') throw new EngineBusyError()
      if (outcome.kind === 'failed') throw new Error(outcome.error)
      if (outcome.kind === 'refused') throw outcome.error
      markRefreshed()
      const version = await getVersion()
      emit({ state: 'ready', version, message: 'Ready' })
      log.info('engine', 'Updated', { version, via: outcome.via })
      return version
    } catch (err) {
      if (err instanceof EngineBusyError) {
        // Nothing was replaced, so the engine the new download runs from is still a working one.
        emit({ state: 'ready', version: await getVersion(), message: 'Ready' })
        throw err
      }
      if (err instanceof EngineTrustError) {
        // The same: the engine in use still works, so the card must not read as a failed setup.
        noteRefusal(err)
        emit({ state: 'ready', version: await getVersion(), message: 'Ready' })
        throw err
      }
      const message = err instanceof Error ? err.message : String(err)
      emit({ state: 'error', message })
      log.warn('engine', 'Update failed', { error: message })
      throw err
    }
  })()

  try {
    return await updating
  } finally {
    updating = null
  }
}

function stateFile(): string {
  return join(app.getPath('userData'), 'engine.json')
}

function readRefreshState(): RefreshState {
  try {
    return parseRefreshState(JSON.parse(readFileSync(stateFile(), 'utf-8')))
  } catch {
    return parseRefreshState(undefined)
  }
}

function writeRefreshState(state: RefreshState): void {
  try {
    writeFileSync(stateFile(), JSON.stringify(state), 'utf-8')
  } catch {
    /* the cadence is an optimisation, not a correctness requirement */
  }
}

function markRefreshed(): void {
  writeRefreshState(afterSuccess(Date.now()))
}

/**
 * Refresh the engine at most once a day, and never while it is in use.
 *
 * This used to key off a module variable initialised to zero, so "at most once
 * every 24h" really meant "on every launch": a network round trip and a binary
 * swap each time the app opened. Worse, with downloads now resuming at startup
 * it raced them — an update replaces the very executable those transfers are
 * running from, which on Windows cannot even be done while it is loaded, so the
 * update quietly failed and fell back to re-downloading it.
 *
 * The timestamp lives on disk, and `isBusy` lets the caller say when the engine
 * is being used. Sites change their players constantly, so a stale engine is a
 * real failure mode — but never at the cost of a running download.
 *
 * Only a refresh that happened is written down as one. The timestamp used to be
 * stamped whatever `-U` answered, so an attempt refused by GitHub or made with
 * no network counted as the day's refresh. A failure now leaves it alone and
 * backs off for a few hours instead (see `retryDelay`), and this path never
 * reports an error on the engine card: the engine that was there still works,
 * and the next attempt is already scheduled.
 */
export async function refreshEngineIfDue(isBusy: () => boolean): Promise<void> {
  // One at a time, and never beside the button in Settings: both replace one file.
  if (updating || refreshing) return
  /*
    Nor beside `ensureYtdlp`. When the binary on disk will not start, it is
    downloading a replacement right now, and a refresh on the broken file can only
    fail and fall back to a download of its own. Wait for it, then look again,
    since the button may have been pressed meanwhile. If it failed there is no
    working engine to refresh, and the next detection or download installs one.
  */
  if (ensurePromise) {
    try {
      await ensurePromise
    } catch {
      return
    }
    if (updating || refreshing) return
  }
  const state = readRefreshState()
  if (!refreshDue(state, Date.now())) return
  /*
    Offline, the attempt can only fail. A "no" from `isOnline` is reliable, so
    nothing is tried and nothing is counted against the next attempt; the next
    tick, or waking up, asks again.
  */
  if (!net.isOnline()) return
  if (isBusy()) {
    log.info('engine', 'Daily refresh put off; a download is using the engine')
    return
  }
  if (!existsSync(ytdlpBinaryPath())) return

  refreshing = refreshNow(state, isBusy)
  try {
    await refreshing
  } finally {
    refreshing = null
  }
}

async function refreshNow(state: RefreshState, isBusy: () => boolean): Promise<boolean> {
  /*
    What the engine card showed before. A fallback download reports its
    progress there, and one that fails must not leave the card saying
    "downloading" for the rest of the session.
  */
  const before = currentStatus
  try {
    const outcome = await runRefresh({ checkCurrent, download: freshCopy, isBusy })
    if (outcome.kind === 'done') {
      markRefreshed()
      const version = await getVersion()
      if (version) emit({ state: 'ready', version, message: 'Ready' })
      else if (currentStatus !== before) emit(before)
      log.info('engine', 'Daily refresh done', { version, via: outcome.via })
      return true
    }
    if (outcome.kind === 'refused') {
      noteRefusal(outcome.error)
      const version = await getVersion()
      emit(version ? { state: 'ready', version, message: 'Ready' } : before)
      return false
    }
    if (currentStatus !== before) emit(before)
    if (outcome.kind === 'busy') {
      log.info('engine', 'Daily refresh put off; a download started while it ran', {
        code: outcome.code
      })
      return false
    }
    const online = net.isOnline()
    const next = afterFailure(state, Date.now(), online)
    writeRefreshState(next)
    log.warn('engine', 'Daily refresh failed', {
      code: outcome.code,
      error: outcome.error,
      retryInHours: online ? retryDelay(next.failures) / 3_600_000 : undefined
    })
    return false
  } catch (err) {
    if (currentStatus !== before) emit(before)
    log.warn('engine', 'Daily refresh failed', { error: err instanceof Error ? err.message : String(err) })
    return false
  }
}

let refreshScheduled = false

/**
 * Keep the engine fresh for as long as the app runs, not only at launch.
 *
 * The refresh used to be tried once, thirty seconds in. An app that starts at
 * login and lives in the tray could go days without another attempt, and that
 * one attempt was usually skipped because the downloads resumed at launch were
 * still using the engine. The hourly tick is cheap - the 24-hour gate is a
 * timestamp on disk - and survives sleep, since it compares against the wall
 * clock rather than counting down. Waking up asks too, after a pause for the
 * network to come back.
 */
export function scheduleEngineRefresh(isBusy: () => boolean): void {
  if (refreshScheduled) return
  refreshScheduled = true
  const tick = (): void => {
    refreshEngineIfDue(isBusy).catch(() => undefined)
  }
  setTimeout(tick, REFRESH_LAUNCH_DELAY)
  setInterval(tick, REFRESH_TICK)
  powerMonitor.on('resume', () => setTimeout(tick, REFRESH_RESUME_DELAY))
}
