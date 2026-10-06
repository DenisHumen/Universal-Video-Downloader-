import { app } from 'electron'
import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'
import type { DownloadItem } from '@shared/types'
import { normalizeUrl } from '@shared/urls'
import { getSettings } from '../services/settings'
import { applyProxy } from '../services/proxy'
import { ensureYtdlp, ytdlpBinaryPath, ytdlpSpawnOptions } from '../services/ytdlp'
import { ffmpegLocation } from '../services/ffmpeg'
import {
  buildArgs,
  finalPathCandidate,
  plannedDir,
  POSTPROCESS_PREFIX,
  PROGRESS_PREFIX
} from '../services/downloader'
import { classifyYtdlpError, hasCookies } from '../services/options'
import { killTree } from '../services/process'
import { lineReader } from '../services/engine-output'
import { splitOutputLines } from '../services/ffmpeg-output'
import { flushLog, initLog, log } from '../services/log'
import {
  describeFailure,
  displayName,
  parseCliArgs,
  parseProgress,
  postprocessLine,
  progressLine,
  USAGE,
  type CliOptions,
  type CliQuality
} from './format'

/**
 * `uvd <link>`: the app without its window.
 *
 * The same binary, started with `--cli` by the `uvd` wrapper, so a terminal
 * download uses exactly the engine, ffmpeg, settings, cookies, proxy and file
 * naming the app does - it is one more caller of `buildArgs`, not a second
 * downloader. It never takes the single-instance lock, so it runs beside an
 * open window instead of waking it, and it never touches the queue's history:
 * the open app owns that file and would overwrite it, or be overwritten.
 */

const tty = Boolean(process.stdout.isTTY)
const out = (text: string): void => {
  process.stdout.write(text + '\n')
}
const err = (text: string): void => {
  process.stderr.write(text + '\n')
}

let live: ReturnType<typeof spawn> | null = null
let stopping = false
/** The progress line is redrawn in place; anything else printed first has to clear it. */
let lineOpen = false

function status(text: string): void {
  if (!tty) return
  process.stdout.write(`\r\x1b[2K${text}`)
  lineOpen = true
}

function say(text: string): void {
  if (lineOpen) process.stdout.write('\r\x1b[2K')
  lineOpen = false
  out(text)
}

function finish(code: number): void {
  flushLog()
  // Let the last lines reach the terminal before the process goes.
  process.stdout.write('', () => app.exit(code))
}

/** Before `ready`: everything that has to be decided before Chromium starts. */
export function startCli(argv: string[]): void {
  const options = parseCliArgs(argv)

  // Nothing here draws, and a terminal does not want Chromium's GPU chatter.
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('log-level', '3')
  /*
    A Chromium profile of its own. Settings, the engine and the log stay where
    the app keeps them, but two processes on one profile fight over its locks
    and caches, and the window may well be open while this runs.
  */
  app.setPath('sessionData', join(app.getPath('userData'), 'cli-session'))
  if (process.platform === 'darwin') app.dock?.hide()

  const stop = (): void => {
    if (stopping) return
    stopping = true
    if (live) killTree(live)
    say('Stopped. Run the same command again to pick up where it left off.')
    finish(130)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  app
    .whenReady()
    .then(() => run(options))
    .then(
      (code) => finish(code),
      (error) => {
        say(`✗ ${error instanceof Error ? error.message : String(error)}`)
        finish(1)
      }
    )
}

async function run(options: CliOptions): Promise<number> {
  if (options.help) {
    out(USAGE)
    return 0
  }
  if (options.version) {
    out(`uvd ${app.getVersion()} (Universal Video Downloader)`)
    return 0
  }
  if (options.error) {
    err(`uvd: ${options.error}\n\n${USAGE}`)
    return 64
  }

  const settings = getSettings()
  initLog(settings.logVerbose ? 'debug' : 'info')
  log.info('cli', 'Started', { links: options.links.length })
  await applyProxy(settings)

  if (!existsSync(ytdlpBinaryPath())) say('Setting up the download engine (first run only)…')
  try {
    await ensureYtdlp()
  } catch (error) {
    say(`✗ Could not set up the download engine: ${error instanceof Error ? error.message : String(error)}`)
    say('  Check the connection, or open Universal Video Downloader once and let it finish setting up.')
    return 1
  }

  const outputDir = options.output ? resolve(options.output) : settings.downloadDir || app.getPath('downloads')
  let worst = 0
  for (const link of options.links) {
    if (stopping) break
    const code = await download(link, outputDir, options.audio, options.quality)
    worst = Math.max(worst, code)
  }
  return worst
}

function download(link: string, outputDir: string, audio: boolean, quality: CliQuality): Promise<number> {
  const settings = getSettings()
  const item: DownloadItem = {
    id: randomUUID(),
    url: normalizeUrl(link),
    title: '',
    mode: audio ? 'audio' : 'video',
    // The same preset the window's quality picker hands the downloader.
    quality: audio ? 'audio' : quality,
    state: 'downloading',
    percent: 0,
    outputDir,
    createdAt: Date.now()
  }
  const dir = plannedDir(item, settings)
  mkdirSync(dir, { recursive: true })

  say(`↓ ${item.url}`)
  log.info('cli', 'Download started', { url: item.url, dir })

  return new Promise((done) => {
    const child = spawn(ytdlpBinaryPath(), buildArgs(item, settings, dir, ffmpegLocation()), ytdlpSpawnOptions())
    live = child
    let finalPath: { path: string; priority: number } | undefined
    let announced = false
    let stderrTail = ''

    const stdout = lineReader(
      (text) => text.split(/\r?\n/),
      (line) => {
        if (line.startsWith(PROGRESS_PREFIX)) {
          status(progressLine(parseProgress(line.slice(PROGRESS_PREFIX.length))))
          return
        }
        if (line.startsWith(POSTPROCESS_PREFIX)) {
          const [state, postprocessor] = line.slice(POSTPROCESS_PREFIX.length).split('\t')
          if (state === 'started') status(postprocessLine(postprocessor))
          return
        }
        const found = finalPathCandidate(line)
        if (found && (!finalPath || found.priority >= finalPath.priority)) finalPath = found
        if (found && !announced) {
          announced = true
          say(`  saving as ${displayName(found.path)}`)
        }
      }
    )
    const stderr = lineReader(splitOutputLines, (line) => {
      stderrTail = (stderrTail + line + '\n').slice(-4000)
    })
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))

    let settled = false
    const settle = (code: number): void => {
      if (settled) return
      settled = true
      live = null
      done(code)
    }

    child.on('error', (error) => {
      say(`✗ Could not start the download engine: ${error.message}`)
      settle(1)
    })
    child.on('close', (code) => {
      stdout.flush()
      stderr.flush()
      if (stopping) return settle(130)
      if (code === 0) {
        const path = finalPath?.path
        say(path && existsSync(path) ? `✓ Saved to ${path}` : `✓ Done. Saved in ${dir}`)
        log.info('cli', 'Download finished', { url: item.url, path })
        return settle(0)
      }
      const classified = classifyYtdlpError(stderrTail, hasCookies(settings))
      const failure = describeFailure(classified.code, classified.message, Boolean(classified.cookieHint))
      for (const line of failure.lines) say(line)
      log.warn('cli', 'Download failed', { url: item.url, code: classified.code, error: stderrTail.slice(-600) })
      settle(failure.exitCode)
    })
  })
}
