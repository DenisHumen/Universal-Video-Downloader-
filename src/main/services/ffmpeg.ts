import { spawn, type ChildProcess } from 'child_process'
import { dirname, extname, join } from 'path'
import { existsSync } from 'fs'
import type { AppErrorCode, ConvertTarget, TrimRange } from '@shared/types'
import { groupSpawnOptions, killTree } from './process'

/**
 * Resolve the bundled ffmpeg binary path. In a packaged app the binary lives in
 * app.asar.unpacked, but ffmpeg-static reports the in-asar path, so we remap it.
 */
export function ffmpegPath(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ffmpegStatic = require('ffmpeg-static') as string | null
    if (!ffmpegStatic) return undefined
    let p = ffmpegStatic
    if (p.includes('app.asar') && !p.includes('app.asar.unpacked')) {
      p = p.replace('app.asar', 'app.asar.unpacked')
    }
    return existsSync(p) ? p : ffmpegStatic
  } catch {
    return undefined
  }
}

/** Directory containing ffmpeg, suitable for yt-dlp's --ffmpeg-location. */
export function ffmpegLocation(): string | undefined {
  const p = ffmpegPath()
  return p ? dirname(p) : undefined
}

// ---------------------------------------------------------------------------
// Running ffmpeg
// ---------------------------------------------------------------------------

export interface FfmpegRun {
  child: ChildProcess
  done: Promise<{ code: number; stderr: string }>
}

/** The bundled binary isn't where the package said it would be. */
export class FfmpegMissingError extends Error {
  readonly code: AppErrorCode = 'ffmpegMissing'
  constructor() {
    super('The bundled ffmpeg binary is missing — reinstall the app.')
    this.name = 'FfmpegMissingError'
  }
}

/**
 * Spawn ffmpeg with machine-readable progress on stdout. `totalSeconds` turns
 * the reported output timestamp into a percentage; without it we still report
 * elapsed output time so the UI can show movement.
 */
export function runFfmpeg(
  args: string[],
  options: { totalSeconds?: number; onProgress?: (percent: number, speed?: number) => void } = {}
): FfmpegRun {
  const bin = ffmpegPath()
  if (!bin) {
    throw new FfmpegMissingError()
  }
  // `-progress`/`-nostats` are global options and must come before the input;
  // after the output filename ffmpeg reads them as options for a second output
  // that never arrives.
  const full = [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-progress',
    'pipe:1',
    '-nostats',
    ...args
  ]
  const child = spawn(bin, full, { windowsHide: true, ...groupSpawnOptions() })

  let stderr = ''
  let buffer = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() || ''
    for (const line of lines) {
      const [key, value] = line.split('=')
      if (key === 'out_time_us' || key === 'out_time_ms') {
        // Both keys are microseconds in practice; ffmpeg's naming is historic.
        const micros = Number(value)
        if (!Number.isFinite(micros) || micros < 0) continue
        const seconds = micros / 1_000_000
        const percent = options.totalSeconds
          ? Math.min(99.5, (seconds / options.totalSeconds) * 100)
          : 0
        options.onProgress?.(percent)
      } else if (key === 'speed') {
        const speed = Number.parseFloat(value)
        if (Number.isFinite(speed)) options.onProgress?.(-1, speed)
      }
    }
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000)
  })

  const done = new Promise<{ code: number; stderr: string }>((resolve) => {
    child.on('error', (err) => resolve({ code: -1, stderr: err.message }))
    child.on('close', (code) => resolve({ code: code ?? -1, stderr }))
  })

  return { child, done }
}

export interface MediaProbe {
  duration?: number
  hasVideo: boolean
  hasAudio: boolean
}

/**
 * Inspect a media file. ffmpeg-static ships no ffprobe, so we ask ffmpeg to
 * open the file and parse the report it prints before bailing out on the
 * missing output. Knowing which streams exist matters: converting a silent
 * video to MP3 otherwise fails deep inside ffmpeg with "Output file does not
 * contain any stream", which tells the user nothing.
 */
export function probeMedia(path: string): Promise<MediaProbe> {
  const bin = ffmpegPath()
  if (!bin) return Promise.resolve({ hasVideo: false, hasAudio: false })
  return new Promise((resolve) => {
    const child = spawn(bin, ['-hide_banner', '-i', path], { windowsHide: true })
    let stderr = ''
    const finish = (): void => {
      clearTimeout(timer)
      const m = stderr.match(/Duration:\s*(\d+):(\d{2}):(\d{2})\.(\d+)/)
      const seconds = m
        ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(`0.${m[4]}`)
        : undefined
      resolve({
        duration: seconds != null && Number.isFinite(seconds) ? seconds : undefined,
        hasVideo: /Stream #\d+:\d+.*: Video:/.test(stderr),
        hasAudio: /Stream #\d+:\d+.*: Audio:/.test(stderr)
      })
    }
    const timer = setTimeout(() => {
      killTree(child)
      finish()
    }, 15_000)
    child.stderr?.on('data', (c: Buffer) => (stderr += c.toString()))
    child.on('error', finish)
    child.on('close', finish)
  })
}

/** Just the duration — the common case. */
export async function probeDuration(path: string): Promise<number | undefined> {
  return (await probeMedia(path)).duration
}

