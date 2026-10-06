import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync
} from 'fs'
import { basename, dirname, join } from 'path'
import { log } from './log'

/**
 * Reading and writing the small files the app keeps its state in: settings.json,
 * history.json, watches.json and secrets.dat.
 *
 * Each store used to do this on its own, and all of them did it the same way:
 * write a `.tmp`, rename it over the file, and on any failure to read, carry on
 * with an empty state. That last part is what lost people's data. A file a
 * power cut had left at zero bytes, or one an antivirus scanner was holding open
 * at that moment, read as "nothing here" - and the next save, a scheduled check
 * or a download finishing, wrote that nothing over it. The download folder, the
 * proxy, the whole queue or every hand-built watch went, without a line in the
 * log to say why.
 *
 * A read now tells apart what it can find:
 *
 * - no file at all: a first launch, so start fresh;
 * - a file that does not parse, or parses to something that is not the store's
 *   shape (a zeroed file reads as `null`): the previous version comes back from
 *   `.bak` when there is a good one, and the damaged file is kept aside as
 *   `.corrupt-<time>` either way, so there is something to put back by hand;
 * - a file that is there but cannot be opened (EBUSY, EPERM, EACCES): nothing is
 *   decided. The caller works from memory and must not write until a later read
 *   succeeds, because the file it would replace is very probably fine.
 *
 * Nothing here logs an error's message. A JSON parse error quotes the text it
 * choked on, and that text can be a proxy password or a cookies path; the
 * error's name and system code say all the log needs.
 */

/** How many damaged copies of one file are kept. Older ones are deleted. */
const KEEP_CORRUPT = 3

/** How long a store that could not be read waits before trying again. */
export const RETRY_READ_MS = 5000

/*
  The codes a lock or a scanner produces on Windows, where a file another
  process holds open cannot be read or renamed over for a moment. The same
  codes can mean a real permissions problem, which a short wait does not fix
  and the caller then handles as an unreadable file.
*/
const TRANSIENT = new Set(['EBUSY', 'EPERM', 'EACCES'])

export type StoreRead =
  /** `recovered` when the file was damaged and this came from its `.bak`. */
  | { status: 'ok'; data: unknown; recovered: boolean }
  | { status: 'missing' }
  /** Damaged with no usable backup. The damaged file has been kept aside. */
  | { status: 'corrupt' }
  /** There, but could not be opened or kept aside. Do not write over it. */
  | { status: 'unreadable' }

/**
 * What kind of failure it was, and nothing of what it said.
 *
 * The name and the system error code (EACCES, ENOSPC) are what tell a corrupt
 * file from a locked one, and they quote nothing.
 */
export function failure(err: unknown): Record<string, string | undefined> {
  if (!(err instanceof Error)) return { error: typeof err }
  return { error: err.name, code: (err as NodeJS.ErrnoException).code }
}

const codeOf = (err: unknown): string | undefined => (err as NodeJS.ErrnoException | null)?.code

/** The shape most stores are: a plain object, not an array and not `null`. */
export function isRecord(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
}

/** Block the thread briefly. Only ever on a path that has already failed once. */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Run a file operation, giving a lock a moment to clear.
 *
 * A scanner looking at a file it has just seen written holds it for a few
 * milliseconds. Three tries fifty milliseconds apart ride that out without the
 * caller ever knowing, and cost a tenth of a second only when something is
 * genuinely wrong.
 */
function patiently<T>(attempt: () => T): T {
  for (let tries = 1; ; tries++) {
    try {
      return attempt()
    } catch (err) {
      if (tries >= 3 || !TRANSIENT.has(codeOf(err) ?? '')) throw err
      pause(50)
    }
  }
}

/*
  Files whose current content must not become their backup.

  After a damaged file has been read past, the next write would otherwise copy
  that damage over the good `.bak` it was just recovered from - or, with no
  backup, make a useless one out of it. The flag lasts until a write succeeds.
*/
const skipBackup = new Set<string>()

