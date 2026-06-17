import { app, net } from 'electron'
import { EventEmitter } from 'events'
import { spawn, execFileSync } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, chmodSync, statSync, renameSync, rmSync } from 'fs'
import { join } from 'path'
import type { YtDlpStatus } from '@shared/types'

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
 */
export function ytdlpSpawnOptions(): { windowsHide: boolean; env: NodeJS.ProcessEnv } {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (process.platform === 'win32') {
    const tmp = engineTmpDir()
    env.TMP = tmp
    env.TEMP = tmp
  }
  return { windowsHide: true, env }
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
    const request = net.request({ url, redirect: 'follow' })
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
    const child = spawn(ytdlpBinaryPath(), args, ytdlpSpawnOptions())
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
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
          // Refresh in background occasionally (non-blocking).
          void backgroundUpdate()
          return path
        }
        // Present but won't run (e.g. a previously broken download) — replace it.
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

/** Force update the engine to the latest release. */
export async function updateYtdlp(): Promise<string | undefined> {
  emit({ state: 'checking', message: 'Updating download engine…' })
  // The self-update keeps the same path and is fast when up to date.
  const { code } = await spawnYtdlp(['-U'])
  if (code !== 0) {
    // Fall back to a fresh download.
    await downloadBinary()
  }
  const version = await getVersion()
  emit({ state: 'ready', version, message: 'Ready' })
  return version
}

let lastBackgroundUpdate = 0
async function backgroundUpdate(): Promise<void> {
  const now = Date.now()
  // At most once every 24h
  if (now - lastBackgroundUpdate < 24 * 60 * 60 * 1000) return
  lastBackgroundUpdate = now
  try {
    await spawnYtdlp(['-U'])
    const version = await getVersion()
    emit({ state: 'ready', version, message: 'Ready' })
  } catch {
    /* best-effort */
  }
}
