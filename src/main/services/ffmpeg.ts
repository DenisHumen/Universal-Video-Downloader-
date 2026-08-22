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
  /** Codec names as ffmpeg reports them: `h264`, `aac`, `vp9`. */
  videoCodec?: string
  audioCodec?: string
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
        hasAudio: /Stream #\d+:\d+.*: Audio:/.test(stderr),
        // Which codecs, not merely whether there are any: a conversion that
        // only changes the container can copy these straight across.
        videoCodec: /Stream #\d+:\d+.*: Video: (\w+)/.exec(stderr)?.[1],
        audioCodec: /Stream #\d+:\d+.*: Audio: (\w+)/.exec(stderr)?.[1]
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
 * Containers that hold audio and nothing else. A trim keeps the source's
 * extension, so this doubles as the list of extensions a music download from
 * this app arrives with — and every one of them was previously handed an h264
 * video encoder and an AAC audio encoder.
 */
const AUDIO_ONLY_CONTAINERS = new Set(['mp3', 'm4a', 'aac', 'opus', 'ogg', 'oga', 'flac', 'wav'])

/** Only the MOV family understands `+faststart`; elsewhere it is a warning. */
const FASTSTART_CONTAINERS = new Set(['mp4', 'm4v', 'mov', 'm4a'])

/**
 * What each container will actually accept from a re-encode.
 *
 * WebM takes VP9 and Opus, and nothing this app might otherwise reach for.
 * libvpx's own default is slower than real time; `good`/`cpu-used 4` halves
 * that for no visible difference at this CRF.
 */
const TRIM_VIDEO: Record<string, string[]> = {
  webm: ['-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-deadline', 'good', '-cpu-used', '4']
}
const TRIM_VIDEO_DEFAULT = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20']

const TRIM_AUDIO: Record<string, string[]> = {
  webm: ['-c:a', 'libopus', '-b:a', '160k']
}
const TRIM_AUDIO_DEFAULT = ['-c:a', 'aac', '-b:a', '192k']

/**
 * Audio containers whose header carries a total length that a stream copy does
 * not rewrite.
 *
 * FLAC's STREAMINFO keeps the source's sample count, so a copied cut holds ten
 * seconds of audio behind a header claiming thirty, with a start time pointing
 * into the middle of the original. Players show the wrong length and a seek bar
 * that runs off the end of the sound. Re-encoding costs nothing here — FLAC is
 * lossless, so the output is the same audio, sample for sample — and it is worth
 * doing on the fast path too, because a file that misreports itself is not a
 * faster answer, just a wrong one.
 *
 * Checked the others the same way, by decoding the result and comparing it with
 * the header: mp3, m4a, opus and wav all copy honestly.
 */
const TRIM_AUDIO_RECODE: Record<string, string[]> = {
  flac: ['-c:v', 'copy', '-c:a', 'flac']
}

/**
 * Cut `[start, end]` out of a file.
 *
 * `precise` re-encodes the video so the cut lands exactly where the user asked.
 * Stream copy is far faster but can only cut on keyframes, which for "remove
 * the intro" typically leaves a second or two of the intro behind — so precise
 * is the default and the fast path is opt-in.
 *
 * The encoders have to match the container, which is the source's own: a trim
 * writes `song (clip).mp3` beside `song.mp3`. Asking the MP3 muxer to accept an
 * AAC stream, or the WebM muxer to accept h264, fails before the first frame is
 * written — "Could not write header" — leaving an empty file and a generic
 * post-processing error. Every audio download and every VP9 video download hit
 * that, which is most of them, and precise is the default.
 *
 * Audio takes the copy path whatever the toggle says, and that is the honest
 * answer rather than a shortcut: an audio frame is tens of milliseconds, so a
 * copy is already accurate to well past anything a person can hear, and
 * re-encoding a lossy file to trim it would throw away quality to gain nothing.
 */