const FFMPEG_RULES: { re: RegExp; code: AppErrorCode; message: string }[] = [
  {
    re: /does not contain any stream/,
    code: 'noAudioTrack',
    message:
      'Nothing to write — the source has no track of the kind this format needs (a silent video can’t become an audio file).'
  },
  {
    re: /no such file or directory|cannot find the (file|path)/,
    code: 'sourceMissing',
    message: 'The source file is gone — it may have been moved or deleted.'
  },
  {
    re: /permission denied|access is denied/,
    code: 'permission',
    message: 'No permission to write next to the source file.'
  },
  {
    re: /no space left|not enough space/,
    code: 'diskFull',
    message: 'Your disk is full — free some space and try again.'
  },
  {
    re: /unknown encoder|encoder not found/,
    code: 'unknownEncoder',
    message: 'The bundled ffmpeg can’t encode this format. Pick another one.'
  },
  {
    re: /invalid data found|moov atom not found/,
    code: 'damagedSource',
    message: 'The source file looks damaged or incomplete.'
  }
]

/**
 * Turn ffmpeg's internal complaints into something a person can act on — and a
 * code, so the renderer can say the same thing in the user's own language.
 */
export function classifyFfmpegError(raw: string): { code?: AppErrorCode; message: string } {
  const lower = raw.toLowerCase()
  for (const rule of FFMPEG_RULES) {
    if (rule.re.test(lower)) return { code: rule.code, message: rule.message }
  }
  const line =
    raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('['))
      .pop() || raw.trim()
  return { message: line.slice(0, 300) || 'Conversion failed.' }
}

export function humanizeFfmpegError(raw: string): string {
  return classifyFfmpegError(raw).message
}

// ---------------------------------------------------------------------------
// Argument builders
// ---------------------------------------------------------------------------

/** Seconds → `HH:MM:SS.mmm`, the format ffmpeg is happiest with. */
export function toTimestamp(seconds: number): string {
  const safe = Math.max(0, seconds)
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`
}

/** How long the trimmed result will be, or undefined when it runs to the end. */
export function rangeDuration(range: TrimRange, sourceDuration?: number): number | undefined {
  const start = range.start ?? 0
  const end = range.end ?? sourceDuration
  if (end == null) return undefined
  const length = end - start
  return length > 0 ? length : undefined
}

/**
 * Cut `[start, end]` out of a file.
 *
 * `precise` re-encodes the video so the cut lands exactly where the user asked.
 * Stream copy is far faster but can only cut on keyframes, which for "remove
 * the intro" typically leaves a second or two of the intro behind — so precise
 * is the default and the fast path is opt-in.
 */
export function buildTrimArgs(
  input: string,
  output: string,
  range: TrimRange,
  precise: boolean
): string[] {
  const args: string[] = []
  if (range.start && range.start > 0) args.push('-ss', toTimestamp(range.start))
  args.push('-i', input)
  const duration = rangeDuration(range)
  if (duration != null) args.push('-t', toTimestamp(duration))

  if (precise) {
    // Re-encode video for a frame-accurate cut; audio is copied when it can be.
    args.push(
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-c:a',
      'aac',
      '-b:a',
      '192k'
    )
  } else {
    args.push('-c', 'copy')
  }
  args.push('-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', output)
  return args
}

const AUDIO_CODEC: Record<string, string[]> = {
  mp3: ['-c:a', 'libmp3lame', '-q:a', '2'],
  m4a: ['-c:a', 'aac', '-b:a', '256k'],
  aac: ['-c:a', 'aac', '-b:a', '256k'],
  opus: ['-c:a', 'libopus', '-b:a', '160k'],
  flac: ['-c:a', 'flac'],
  wav: ['-c:a', 'pcm_s16le']
}

const VIDEO_CODEC: Record<string, string[]> = {
  mp4: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-c:a', 'aac', '-b:a', '192k'],
  mkv: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-c:a', 'aac', '-b:a', '192k'],
  mov: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-c:a', 'aac', '-b:a', '192k'],
  webm: ['-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-c:a', 'libopus', '-b:a', '128k']
}

/** Convert a file to another container/codec, optionally downscaling. */
export function buildConvertArgs(input: string, output: string, target: ConvertTarget): string[] {
  const args: string[] = ['-i', input]

  if (target.mode === 'audio') {
    args.push('-vn', ...(AUDIO_CODEC[target.container] ?? AUDIO_CODEC.mp3))
    args.push(output)
    return args
  }

  if (target.container === 'gif') {
    // A single-pass palette filter — far better looking than naive gif output.
    const fps = 12
    const width = target.height ? Math.round((target.height * 16) / 9) : 480
    args.push(
      '-vf',
      `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
      '-loop',
      '0',
      output
    )
    return args
  }

  if (target.height) args.push('-vf', `scale=-2:${target.height}`)
  args.push(...(VIDEO_CODEC[target.container] ?? VIDEO_CODEC.mp4))
  if (target.container === 'mp4' || target.container === 'mov') {
    args.push('-movflags', '+faststart')
  }
  args.push(output)
  return args
}

/**
 * A destination path next to the source that doesn't collide with an existing
 * file — `clip.mp4`, then `clip (2).mp4`, and so on.
 */
export function uniqueOutputPath(sourcePath: string, suffix: string, container: string): string {
  const dir = dirname(sourcePath)
  const ext = extname(sourcePath)
  const base = sourcePath.slice(dir.length + 1, sourcePath.length - ext.length)
  let candidate = join(dir, `${base}${suffix}.${container}`)
  let n = 2
  while (existsSync(candidate)) {
    candidate = join(dir, `${base}${suffix} (${n}).${container}`)
    n++
  }
  return candidate
}
