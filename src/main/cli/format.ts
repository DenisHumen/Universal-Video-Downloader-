import { isSentLink } from '@shared/sent-link'
import type { AppErrorCode, AppSettings, DownloadMode, QualityPreset } from '@shared/types'

/**
 * The command line's words: what it accepts, what it prints while it works,
 * and what it says when a link does not work.
 *
 * Pure, and in English only - a terminal is the one place the app does not
 * follow the interface language, because scripts grep what it prints.
 */

/** The switch that turns a launch of the app into a terminal run. */
export const CLI_FLAG = '--cli'

/**
 * The arguments meant for the command line, or null for an ordinary launch.
 *
 * Everything after `--cli`: the wrapper puts it first, but Electron in
 * development puts its own entry script ahead of it, so it is looked for
 * rather than assumed at a position.
 *
 * Never with a `uvd:` link beside it. A terminal run downloads without asking,
 * and a link is what a web page can fire: one that got `--cli` onto the command
 * line would have downloaded by itself, which is the one thing it must not do.
 */
export function cliArgvFrom(argv: string[]): string[] | null {
  if (argv.some(isSentLink)) return null
  const at = argv.indexOf(CLI_FLAG)
  return at === -1 ? null : argv.slice(at + 1)
}

/**
 * The heights `--quality` takes: the same ladder the app's quality picker and
 * its default-quality setting offer, so a script and the window mean the same
 * thing by "1080".
 */
export const CLI_QUALITIES = ['best', '2160', '1440', '1080', '720', '480', '360'] as const

/** One of the ladder's rungs; each is a `QualityPreset` the downloader already reads. */
export type CliQuality = (typeof CLI_QUALITIES)[number] & QualityPreset

const QUALITY_LIST = 'best, 2160, 1440, 1080, 720, 480 or 360'

/**
 * A quality as somebody types it, or null when it is not one of the ladder's.
 *
 * "1080p" and "4K" are how heights are written everywhere else, including on
 * the app's own buttons, so they are read as the numbers they stand for rather
 * than refused on a technicality. Anything else is refused outright: when no
 * format fits a height the engine falls back to the best there is, so a typo
 * such as "72" would quietly cost a download many times the size asked for.
 */
export function parseQuality(value: string): CliQuality | null {
  const text = value.trim().toLowerCase()
  const normalised = text === '4k' ? '2160' : text.replace(/^(\d+)p$/, '$1')
  return (CLI_QUALITIES as readonly string[]).includes(normalised) ? (normalised as CliQuality) : null
}

export interface CliOptions {
  links: string[]
  /** A folder to save into instead of the one in Settings. */
  output?: string
  audio: boolean
  /** The tallest video to take; `best` takes whatever the site has. Absent: what Settings says. */
  quality?: CliQuality
  help: boolean
  version: boolean
  /** What was wrong with the command line, if anything. */
  error?: string
}

export function parseCliArgs(args: string[]): CliOptions {
  const options: CliOptions = { links: [], audio: false, help: false, version: false }
  const takeQuality = (flag: string, value: string | undefined): string | undefined => {
    if (!value) return `${flag} needs a quality after it: ${QUALITY_LIST}.`
    const quality = parseQuality(value)
    if (!quality) return `${flag} takes ${QUALITY_LIST}, not "${value}".`
    options.quality = quality
    return undefined
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-h' || arg === '--help') options.help = true
    else if (arg === '-V' || arg === '-v' || arg === '--version') options.version = true
    else if (arg === '-a' || arg === '--audio') options.audio = true
    else if (arg === '-o' || arg === '--output') {
      const value = args[++i]
      if (!value) return { ...options, error: `${arg} needs a folder after it.` }
      options.output = value
    } else if (arg.startsWith('--output=')) options.output = arg.slice('--output='.length)
    else if (arg === '-q' || arg === '--quality') {
      const error = takeQuality(arg, args[++i])
      if (error) return { ...options, error }
    } else if (arg.startsWith('--quality=')) {
      const error = takeQuality('--quality', arg.slice('--quality='.length))
      if (error) return { ...options, error }
    } else if (arg === '--') {
      // Everything after `--` is a link, even one that starts with a dash.
      options.links.push(...args.slice(i + 1).map((a) => a.trim()).filter(Boolean))
      break
    } else if (arg.startsWith('-')) return { ...options, error: `Unknown option: ${arg}` }
    else if (arg.trim()) options.links.push(arg.trim())
  }
  /*
    The engine ignores a video height when it is asked for sound only, so the
    two together would download something other than what one of them says.
    Better to ask than to guess which one was meant.
  */
  if (options.quality && options.audio && !options.error) {
    options.error = '--quality picks a video size, so it does nothing with --audio. Leave one of them out.'
  }
  if (!options.help && !options.version && !options.error && options.links.length === 0) {
    options.error = 'Give it a link to download.'
  }
  return options
}

