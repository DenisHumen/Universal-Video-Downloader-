import { app, net, powerMonitor } from 'electron'
import { EventEmitter } from 'events'
import { spawn, execFileSync } from 'child_process'
import {
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
import { join } from 'path'
import type { YtDlpStatus } from '@shared/types'
import { groupSpawnOptions } from './process'
import { log } from './log'
import { proxyEnv } from './options'
import { getSettings } from './settings'
import { proxyUrl, withProxyAuth } from './proxy-auth'
import {
  afterFailure,
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

function emit(status: YtDlpStatus): void {
  currentStatus = status
  ytdlpEvents.emit('status', status)
}

export function getYtdlpStatus(): YtDlpStatus {
  return currentStatus
}

function isAscii(s: string): boolean {
  return !/[^\x20-\x7E]/.test(s)
}

/**
 * Base directory for the engine binary and its scratch space. On Windows the
 * yt-dlp.exe is a PyInstaller one-file bundle whose bootloader fails to extract
 * (`[PYI...] Failed to extract entry`) when the binary OR the temp path contains
 * non-ASCII characters — which happens whenever the Windows account name is
 * non-Latin (e.g. Cyrillic). So on Windows we keep everything under the
 * guaranteed-ASCII %PUBLIC% directory instead of the per-user %APPDATA%.
 */
function engineBaseDir(): string {
  if (process.platform === 'win32') {
    const pub = process.env.PUBLIC && isAscii(process.env.PUBLIC) ? process.env.PUBLIC : 'C:\\Users\\Public'
    return join(pub, 'UniversalVideoDownloader')
  }
  return app.getPath('userData')
}

function binDir(): string {
  const dir = join(engineBaseDir(), 'bin')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
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
 * The proxy travels here too, so it reaches every invocation - the self-update
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
  if (process.platform === 'win32') {
    const tmp = engineTmpDir()
    env.TMP = tmp
    env.TEMP = tmp
  }
  // Group-spawned so `killTree` can take yt-dlp's own ffmpeg children with it.
  return { windowsHide: true, env, ...groupSpawnOptions() }
}

function assetName(): string {
  const platform = process.platform
  const arch = process.arch
  if (platform === 'win32') return 'yt-dlp.exe'
  if (platform === 'darwin') return 'yt-dlp_macos'
  // linux
  if (arch === 'arm64') return 'yt-dlp_linux_aarch64'
  if (arch === 'arm') return 'yt-dlp_linux_armv7l'
  return 'yt-dlp_linux'
}

export function ytdlpBinaryPath(): string {
  const name = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
  return join(binDir(), name)
}

const RELEASE_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'

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
function fetchToFile(url: string, tmp: string): Promise<void> {
  return new Promise((resolve, reject) => {
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
        out.write(chunk)
        if (total) {
          emit({
            state: 'downloading',
            percent: Math.min(99, Math.round((received / total) * 100)),
            message: 'Downloading download engine…'
          })
        }
      })
      response.on('end', () => out.end(() => resolve()))
      response.on('error', reject)
    })
    request.on('error', reject)
    request.end()
  })
}

async function downloadBinary(): Promise<void> {
  const url = `${RELEASE_BASE}/${assetName()}`
  const dest = ytdlpBinaryPath()
  const tmp = `${dest}.download`

  emit({ state: 'downloading', percent: 0, message: 'Downloading download engine…' })

  await fetchToFile(url, tmp)

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

function spawnYtdlp(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(ytdlpBinaryPath(), ['--encoding', 'utf-8', ...args], ytdlpSpawnOptions())
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

export async function getVersion(): Promise<string | undefined> {
  if (!existsSync(ytdlpBinaryPath())) return undefined
  const { code, stdout } = await spawnYtdlp(['--version'])
  if (code === 0) return stdout.trim()
  return undefined
}

/**
 * Ensure the yt-dlp engine binary is present and ready. Downloads it on first
 * launch. Safe to call multiple times — concurrent calls share one promise.
 */
export function ensureYtdlp(): Promise<string> {
  if (ensurePromise) return ensurePromise
  ensurePromise = (async () => {
    try {
      const path = ytdlpBinaryPath()
      if (existsSync(path) && statSync(path).size > 1_000_000) {
        emit({ state: 'checking', message: 'Checking download engine…' })
        const version = await getVersion()
        if (version) {
          emit({ state: 'ready', version, message: 'Ready' })
          log.info('engine', 'Ready', { version })
          return path
        }
        // Present but won't run (e.g. a previously broken download) — replace it.
        log.warn('engine', 'The installed engine does not start; fetching it again')
      }
      emit({ state: 'checking', message: 'Preparing download engine…' })
      await downloadBinary()
      let version = await getVersion()
      if (!version) {
        // The stock binary normally runs as-is; if not, try an ad-hoc re-sign.
        repairMacSignature(path)
        version = await getVersion()
      }
      if (!version) {
        throw new Error('The download engine was installed but failed to start on this system.')
      }
      emit({ state: 'ready', version, message: 'Ready' })
      log.info('engine', 'Installed', { version })
      return path
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      emit({ state: 'error', message })
      ensurePromise = null // allow retry
      throw err
    }
  })()
  return ensurePromise
}

export interface EngineFailure {
  ok: false
  error: string
  errorCode: 'engineMissing'
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
    return { ok: false, error, errorCode: 'engineMissing' }
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

/** The self-update keeps the same path and is fast when already current. */
async function selfUpdate(): Promise<number> {
  return (await spawnYtdlp(['-U'])).code
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
 * documents why: `-U` replaces the very executable a running transfer was
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
    if (refreshing && (await refreshing)) {
      const version = await getVersion()
      emit({ state: 'ready', version, message: 'Ready' })
      return version
    }
    emit({ state: 'checking', message: 'Updating download engine…' })
    try {
      const outcome = await runRefresh({ selfUpdate, download: freshCopy, isBusy })
      if (outcome.kind === 'busy') throw new EngineBusyError()
      if (outcome.kind === 'failed') throw new Error(outcome.error)
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
 * it raced them — `yt-dlp -U` replaces the very executable those transfers are
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
    const outcome = await runRefresh({ selfUpdate, download: freshCopy, isBusy })
    if (outcome.kind === 'done') {
      markRefreshed()
      const version = await getVersion()
      if (version) emit({ state: 'ready', version, message: 'Ready' })
      else if (currentStatus !== before) emit(before)
      log.info('engine', 'Daily refresh done', { version, via: outcome.via })
      return true
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