export function buildTrimArgs(
  input: string,
  output: string,
  range: TrimRange,
  precise: boolean,
  hasVideo = true
): string[] {
  const args: string[] = []
  if (range.start && range.start > 0) args.push('-ss', toTimestamp(range.start))
  args.push('-i', input)
  const duration = rangeDuration(range)
  if (duration != null) args.push('-t', toTimestamp(duration))

  const container = extname(output).slice(1).toLowerCase()
  const audioOnly = !hasVideo || AUDIO_ONLY_CONTAINERS.has(container)

  if (!precise || audioOnly) {
    args.push(...(TRIM_AUDIO_RECODE[container] ?? ['-c', 'copy']))
  } else {
    args.push(...(TRIM_VIDEO[container] ?? TRIM_VIDEO_DEFAULT))
    args.push(...(TRIM_AUDIO[container] ?? TRIM_AUDIO_DEFAULT))
  }

  args.push('-avoid_negative_ts', 'make_zero')
  if (FASTSTART_CONTAINERS.has(container)) args.push('-movflags', '+faststart')
  args.push(output)
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

/**
 * Codecs each container can hold as they are, so a conversion that only
 * changes the wrapper need not decode and re-encode a single frame.
 *
 * Converting an MKV of h264 and AAC to MP4 is the commonest thing anyone asks
 * of this screen, and it is a rename with extra steps — the streams inside are
 * already what MP4 wants. It was re-encoding every frame at CRF 21 regardless:
 * minutes of work, a generation of quality thrown away, for a file that comes
 * out worse than the copy would have been.
 */
const REMUXABLE: Record<string, { video: RegExp; audio: RegExp }> = {
  mp4: { video: /^(h264|hevc|av1|mpeg4)$/, audio: /^(aac|mp3|ac3|eac3|alac)$/ },
  mov: { video: /^(h264|hevc|prores|mpeg4)$/, audio: /^(aac|mp3|alac|pcm_\w+)$/ },
  mkv: {
    video: /^(h264|hevc|av1|vp8|vp9|mpeg4|theora)$/,
    audio: /^(aac|mp3|ac3|eac3|opus|vorbis|flac|alac|dts|pcm_\w+)$/
  },
  webm: { video: /^(vp8|vp9|av1)$/, audio: /^(opus|vorbis)$/ }
}

/** Convert a file to another container/codec, optionally downscaling. */
export function buildConvertArgs(
  input: string,
  output: string,
  target: ConvertTarget,
  streams?: Pick<MediaProbe, 'videoCodec' | 'audioCodec'>
): string[] {
  const args: string[] = ['-i', input]

  if (target.mode === 'audio') {
    args.push('-vn', ...(AUDIO_CODEC[target.container] ?? AUDIO_CODEC.mp3))
    args.push(output)
    return args
  }

  if (target.container === 'gif') {
    // A single-pass palette filter — far better looking than naive gif output.
    const fps = 12
    /*
      Scale by whichever dimension was actually asked for. This used to turn a
      requested height into a width by multiplying by 16/9 and then scale on
      that width — so it was only ever right for a 16:9 source. Ask for a 480p
      GIF of a phone video and you got one 853 wide and about 1517 tall: three
      times the height requested, and a file to match.
    */
    const scale = target.height ? `-1:${target.height}` : '480:-1'
    args.push(
      '-vf',
      `fps=${fps},scale=${scale}:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
      '-loop',
      '0',
      output
    )
    return args
  }

  const rules = REMUXABLE[target.container]
  const canRemux =
    // Downscaling has to decode; nothing else here does.
    !target.height &&
    !!rules &&
    !!streams?.videoCodec &&
    rules.video.test(streams.videoCodec) &&
    (!streams.audioCodec || rules.audio.test(streams.audioCodec))

  if (target.height) args.push('-vf', `scale=-2:${target.height}`)
  if (canRemux) {
    /*
      One video and one audio track, which is what ffmpeg's own default
      selection would have picked. Naming them keeps subtitles and attachments
      out: MP4 cannot hold the ASS subtitles an MKV often carries, and a plain
      `-c copy` would fail on the whole file because of them.
    */
    args.push('-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy')
  } else {
    args.push(...(VIDEO_CODEC[target.container] ?? VIDEO_CODEC.mp4))
  }
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
export function uniqueOutputPath(
  sourcePath: string,
  suffix: string,
  container: string,
  taken: ReadonlySet<string> = new Set()
): string {
  const dir = dirname(sourcePath)
  const ext = extname(sourcePath)
  const base = sourcePath.slice(dir.length + 1, sourcePath.length - ext.length)
  /*
    `taken` is what the queue has already promised to other jobs. On disk a name
    is free until something writes it, and nothing writes until the job runs —
    so queueing two trims of the same file handed both the same output path and
    the second silently overwrote the first. At the concurrency limit they do
    not even take turns: two ffmpegs write the one file at once.

    Matched case-insensitively, because on Windows a difference in case is not
    a different file.
  */
  const claimed = (p: string): boolean => existsSync(p) || taken.has(p.toLowerCase())
  let candidate = join(dir, `${base}${suffix}.${container}`)
  let n = 2
  while (claimed(candidate)) {
    candidate = join(dir, `${base}${suffix} (${n}).${container}`)
    n++
  }
  return candidate
}
