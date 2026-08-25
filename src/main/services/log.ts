import { app } from 'electron'
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import type { WriteStream } from 'fs'
import { formatLine, shouldLog, type LogEntry, type LogLevel } from '@shared/redact'

/**
 * The app's log file.
 *
 * There was none before this: a four-kilobyte in-memory tail per download, and
 * a handful of `console.error` calls going to a terminal that does not exist in
 * a packaged build. That was survivable while somebody was sitting in front of
 * the window. It stops being survivable once the app checks sites and uploads
 * files on a schedule with the window closed — when something goes wrong at
 * four in the morning, this file is the only witness.
 *
 * Formatting and redaction live in `@shared/redact`, free of Electron, so they
 * can be tested. This half owns the stream, the rotation and the buffer.
 */

/** Bytes per file, and how many to keep. Ten megabytes in total. */
const MAX_BYTES = 2 * 1024 * 1024
const KEEP = 5

/** Lines logged before the stream exists, flushed when it opens. */
const pending: string[] = []
const MAX_PENDING = 500

let stream: WriteStream | null = null
let file = ''
let written = 0
let minimum: LogLevel = 'info'
/** True while the file is being swapped, so writes queue instead of vanishing. */
let rotating = false

export function setLogLevel(level: LogLevel): void {
  minimum = level
}

export function logFilePath(): string {
  return file
}

function open(): void {
  stream = createWriteStream(file, { flags: 'a' })
  written = existsSync(file) ? statSync(file).size : 0
}

/**
 * Move the current file aside and start a fresh one.
 *
 * The order matters and is not a matter of taste. Renaming a file that still
 * has an open write stream *succeeds* on Windows, and the descriptor follows
 * the renamed file — so every subsequent line lands in the archive while the
 * file everyone looks at stays empty for ever. Verified here, under this app's
 * own Node. Close first, then rename, then reopen.
 */
function rotate(): void {
  if (!stream || rotating) return
  rotating = true
  const old = stream
  stream = null
  old.end(() => {
    try {
      const nth = (n: number): string => join(file, '..', `uvd.${n}.log`)
      const oldest = nth(KEEP - 1)
      if (existsSync(oldest)) rmSync(oldest, { force: true })
      for (let n = KEEP - 2; n >= 1; n--) {
        if (existsSync(nth(n))) renameSync(nth(n), nth(n + 1))
      }
      if (existsSync(file)) renameSync(file, nth(1))
    } catch {
      /* a log that cannot rotate must still be a log */
    }
    open()
    rotating = false
    const queued = pending.splice(0, pending.length)
    for (const line of queued) write(line)
  })
}

function write(line: string): void {
  if (!stream || rotating) {
    if (pending.length < MAX_PENDING) pending.push(line)
    return
  }
  stream.write(line + '\n')
  written += Buffer.byteLength(line) + 1
  if (written >= MAX_BYTES) rotate()
}

/**
 * The one way anything gets into the file.
 *
 * `fields` is a flat record of values the caller has named, and there is
 * deliberately no overload taking an object. `log('config', settings)` would
 * put the proxy string, the SMB password and the bot token through a denylist
 * that was never written with their shapes in mind; making that call
 * impossible is worth more than the convenience.
 */
function emit(
  level: LogLevel,
  subsystem: string,
  message: string,
  fields?: Record<string, string | number | undefined>
): void {
  if (!shouldLog(level, minimum)) return
  const entry: LogEntry = { at: new Date(), level, subsystem, message, fields }
  write(formatLine(entry))
}

export const log = {
  debug: (subsystem: string, message: string, fields?: Record<string, string | number | undefined>) =>
    emit('debug', subsystem, message, fields),
  info: (subsystem: string, message: string, fields?: Record<string, string | number | undefined>) =>
    emit('info', subsystem, message, fields),
  warn: (subsystem: string, message: string, fields?: Record<string, string | number | undefined>) =>
    emit('warn', subsystem, message, fields),
  error: (subsystem: string, message: string, fields?: Record<string, string | number | undefined>) =>
    emit('error', subsystem, message, fields)
}

/**
 * Open the file. Call once, from inside `app.whenReady()`.
 *
 * `getPath('logs')` creates its directory as a side effect, which is why this
 * cannot happen at module load: anything logged before the app is ready — the
 * single-instance branch, an early throw — would either create the directory at
 * an awkward moment or be lost. Those are exactly the failures an app that
 * starts itself at login needs explained.
 */
export function initLog(level: LogLevel = 'info'): void {
  if (stream) return
  minimum = level
  try {
    const dir = app.getPath('logs')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    file = join(dir, 'uvd.log')
    open()
  } catch {
    return
  }

  // Every session says what it is, so a report from an old build is obvious.
  write(
    formatLine({
      at: new Date(),
      level: 'info',
      subsystem: 'app',
      message:
        `Universal Video Downloader ${app.getVersion()} - ${process.platform} ${process.arch}` +
        ` - Electron ${process.versions.electron} - Node ${process.versions.node}` +
        ` - packaged=${app.isPackaged}`
    })
  )

  const queued = pending.splice(0, pending.length)
  for (const line of queued) write(line)
}

/** Write anything still queued. Called on the way out, beside the other flushes. */
export function flushLog(): void {
  const queued = pending.splice(0, pending.length)
  for (const line of queued) {
    if (stream) stream.write(line + '\n')
  }
  stream?.end()
  stream = null
}