/** What to fetch: the two fields of a queue item the command line decides. */
export interface CliChoice {
  mode: DownloadMode
  quality: QualityPreset
}

/**
 * What a run downloads: the flags, or else the app's default mode and quality.
 *
 * Either flag says all of it, whatever Settings has. `-q` asks for a video even
 * when the app's default is sound only, and `-a` needs no height. A default
 * quality of "audio" with the mode on video reads as `best`, the way the app's
 * own automatic downloads read it.
 */
export function downloadChoice(
  options: Pick<CliOptions, 'audio' | 'quality'>,
  defaults: Pick<AppSettings, 'defaultMode' | 'defaultQuality'>
): CliChoice {
  if (options.audio) return { mode: 'audio', quality: 'audio' }
  if (options.quality) return { mode: 'video', quality: options.quality }
  if (defaults.defaultMode === 'audio') return { mode: 'audio', quality: 'audio' }
  const quality = defaults.defaultQuality
  return { mode: 'video', quality: !quality || quality === 'audio' ? 'best' : quality }
}

export const USAGE = `Usage: uvd <link> [<link> ...] [options]

Downloads each link with the default mode and quality from the app's settings
(the best quality, until you change them), into your Downloads folder or the
folder chosen there. The flags below override the settings for this run.

Options:
  -q, --quality <best|2160|1440|1080|720|480|360>
                         take a video of at most this height (1080p and 4K
                         work too); a site without it gives the best it has
  -o, --output <folder>  save into this folder instead
  -a, --audio            save the audio only
  -V, --version          print the version
  -h, --help             print this help

If a link does not work here, open Universal Video Downloader and try it
there: the app can also read the page itself and catch the stream in its
built-in browser.`

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface CliProgress {
  status: string
  downloaded?: number
  total?: number
  speed?: number
  eta?: number
}

