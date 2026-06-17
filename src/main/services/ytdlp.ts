import { app } from 'electron'
import { EventEmitter } from 'events'
import { spawn } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, chmodSync, statSync } from 'fs'
import { Readable } from 'stream'
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

function binDir(): string {
  const dir = join(app.getPath('userData'), 'bin')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
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

async function downloadBinary(): Promise<void> {
  const url = `${RELEASE_BASE}/${assetName()}`
  const dest = ytdlpBinaryPath()
  const tmp = `${dest}.download`

  emit({ state: 'downloading', percent: 0, message: 'Downloading download engine…' })

  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download yt-dlp (HTTP ${res.status})`)
  }
  const total = Number(res.headers.get('content-length') || 0)
  let received = 0

  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(tmp)
    const nodeStream = Readable.fromWeb(res.body as unknown as Parameters<typeof Readable.fromWeb>[0])
    nodeStream.on('data', (chunk: Buffer) => {
      received += chunk.length
      if (total) {
        emit({
          state: 'downloading',
          percent: Math.min(99, Math.round((received / total) * 100)),
          message: 'Downloading download engine…'
        })
      }
    })
    nodeStream.on('error', reject)
    out.on('error', reject)
    out.on('finish', resolve)
    nodeStream.pipe(out)
  })

  // Atomic-ish replace
  const { renameSync, rmSync } = await import('fs')
  try {
    if (existsSync(dest)) rmSync(dest)
  } catch {
    /* ignore */
  }
  renameSync(tmp, dest)

  if (process.platform !== 'win32') {
    chmodSync(dest, 0o755)
  }
}

function spawnYtdlp(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(ytdlpBinaryPath(), args, { windowsHide: true })
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
        emit({ state: 'ready', version, message: 'Ready' })
        // Refresh in background occasionally (non-blocking).
        void backgroundUpdate()
        return path
      }
      emit({ state: 'checking', message: 'Preparing download engine…' })
      await downloadBinary()
      const version = await getVersion()
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
