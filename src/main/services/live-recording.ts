import { createReadStream, createWriteStream, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import { pipeline } from 'stream/promises'
import type { DownloadMode } from '@shared/types'

/*
  What a stopped live recording leaves on disk, and how to make a file of it.

  The engine ends a live capture cleanly when it gets a Ctrl-C: ffmpeg finishes
  its output, the engine fixes the container, and it exits 0 with the finished
  file. Everything here is for when it did not get that far. A stream the engine
  does not take for live, fetched by its own HLS downloader, raises on the same
  Ctrl-C and leaves `<name>.part` plus whichever fragments had not been appended
  yet (`<name>.part-Frag12`); a forced kill leaves the same, or ffmpeg's half of
  it; a format pair leaves one set per stream.

  Apart from the downloader so it can be tested without Electron.
*/

/** One stream of a recording, as the engine left it. */
export interface RecordingPiece {
  /** The name the engine was told to end up with. */
  destination: string
  /** What holds the data now: `<destination>.part`, or the destination itself. */
  file: string
  /** Finished by the engine, as against the `.part` it was still writing. */
  whole: boolean
  /** Fragments fetched but not yet appended to `file`, in order, and safe to append. */
  fragments: string[]
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

/**
 * The fragments of `partName` that can go on the end of it, in order.
 *
 * Five are fetched at a time and appended in turn, so what is lying around can
 * have a hole where one was still being written, and `<name>.part-Frag13.part`
 * is one of those. Only an unbroken run counts: the stream would otherwise jump
 * forward and carry on. `appended` is the engine's own note of how far it got,
 * when it left one: a fragment up to there is already in the file, and a run
 * that does not start right after it has its hole at the front.
 */
export function appendableFragments(names: readonly string[], partName: string, appended?: number): string[] {
  const prefix = `${partName}-Frag`
  const held = new Map<number, string>()
  for (const name of names) {
    if (!name.startsWith(prefix)) continue
    const index = name.slice(prefix.length)
    if (/^\d+$/.test(index)) held.set(Number(index), name)
  }
  const indexes = [...held.keys()].filter((n) => appended == null || n > appended).sort((a, b) => a - b)
  if (!indexes.length || (appended != null && indexes[0] !== appended + 1)) return []
  const run: string[] = []
  for (let i = 0; i < indexes.length && indexes[i] === indexes[0] + i; i++) run.push(held.get(indexes[i])!)
  return run
}

/** How far the engine's `<name>.ytdl` says it had appended, when it left one that reads. */
export function appendedFragment(ytdlText: string): number | undefined {
  try {
    const parsed: unknown = JSON.parse(ytdlText)
    const index = (parsed as { downloader?: { current_fragment?: { index?: unknown } } })?.downloader
      ?.current_fragment?.index
    return typeof index === 'number' && Number.isFinite(index) ? index : undefined
  } catch {
    return undefined
  }
}

function readAppended(destination: string): number | undefined {
  try {
    return appendedFragment(readFileSync(`${destination}.ytdl`, 'utf-8'))
  } catch {
    return undefined
  }
}

/** What is on disk for each of the names the engine announced. Empty files are nothing. */
export function piecesOnDisk(destinations: readonly string[]): RecordingPiece[] {
  const pieces: RecordingPiece[] = []
  for (const destination of new Set(destinations)) {
    const part = `${destination}.part`
    const dir = dirname(destination)
    let names: string[] = []
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    const fragments = appendableFragments(names, basename(part), readAppended(destination)).map((n) => join(dir, n))
    if (sizeOf(part) > 0 || fragments.length) {
      pieces.push({ destination, file: part, whole: false, fragments })
    } else if (sizeOf(destination) > 0) {
      pieces.push({ destination, file: destination, whole: true, fragments: [] })
    }
  }
  return pieces
}

/**
 * Put a piece's waiting fragments on the end of its file, as the engine would
 * have. In place, not into a copy: a recording can be tens of gigabytes on a
 * disk with room for one of it, and nothing is lost if this stops halfway.
 * An encrypted stream's fragments are still encrypted at this point; ffmpeg
 * reads what precedes them and stops at the noise.
 */
export async function joinFragments(piece: RecordingPiece): Promise<void> {
  for (const fragment of piece.fragments) {
    await pipeline(createReadStream(fragment), createWriteStream(piece.file, { flags: 'a' }))
    rmSync(fragment, { force: true })
  }
}

const VIDEO_CONTAINER = /^\.(mp4|mkv|webm|mov|m4v)$/i

/**
 * The name a saved recording should have, before any collision is settled.
 *
 * A pair of streams was announced as `Title.f137.mp4` and `Title.f140.m4a`,
 * and is one file once joined. An audio download keeps to audio whatever the
 * stream was called, and a video in a transport stream goes into an mp4, which
 * more players open and the row can play.
 */
export function savedPath(destinations: readonly string[], mode: DownloadMode): { dir: string; base: string; ext: string } {
  const first = destinations[0]
  const dir = dirname(first)
  const ext = extname(first)
  let base = basename(first, ext)
  if (new Set(destinations).size > 1) base = base.replace(/\.f[\w-]+$/, '')
  const container = mode === 'audio' ? 'm4a' : VIDEO_CONTAINER.test(ext) ? ext.slice(1).toLowerCase() : 'mp4'
  return { dir, base, ext: container }
}

/**
 * ffmpeg's arguments to make one playable file of the pieces, without encoding.
 *
 * Audio and video only: a transport stream can carry timed metadata an mp4 has
 * no place for, and copying that along is enough to refuse the whole file.
 */
export function remuxArgs(inputs: readonly string[], output: string, mode: DownloadMode): string[] {
  const args: string[] = []
  // `.part` says nothing about what is inside, and the extension is all ffmpeg would have to go on otherwise.
  for (const input of inputs) args.push('-fflags', '+genpts+discardcorrupt', '-i', input)
  inputs.forEach((_, i) => {
    if (mode !== 'audio') args.push('-map', `${i}:v?`)
    args.push('-map', `${i}:a?`)
  })
  args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero')
  if (/\.(mp4|m4a|mov|m4v)$/i.test(output)) args.push('-movflags', '+faststart')
  args.push(output)
  return args
}

/** Take the pieces away once their contents are safely in the saved file. */
export function removePieces(pieces: readonly RecordingPiece[]): void {
  for (const piece of pieces) {
    try {
      rmSync(piece.file, { force: true })
      rmSync(`${piece.destination}.part`, { force: true })
      rmSync(`${piece.destination}.ytdl`, { force: true })
      const dir = dirname(piece.destination)
      const fragment = `${basename(piece.destination)}.part-Frag`
      for (const name of readdirSync(dir)) {
        if (name.startsWith(fragment)) rmSync(join(dir, name), { force: true })
      }
    } catch {
      /* a leftover costs disk space, not the recording */
    }
  }
}

/** The file to point at when a recording could not be saved. */
export function keptFile(pieces: readonly RecordingPiece[]): string | undefined {
  const file = pieces[0]?.file
  return file && existsSync(file) ? file : undefined
}