/** Files currently known to be unreadable, so the log says so once, not on every retry. */
const unreadable = new Set<string>()
/** Files a write has been refused for since they were last readable. */
const refused = new Set<string>()

let sequence = 0

export interface WriteOptions {
  /** Spaces to indent by, for a file a person may open. Compact when absent. */
  indent?: number
  /** Copy the version being replaced to `<file>.bak` first. On unless false. */
  backup?: boolean
}

/**
 * Replace a file with `data` as JSON, so that it is always either the old
 * version or the new one, whole.
 *
 * Throws when the write fails; every caller already logs that its own way.
 */
export function writeJsonAtomic(target: string, data: unknown, options: WriteOptions = {}): void {
  const text = JSON.stringify(data, null, options.indent)
  const dir = dirname(target)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  /*
    A name of its own for every write. A debounced save and the flush on the
    way out shared one `.tmp`, and two writers renaming the same half-written
    file into place is how a whole store ends up truncated.
  */
  const tmp = `${target}.${process.pid}.${++sequence}.tmp`
  try {
    const fd = openSync(tmp, 'w')
    try {
      writeSync(fd, text, null, 'utf-8')
      /*
        On the disk before the rename, not just handed to the OS. Without this a
        power cut can keep the rename and lose the data, leaving a file of zero
        bytes - the very file the read side has to recover from.
      */
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    if (options.backup !== false && !skipBackup.has(target) && existsSync(target)) {
      try {
        copyFileSync(target, `${target}.bak`)
      } catch {
        /* a backup is a safety net; failing to make one must not stop the save */
      }
    }
    patiently(() => renameSync(tmp, target))
    skipBackup.delete(target)
  } catch (err) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* the write already failed; that is what gets reported */
    }
    throw err
  }
  /*
    The rename itself lives in the directory, and on Linux and macOS it is only
    durable once the directory is flushed too. Windows cannot open a directory
    this way at all, and NTFS journals the rename anyway, so it is skipped there.
  */
  if (process.platform !== 'win32') {
    try {
      const handle = openSync(dir, 'r')
      try {
        fsyncSync(handle)
      } finally {
        closeSync(handle)
      }
    } catch {
      /* best effort: the file itself is already on disk */
    }
  }
}

/** Parse and check the shape, or say it did not work and why. */
function parse(
  text: string,
  fits: (raw: unknown) => boolean
): { ok: true; data: unknown } | { ok: false; why: Record<string, string | undefined> } {
  try {
    const data: unknown = JSON.parse(text)
    if (fits(data)) return { ok: true, data }
    // `null`, `0` or an array where an object belongs: a damaged file all the same.
    return { ok: false, why: { error: 'UnexpectedShape', found: data === null ? 'null' : typeof data } }
  } catch (err) {
    return { ok: false, why: failure(err) }
  }
}

/** The backup's content, when there is one and it is good. */
function readBackup(file: string, fits: (raw: unknown) => boolean): { data: unknown } | undefined {
  try {
    const parsed = parse(readFileSync(file, 'utf-8'), fits)
    return parsed.ok ? { data: parsed.data } : undefined
  } catch {
    return undefined
  }
}

/** The number a `.corrupt-<time>` copy was stamped with. */
function stampOf(name: string, prefix: string): number {
  return Number(name.slice(prefix.length)) || 0
}

/**
 * Keep a copy of a damaged file next to it, and only the newest few of those.
 *
 * A copy, not a move: if the file cannot be copied there is still the file.
 * Moving it is the fallback for a disk too full to hold a copy, since a rename
 * needs no space. Returns the copy's name, or undefined when neither worked.
 */
