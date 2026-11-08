import { app } from 'electron'
import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'
import type { AppSettings, DownloadItem } from '@shared/types'
import { normalizeUrl } from '@shared/urls'
import { getSettings } from '../services/settings'
import { flushSecrets, initSecrets } from '../services/secrets'
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
import { classifyYtdlpError, hasCookies, refusesMidStreamInit, subtitleMissIn, withPostprocessHeading } from '../services/options'
import { killTree } from '../services/process'
import { lineReader } from '../services/engine-output'
import { ffmpegProgressSeconds, splitOutputLines } from '../services/ffmpeg-output'
import { browserCookiesFile, dropSavedBrowserJar, readSavedBrowserJar } from '../services/browser-logins'
import { flushLog, initLog, log } from '../services/log'
import {
  describeFailure,
  downloadChoice,
  ffmpegProgressLine,
  displayName,
  namesTheFile,
  parseCliArgs,
  parseProgress,
  postprocessLine,
  progressLine,
  subtitleMissLine,
  USAGE,
  type CliChoice,
  type CliOptions
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
  // Every way out comes through here: done, failed and Ctrl-C.
  dropSavedBrowserJar()
  // A secret still being sealed (a proxy password lifted out of settings) lands first.
  void flushSecrets().finally(() => {
    flushLog()
    // Let the last lines reach the terminal before the process goes.
    process.stdout.write('', () => app.exit(code))
  })
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

  await initSecrets()
  const settings = getSettings()
  initLog(settings.logVerbose ? 'debug' : 'info')
  log.info('cli', 'Started', { links: options.links.length })
  await applyProxy(settings)
  readSavedBrowserJar()

  if (!existsSync(ytdlpBinaryPath())) say('Setting up the download engine (first run only)…')
  try {
    await ensureYtdlp()
  } catch (error) {
    say(`✗ Could not set up the download engine: ${error instanceof Error ? error.message : String(error)}`)
    say(
      settings.proxy.trim()
        ? '  A proxy is set: check it, or turn it off in the app\'s settings, and try again.'
        : '  Check the connection, or open Universal Video Downloader once and let it finish setting up.'
    )
    return 1
  }

  const outputDir = options.output ? resolve(options.output) : settings.downloadDir || app.getPath('downloads')
  const choice = downloadChoice(options, settings)
  let worst = 0
  for (const link of options.links) {
    if (stopping) break
    const code = await download(link, outputDir, choice)
    worst = Math.max(worst, code)
  }
  return worst
}

async function download(link: string, outputDir: string, choice: CliChoice): Promise<number> {
  const settings = getSettings()
  const item: DownloadItem = {
    id: randomUUID(),
    url: normalizeUrl(link),
    title: '',
    ...choice,
    state: 'downloading',
    percent: 0,
    outputDir,
    createdAt: Date.now()
  }
  const dir = plannedDir(item, settings)
  mkdirSync(dir, { recursive: true })

  say(`↓ ${item.url}`)
  log.info('cli', 'Download started', { url: item.url, dir })

  let result = await runEngine(item, settings, dir)
  /*
    The window's queue does the same: a stream that restarted partway through,
    which the engine's own HLS downloader refuses, is fetched again by ffmpeg.
  */
  if (result.code !== 0 && !stopping && !item.hlsViaFfmpeg && refusesMidStreamInit(result.stderrTail)) {
    say('  the stream restarts partway through; fetching it with ffmpeg instead')
    log.info('cli', 'Fetching the HLS stream with ffmpeg', { url: item.url })
    item.hlsViaFfmpeg = true
    result = await runEngine(item, settings, dir)
  }

  if (stopping) return 130
  if (result.startError) {
    say(`✗ Could not start the download engine: ${result.startError}`)
    return 1
  }
  if (result.code === 0) {
    const path = result.finalPath
    say(path && existsSync(path) ? `✓ Saved to ${path}` : `✓ Done. Saved in ${dir}`)
    log.info('cli', 'Download finished', { url: item.url, path })
    return 0
  }
  const classified = classifyYtdlpError(result.stderrTail, hasCookies(settings, browserCookiesFile()))
  const failure = describeFailure(classified.code, classified.message, Boolean(classified.cookieHint))
  for (const line of failure.lines) say(line)
  log.warn('cli', 'Download failed', { url: item.url, code: classified.code, error: result.stderrTail.slice(-600) })
  return failure.exitCode
}

interface EngineRun {
  code: number | null
  stderrTail: string
  finalPath?: string
  /** The engine could not be started at all. */
  startError?: string
}

/** One run of the engine for one item, with its progress drawn as it goes. */
function runEngine(item: DownloadItem, settings: AppSettings, dir: string): Promise<EngineRun> {
  return new Promise((done) => {
    const child = spawn(ytdlpBinaryPath(), buildArgs(item, settings, dir, ffmpegLocation()), ytdlpSpawnOptions())
    live = child
    let finalPath: { path: string; priority: number } | undefined
    let announced = false
    const saidMissing = new Set<string>()
    let stderrTail = ''
    // SponsorBlock's lookup is a post-processor too, and runs before anything is fetched.
    let fetched = false
    let postprocessing = false

    const stdout = lineReader(
      (text) => text.split(/\r?\n/),
      (line) => {
        if (line.startsWith(PROGRESS_PREFIX)) {
          fetched = true
          status(progressLine(parseProgress(line.slice(PROGRESS_PREFIX.length))))
          return
        }
        if (line.startsWith(POSTPROCESS_PREFIX)) {
          const [state, postprocessor] = line.slice(POSTPROCESS_PREFIX.length).split('\t')
          if (state === 'started') status(postprocessLine(postprocessor))
          if (fetched) postprocessing = true
          return
        }
        const found = finalPathCandidate(line)
        if (found && (!finalPath || found.priority >= finalPath.priority)) finalPath = found
        if (found && !announced && namesTheFile(found.path, found.priority, item.mode === 'audio')) {
          announced = true
          say(`  saving as ${displayName(found.path)}`)
        }
      }
    )
    const stderr = lineReader(splitOutputLines, (line) => {
      // ffmpeg fetching an HLS stream says how far it has got here, and nowhere else.
      const seconds = ffmpegProgressSeconds(line)
      if (seconds != null) return status(ffmpegProgressLine(seconds))
      const missed = subtitleMissIn(line)
      if (missed && !saidMissing.has(missed)) {
        saidMissing.add(missed)
        say(subtitleMissLine(missed))
      }
      stderrTail = (stderrTail + line + '\n').slice(-4000)
    })
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))

    let settled = false
    const settle = (run: EngineRun): void => {
      if (settled) return
      settled = true
      live = null
      done(run)
    }

    child.on('error', (error) => settle({ code: null, stderrTail, startError: error.message }))
    child.on('close', (code) => {
      stdout.flush()
      stderr.flush()
      settle({
        code,
        stderrTail: code !== 0 && postprocessing ? withPostprocessHeading(stderrTail) : stderrTail,
        finalPath: finalPath?.path
      })
    })
  })
}