const number = (value: string | undefined): number | undefined => {
  if (!value || value === 'NA' || value === 'None') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

/**
 * One line of the engine's progress template, after its prefix:
 * status, downloaded, total, estimated total, speed, eta, fragment, fragments.
 */
export function parseProgress(fields: string): CliProgress {
  const [status, downloaded, total, estimate, speed, eta] = fields.split('\t')
  return {
    status: status || 'downloading',
    downloaded: number(downloaded),
    total: number(total) ?? number(estimate),
    speed: number(speed),
    eta: number(eta)
  }
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

export function formatEta(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rest = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`
}

/** `  42% ━━━━━━━━━━──────────────  120 MB of 286 MB · 8.1 MB/s · 0:21 left` */
export function progressLine(p: CliProgress, width = 24): string {
  const share = p.total && p.downloaded != null ? Math.min(1, p.downloaded / p.total) : undefined
  const parts: string[] = []
  if (p.downloaded != null) {
    parts.push(p.total ? `${formatBytes(p.downloaded)} of ${formatBytes(p.total)}` : formatBytes(p.downloaded))
  }
  if (p.speed) parts.push(`${formatBytes(p.speed)}/s`)
  if (p.eta != null && share !== 1) parts.push(`${formatEta(p.eta)} left`)
  if (share == null) return `  downloading  ${parts.join(' · ')}`.trimEnd()
  const filled = Math.round(share * width)
  const percent = `${Math.floor(share * 100)}%`.padStart(4)
  return `  ${percent} ${'━'.repeat(filled)}${'─'.repeat(width - filled)}  ${parts.join(' · ')}`.trimEnd()
}

/**
 * The file name to show for a destination the engine announced. The first one
 * is often a single stream about to be merged - `Title [id].f137.mp4` - and
 * the format number is not part of the name the file ends up with.
 */
export function displayName(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path
  return name.replace(/\.f\d+(?=\.\w+$)/, '')
}

/**
 * Whether this line of the engine's names the file to tell the person about.
 *
 * An audio run first fetches a stream it is about to turn into something else,
 * so "saving as x.mp4" was wrong about what they would get; only the extraction
 * knows. Any run may also fetch subtitles first, and those are not what is saved.
 */
export function namesTheFile(path: string, priority: number, audio: boolean): boolean {
  if (audio) return priority >= EXTRACTED_PRIORITY
  return !/\.(vtt|srt|ass|ttml|srv\d|json3|lrc|webp|jpe?g|png)$/i.test(path)
}

/** What `finalPathCandidate` gives the line from the step that makes the finished file. */
const EXTRACTED_PRIORITY = 6

/** A subtitle track the engine gave up on: the video goes on without it, and so does the run. */
export function subtitleMissLine(language: string): string {
  return `  ! could not fetch the ${language} subtitles; the video itself is fine`
}

/**
 * Progress while ffmpeg fetches the stream. It reports how much of the video
 * it has, never bytes or a total, and the terminal knows no duration to set
 * that against - so it says the position, which still shows it is moving.
 */
export function ffmpegProgressLine(seconds: number): string {
  return `  downloading with ffmpeg  ${formatEta(seconds)} of the video so far`
}

/** What a post-processing step is doing, as a person would say it. */
export function postprocessLine(postprocessor: string | undefined): string {
  const name = (postprocessor ?? '').toLowerCase()
  if (name.includes('merger')) return '  merging video and audio…'
  if (name.includes('extractaudio')) return '  converting the audio…'
  if (name.includes('thumbnail')) return '  adding the thumbnail…'
  if (name.includes('metadata')) return '  writing the metadata…'
  if (name.includes('subtitle') || name.includes('subs')) return '  adding subtitles…'
  if (name.includes('sponsorblock')) return '  cutting sponsor segments…'
  return '  finishing up…'
}

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

/*
  The failures the app itself might still get past. The engine is only the
  first of the app's attempts: after it gives up, the app reads the page,
  watches it in a hidden browser, and offers its built-in browser to pick the
  stream by hand. None of that runs in a terminal, so for these the honest
  answer is "try it in the app", not "this cannot be downloaded".
*/
const APP_MIGHT_MANAGE = new Set<AppErrorCode | undefined>([
  undefined,
  'noFormats',
  'emptyPage',
  'unsupportedPlayer',
  'forbidden',
  'corruptLink',
  'streamGone'
])

/** The process exit code for a link that did not detect: distinct, so scripts can tell. */
export const EXIT_NOT_DETECTED = 2

export interface CliFailure {
  exitCode: number
  lines: string[]
}

export function describeFailure(code: AppErrorCode | undefined, message: string, cookieHint: boolean): CliFailure {
  if (APP_MIGHT_MANAGE.has(code)) {
    return {
      exitCode: EXIT_NOT_DETECTED,
      lines: [
        // With no code the sentence is the only reason there is; a 503 or a locked file was hidden behind this line.
        code ? "✗ Couldn't find a video to download at this link." : `✗ ${message}`,
        '  Open Universal Video Downloader and try it there: the app can also read',
        '  the page itself and catch the stream in its built-in browser.'
      ]
    }
  }
  const lines = [`✗ ${message}`]
  if (cookieHint) {
    lines.push('  Switch on browser cookies in the app (Settings → Access) and run this again.')
  }
  return { exitCode: 1, lines }
}
