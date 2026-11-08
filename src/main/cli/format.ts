import type { AppErrorCode, AppSettings, DownloadMode, QualityPreset } from '@shared/types'
import type { MainLanguage } from '../services/locale'
import { decimalIn, reasonIn, wordsIn } from '../services/words'

/**
 * The command line's words: what it accepts, what it prints while it works,
 * and what it says when a link does not work.
 *
 * Pure. Everything that prints takes the language, and left out it is English,
 * which is also what a script gets: see `outputLanguage`.
 */

/**
 * The language to print in.
 *
 * The app's language on a terminal, where somebody is reading. Into a pipe or a
 * file it stays English, as it always has: scripts grep this output, and one
 * that looks for "Saved to" must not break because the machine it runs on is set
 * to Russian. Exit codes, the two streams and the marks at the start of a line
 * are the same either way. Help is read by a person even through `less`.
 */
export function outputLanguage(preferred: MainLanguage, terminal: boolean, help: boolean): MainLanguage {
  return terminal || help ? preferred : 'en'
}

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

/**
 * The heights `--quality` takes: the same ladder the app's quality picker and
 * its default-quality setting offer, so a script and the window mean the same
 * thing by "1080".
 */
export const CLI_QUALITIES = ['best', '2160', '1440', '1080', '720', '480', '360'] as const

/** One of the ladder's rungs; each is a `QualityPreset` the downloader already reads. */
export type CliQuality = (typeof CLI_QUALITIES)[number] & QualityPreset

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

export function parseCliArgs(args: string[], language: MainLanguage = 'en'): CliOptions {
  const { t } = wordsIn(language)
  const list = t('cli.err.qualityList')
  const options: CliOptions = { links: [], audio: false, help: false, version: false }
  const takeQuality = (flag: string, value: string | undefined): string | undefined => {
    if (!value) return t('cli.err.needsQuality', { flag, list })
    const quality = parseQuality(value)
    if (!quality) return t('cli.err.badQuality', { flag, list, value })
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
      if (!value) return { ...options, error: t('cli.err.needsFolder', { flag: arg }) }
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
    } else if (arg.startsWith('-')) return { ...options, error: t('cli.err.unknownOption', { flag: arg }) }
    else if (arg.trim()) options.links.push(arg.trim())
  }
  /*
    The engine ignores a video height when it is asked for sound only, so the
    two together would download something other than what one of them says.
    Better to ask than to guess which one was meant.
  */
  if (options.quality && options.audio && !options.error) {
    options.error = t('cli.err.qualityWithAudio')
  }
  if (!options.help && !options.version && !options.error && options.links.length === 0) {
    options.error = t('cli.err.noLink')
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

// The ladder as a flag's argument. Outside the dictionary, where a "|" means plural forms.
const QUALITY_ARGUMENT = `<${CLI_QUALITIES.join('|')}>`

export function usage(language: MainLanguage = 'en'): string {
  return wordsIn(language).t('cli.usage', { qualities: QUALITY_ARGUMENT })
}

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

export function formatBytes(bytes: number, language: MainLanguage = 'en'): string {
  const { t } = wordsIn(language)
  const units = [t('bytes.B'), t('bytes.KB'), t('bytes.MB'), t('bytes.GB'), t('bytes.TB')]
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : decimalIn(language, value, 1)} ${units[unit]}`
}

export function formatEta(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rest = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`
}

/** `  42% ━━━━━━━━━━──────────────  120 MB of 286 MB · 8.1 MB/s · 0:21 left` */
export function progressLine(p: CliProgress, width = 24, language: MainLanguage = 'en'): string {
  const { t } = wordsIn(language)
  const bytes = (n: number): string => formatBytes(n, language)
  const share = p.total && p.downloaded != null ? Math.min(1, p.downloaded / p.total) : undefined
  const parts: string[] = []
  if (p.downloaded != null) {
    parts.push(p.total ? t('cli.sizeOf', { done: bytes(p.downloaded), total: bytes(p.total) }) : bytes(p.downloaded))
  }
  if (p.speed) parts.push(`${bytes(p.speed)}${t('speed.perSecond')}`)
  if (p.eta != null && share !== 1) parts.push(t('cli.left', { time: formatEta(p.eta) }))
  if (share == null) return `  ${t('cli.downloading')}  ${parts.join(' · ')}`.trimEnd()
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
 * Progress while ffmpeg fetches the stream. It reports how much of the video
 * it has, never bytes or a total, and the terminal knows no duration to set
 * that against - so it says the position, which still shows it is moving.
 */
export function ffmpegProgressLine(seconds: number, language: MainLanguage = 'en'): string {
  return `  ${wordsIn(language).t('cli.ffmpegProgress', { time: formatEta(seconds) })}`
}

/** What a post-processing step is doing, as a person would say it. */
export function postprocessLine(postprocessor: string | undefined, language: MainLanguage = 'en'): string {
  const { t } = wordsIn(language)
  const name = (postprocessor ?? '').toLowerCase()
  if (name.includes('merger')) return `  ${t('cli.step.merge')}`
  if (name.includes('extractaudio')) return `  ${t('cli.step.audio')}`
  if (name.includes('thumbnail')) return `  ${t('cli.step.thumbnail')}`
  if (name.includes('metadata')) return `  ${t('cli.step.metadata')}`
  if (name.includes('subtitle') || name.includes('subs')) return `  ${t('cli.step.subtitles')}`
  if (name.includes('sponsorblock')) return `  ${t('cli.step.sponsors')}`
  return `  ${t('cli.step.finish')}`
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

/**
 * A failure's reason as it prints. English keeps the sentence the engine's output
 * was classified into, which is what this command has always said; another
 * language has the interface's sentence for the code, so the terminal and the
 * window say the same.
 */
export function failureText(language: MainLanguage, message: string, code?: AppErrorCode): string {
  return language === 'en' ? message : reasonIn(language, message, code)
}

export function describeFailure(
  code: AppErrorCode | undefined,
  message: string,
  cookieHint: boolean,
  language: MainLanguage = 'en'
): CliFailure {
  const { t } = wordsIn(language)
  if (APP_MIGHT_MANAGE.has(code)) {
    return {
      exitCode: EXIT_NOT_DETECTED,
      lines: [
        // With no code the sentence is the only reason there is; a 503 or a locked file was hidden behind this line.
        code ? `✗ ${t('cli.noVideo')}` : `✗ ${failureText(language, message)}`,
        ...t('cli.tryApp').split('\n').map((line) => `  ${line}`)
      ]
    }
  }
  const lines = [`✗ ${failureText(language, message, code)}`]
  if (cookieHint) lines.push(`  ${t('cli.cookieHint')}`)
  return { exitCode: 1, lines }
}

/**
 * The engine could not be got ready. One that is there and will not start is
 * antivirus, where the connection this used to mention could not help.
 */
export function engineSetupFailure(message: string, language: MainLanguage = 'en'): string[] {
  const { t } = wordsIn(language)
  if (/failed to start/i.test(message)) return [`✗ ${t('engine.startFailed')}`]
  return [`✗ ${t('cli.setupFailed', { why: message })}`, `  ${t('cli.setupAdvice')}`]
}