function setAside(file: string): string | undefined {
  const aside = `${file}.corrupt-${Date.now()}`
  try {
    copyFileSync(file, aside)
  } catch {
    try {
      renameSync(file, aside)
    } catch {
      return undefined
    }
  }
  try {
    const prefix = `${basename(file)}.corrupt-`
    const old = readdirSync(dirname(file))
      .filter((name) => name.startsWith(prefix))
      .sort((a, b) => stampOf(b, prefix) - stampOf(a, prefix))
      .slice(KEEP_CORRUPT)
    for (const name of old) rmSync(join(dirname(file), name), { force: true })
  } catch {
    /* an extra old copy is not worth failing a recovery over */
  }
  return basename(aside)
}

/**
 * Read a store, telling apart a missing file, a damaged one and a locked one.
 *
 * `fits` says whether parsed JSON has the store's shape at all; the caller's own
 * migration then deals with the details inside it.
 */
export function readJsonStore(
  file: string,
  subsystem: string,
  fits: (raw: unknown) => boolean
): StoreRead {
  const name = basename(file)
  let text: string
  try {
    text = patiently(() => readFileSync(file, 'utf-8'))
  } catch (err) {
    if (codeOf(err) === 'ENOENT') return { status: 'missing' }
    if (!unreadable.has(file)) {
      unreadable.add(file)
      log.error(
        subsystem,
        `Could not open ${name}; leaving it as it is, and not saving over it until it can be read`,
        failure(err)
      )
    }
    return { status: 'unreadable' }
  }
  if (unreadable.delete(file)) log.info(subsystem, `${name} can be read again`)
  refused.delete(file)

  const parsed = parse(text, fits)
  if (parsed.ok) return { status: 'ok', data: parsed.data, recovered: false }

  const kept = setAside(file)
  skipBackup.add(file)
  const backup = readBackup(`${file}.bak`, fits)
  if (backup) {
    /*
      Put the good version back in place too, so the next launch reads it
      directly instead of finding the same damage and setting aside another copy.
    */
    try {
      copyFileSync(`${file}.bak`, file)
      skipBackup.delete(file)
    } catch {
      /* the next successful write repairs it; `skipBackup` protects the .bak until then */
    }
    log.warn(subsystem, `${name} was damaged; restored the previous version from ${name}.bak`, {
      ...parsed.why,
      kept
    })
    return { status: 'ok', data: backup.data, recovered: true }
  }
  if (!kept) {
    /*
      Damaged, nothing to recover from, and no way to keep a copy - which means
      the folder is not writable or the disk is full. Saving over it would fail
      as well, or destroy the only copy; treat it as unreadable.
    */
    if (!unreadable.has(file)) {
      unreadable.add(file)
      log.error(subsystem, `${name} is damaged and could not be kept aside; leaving it in place`, parsed.why)
    }
    return { status: 'unreadable' }
  }
  log.error(subsystem, `${name} was damaged and there was no usable backup; starting afresh`, {
    ...parsed.why,
    kept
  })
  return { status: 'corrupt' }
}

/** Say once, per spell of unreadability, that a save was not made. */
export function noteRefusedWrite(file: string, subsystem: string): void {
  if (refused.has(file)) return
  refused.add(file)
  log.warn(
    subsystem,
    `Not saving ${basename(file)}: it is there but could not be read, and saving now would replace it`
  )
}

/**
 * A store's memory of a read that failed, and when to try again.
 *
 * Retrying on every access would put a tenth of a second of `patiently` in front
 * of every settings lookup while a file stays locked; never retrying would keep
 * a session's changes off the disk long after the lock is gone.
 */
export class ReadFailure {
  private at = 0

  /** True while the file is known to be there but could not be read. */
  get active(): boolean {
    return this.at > 0
  }

  /** Record a failed read, which also restarts the wait before the next try. */
  set(now = Date.now()): void {
    this.at = now
  }

  clear(): void {
    this.at = 0
  }

  /** Failed, and long enough ago to be worth another read. */
  due(now = Date.now()): boolean {
    return this.at > 0 && now - this.at >= RETRY_READ_MS
  }
}
