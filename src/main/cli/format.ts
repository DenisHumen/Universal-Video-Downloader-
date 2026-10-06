import type { AppErrorCode } from '@shared/types'

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
 */
export function cliArgvFrom(argv: string[]): string[] | null {
  const at = argv.indexOf(CLI_FLAG)
  return at === -1 ? null : argv.slice(at + 1)
}

export interface CliOptions {
  links: string[]
  /** A folder to save into instead of the one in Settings. */
  output?: string
  audio: boolean
  help: boolean
  version: boolean
  /** What was wrong with the command line, if anything. */
  error?: string
}

export function parseCliArgs(args: string[]): CliOptions {
  const options: CliOptions = { links: [], audio: false, help: false, version: false }
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
    else if (arg === '--') {
      // Everything after `--` is a link, even one that starts with a dash.
      options.links.push(...args.slice(i + 1).map((a) => a.trim()).filter(Boolean))
      break
    } else if (arg.startsWith('-')) return { ...options, error: `Unknown option: ${arg}` }
    else if (arg.trim()) options.links.push(arg.trim())
  }
  if (!options.help && !options.version && !options.error && options.links.length === 0) {
    options.error = 'Give it a link to download.'
  }
  return options
}

export const USAGE = `Usage: uvd <link> [<link> ...] [options]

Downloads the video at each link in the best quality it offers, into your
Downloads folder (or the folder chosen in the app's settings).

Options:
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
        "✗ Couldn't find a video to download at this link.",
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
