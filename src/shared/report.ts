import { hasTrim, type AppErrorCode, type DownloadMode, type QueueKind, type TrimRange } from './types'
import { redact } from './redact'
import { normalizeUrl } from './urls'

/**
 * Error reports to the developer: what goes into one, and how it is sent.
 *
 * A link that fails is the cheapest bug report there is — the user already
 * has the URL, the app already has the engine's last words — and almost
 * nobody files one, because filing it means finding the repository, writing
 * it up and pasting a log they cannot judge. So the app offers to do it, one
 * click per failure, and never without that click.
 *
 * Everything here is pure: no Electron, no network of its own. Main collects
 * the context and owns the request; this decides what the report says, what
 * it must never say, and when the app has sent enough of them.
 */

/**
 * Where reports go.
 *
 * Through FormSubmit, because the repository is public: anything that can send
 * mail by itself — SMTP credentials, a mail API key — would be published along
 * with the source. FormSubmit takes a plain JSON POST and turns it into an
 * email, with nothing secret on this side.
 *
 * The very first submission is not delivered. FormSubmit answers it by mailing
 * the address an "Activate Form" link, and until the owner clicks it every
 * request comes back saying the form needs activation — which the app treats
 * like any other failure, offering the mail app instead. Once it is active,
 * FormSubmit can also issue a random alias for the endpoint; putting that here
 * in place of the address keeps the address itself out of the source.
 *
 * FormSubmit also wants to know which page a form lives on, and refuses a
 * submission that does not say — its answer is "open this page through a web
 * server". A browser says so in the Referer; a request from main has no page,
 * so `formUrl` stands in for one, sent both as the Referer and as FormSubmit's
 * own `_url` field. It is fixed on purpose: the one-time activation belongs to
 * that form URL, and a different one would ask to be activated all over again.
 */
export const REPORT_TARGET = {
  address: 'denis@krokosha.com',
  endpoint: 'https://formsubmit.co/ajax/denis@krokosha.com',
  formUrl: 'https://github.com/DenisHumen/Universal-Video-Downloader-'
} as const

// ---------------------------------------------------------------------------
// Which failures are worth a report
// ---------------------------------------------------------------------------

/*
  Every code, decided once, in a table the compiler checks. A new code added to
  AppErrorCode is a build error here until someone says which side it is on —
  otherwise it would quietly start prompting, or quietly never would.

  The question is whether the developer could fix it. A full disk, a dropped
  connection, a video the site has region-locked or put behind a login are real
  failures with nothing in the app to change; offering a report for them would
  teach people to click "not now" on reflex, including on the ones that matter.
*/
const REPORTABLE: Record<AppErrorCode, boolean> = {
  // The user's machine or network.
  canceled: false,
  diskFull: false,
  permission: false,
  network: false,
  timeout: false,
  // A local file that was moved or deleted after it was queued.
  sourceMissing: false,
  // The site's policy, working as the site intends.
  rateLimited: false,
  geo: false,
  ageRestricted: false,
  signIn: false,
  drm: false,
  unavailable: false,
  // Something the app could learn to do.
  noFormats: true,
  emptyPage: true,
  postprocess: true,
  cutFailed: true,
  damagedSource: true,
  streamGone: true,
  corruptLink: true,
  forbidden: true,
  unknownEncoder: true,
  noAudioTrack: true,
  ffmpegMissing: true
}

/**
 * Whether to offer a report for this failure at all.
 *
 * No code means no rule recognised the error — which is exactly the failure
 * the developer has not seen yet, so it is the most reportable of all.
 */
export function isReportable(code?: AppErrorCode): boolean {
  return code ? REPORTABLE[code] : true
}

export type ReportStage = 'detect' | 'download'

/** The failure reads as "this site isn't handled", rather than "something broke". */
export function isUnsupportedSite(stage: ReportStage, code?: AppErrorCode): boolean {
  return code === 'noFormats' || code === 'emptyPage' || (stage === 'detect' && !code)
}

/**
 * The site a link belongs to, as the subject line and the "don't ask again"
 * memory both name it. Internal `uvd-*://` addresses report their scheme —
 * their "host" is whatever the resolver encoded, not a site.
 */
export function reportHost(url: string): string {
  try {
    // Through normalizeUrl, so a link pasted without https:// still has a site.
    const parsed = new URL(normalizeUrl(url))
    if (!/^https?:$/.test(parsed.protocol)) return parsed.protocol.replace(/:$/, '')
    return parsed.hostname.replace(/^www\./i, '')
  } catch {
    return ''
  }
}

/**
 * What "already answered" is remembered by: the site and the error code.
 *
 * Home hands over the link as typed and the queue the one main normalised, so
 * `example.com/a` and `https://www.example.com/b` have to come out the same
 * here, or one failure would be asked about twice.
 */
export function reportAnswerKey(url: string, code?: AppErrorCode): string {
  return `${reportHost(url) || url.trim()}|${code ?? 'unclassified'}`
}

// ---------------------------------------------------------------------------
// What a report is built from
// ---------------------------------------------------------------------------

/** What detection tried before it gave up — only what it already knew. */
export interface DetectTrace {
  /** The built-in resolver that took the link. */
  resolver?: string
  /** A built-in resolver (or an internal scheme) threw instead of answering. */
  resolverThrew?: boolean
  /** The address the resolver handed the engine, when it was not the link itself. */
  resolvedUrl?: string
  /** Universal detection ran: how far it got, and whether it was allowed the hidden browser. */
  universal?: { browserAllowed: boolean; stages: string[] }
}

/** Settings that change how a site behaves — reported as on/off, never as values. */
export interface ReportFlags {
  cookies: boolean
  proxy: boolean
  customTemplate: boolean
}

/** One failure, as main recorded it at the moment it happened. */
export interface FailureContext {
  stage: ReportStage
  /** The link the user gave the app, or the file a trim/convert job read. */
  url: string
  /** `url` is a path on this machine, not a web address. */
  local?: boolean
  /** The address actually fetched, when the resolver or a retry changed it. */
  resolvedUrl?: string
  title?: string
  extractor?: string
  errorCode?: AppErrorCode
  /** The sentence the user was shown, in English. */
  message: string
  /** What the engine, ffmpeg or the resolver actually said. */
  rawError?: string
  /** The tail of engine output collected while it ran. */
  engineOutput?: string
  // Downloads
  kind?: QueueKind
  mode?: DownloadMode
  quality?: string
  formatId?: string
  range?: TrimRange
  precise?: boolean
  /** A trim/convert job's own summary — "→ MP4 · 720p". */
  job?: string
  // Detection
  detection?: DetectTrace
  /*
    Snapshotted when it failed, not when it is sent: the user may well go and
    switch cookies on after seeing the error, and the report is about the run
    that failed.
  */
  flags: ReportFlags
  /** Milliseconds since the epoch. */
  at: number
}

/** Everything about this installation a report needs, and what to scrub from it. */
export interface ReportEnv {
  appVersion: string
  platform: string
  arch: string
  osRelease: string
  electron: string
  ytdlp?: string
  ffmpeg?: string
  language: string
  scrub: Scrub
}

export interface BuiltReport {
  subject: string
  /** Flat string fields — FormSubmit lays them out as a table. */
  fields: Record<string, string>
  /** The same content as plain text, for the preview, the clipboard and mailto. */
  text: string
}

export interface ReportPreview {
  subject: string
  text: string
}

export type SendFailure = 'expired' | 'rateLimited' | 'notActivated' | 'rejected' | 'network'
export type SendOutcome = { ok: true } | { ok: false; reason: SendFailure }
/** The same, plus the relay's own explanation of a refusal — for the log, not the window. */
export type PostOutcome = { ok: true } | { ok: false; reason: SendFailure; detail?: string }

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

/** What must never leave the machine, beyond the shapes `redact` already knows. */
export interface Scrub {
  homeDir?: string
  userName?: string
  /** The cookies.txt path from Settings. Its contents are never read at all. */
  cookiesFile?: string
  /** The proxy setting — its credentials are stripped, its host is not secret. */
  proxy?: string
  /** Stored passwords and tokens, as literal values. */
  secrets?: string[]
}

const MASK = 'REDACTED'
const COOKIES = '<cookies file>'

/*
  Literal values shorter than this are left to the pattern rules. A three-letter
  password replaced everywhere it occurs would shred every line of engine output
  that happens to contain those letters, and the shapes it could leak through —
  a URL, a header, a `password=` — are already covered by `redact`.
*/
const MIN_LITERAL = 4

/** `scheme://user:pass@` or `scheme://user@` — the whole userinfo goes. */
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi

/*
  A path that names a cookie store: a cookies.txt somewhere, or the browser's
  own database the engine says it is reading with --cookies-from-browser.
  Quoted (it may hold spaces) or bare, and either way it has to *start* like a
  path. A quoted span that merely mentions cookies is prose — yt-dlp's own
  "use --cookies-from-browser" advice is the most useful line in a sign-in
  failure. The lookbehind keeps the bare form off web addresses: in
  `https://site/cookie-policy` every slash follows a colon, a slash or a
  letter, never a space or a quote.
*/
const COOKIE_PATH =
  /(["'])(?:[A-Za-z]:)?[~\\/][^"'\r\n]*cookie[^"'\r\n]*\1|(?<![\w:/\\.-])(?:[A-Za-z]:)?[~\\/][^\s"']*cookie[^\s"']*/gi

/*
  A cookies.txt line the engine could not parse, which it then prints whole —
  value and all — as `WARNING: skipping cookie file entry due to invalid length
  1: '.site.com    TRUE    /    ...'`. One bad line is enough, and a file whose
  tabs became spaces in a copy-paste has nothing but bad lines, so every cookie
  in it would be printed. The reason goes with the line: an "invalid expires
  at" quotes a field of it.
*/
const COOKIE_WARNING = /(skipping cookie file entry)[^\r\n]*/gi

/*
  And any line that still looks like a Netscape cookie entry — domain, TRUE or
  FALSE, path, TRUE or FALSE, expiry, name, value — whether the fields are
  separated by tabs, by the spaces a copy-paste left, or by the `\t` Python's
  repr writes. Upper-case TRUE/FALSE is that format's own spelling; nothing
  else the engine prints looks like it.
*/
const COOKIE_ENTRY =
  /^[^\r\n]*?(?:TRUE|FALSE)(?:[\t ]+|\\t)\S*?(?:[\t ]+|\\t)(?:TRUE|FALSE)(?:[\t ]+|\\t)\d[^\r\n]*$/gm

/*
  Somebody's profile folder, when it is not spelled the way os.homedir() spells
  it: Windows' 8.3 short name (`C:\Users\DENISH~1`), another account, a path the
  engine printed with its slashes turned round. The same lookbehind as above
  keeps it out of URLs — `site.com/home/videos` is not a home directory.

  The engine reports a Windows file error through Python's repr, which doubles
  every backslash (`'C:\\Users\\denis\\x.mp4'`), and ffmpeg names its output
  `file:C:\Users\...` — so a doubled backslash counts as one separator, and a
  `file:` prefix may stand where the lookbehind would otherwise refuse a colon.
  A folder name with spaces in it (`Denis Humen`) is taken whole, as long as a
  separator follows to show where it ends. Never across a colon, which no
  folder name has: in `C:\Users\bob and C:\Users\ann\x` the first match must
  stop at "bob", or it would swallow the drive of the second and leave "ann".
*/
const PROFILE_DIR =
  /(?:(?<![\w:/\\.~-])|(?<=(?<![\w-])file:(?:\/{2,3})?))(?:[A-Za-z]:)?(?:\\\\|[\\/])(?:Users|home)(?:\\\\|[\\/])(?!Public(?:[\\/]|$))(?:[^\\/\s"'<>|?*:]+(?: [^\\/\s"'<>|?*:]+)*(?=[\\/])|[^\\/\s"'<>|?*]+)/gi

/*
  A web address, kept in the split so it can be left alone. `file:` is not one:
  it is a path on this machine with a prefix.
*/
const WEB_ADDRESS = /(\b(?!file:)[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*)/i

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** One path, spelled with either kind of slash, and with backslashes doubled the way a repr spells them. */
function slashVariants(path: string): string[] {
  const back = path.replace(/\//g, '\\')
  return [...new Set([path, path.replace(/\\/g, '/'), back, back.replace(/\\/g, '\\\\')])]
}

/**
 * The user:pass part of a proxy setting.
 *
 * The setting is Chromium's proxy-rules syntax, so it may have no scheme at
 * all (`bob:hunter2@proxy:8080`) or several rules at once — the URL pattern
 * alone would miss the first, so these become literal values to scrub.
 */
export function proxyCredentials(proxy: string | undefined): string[] {
  if (!proxy) return []
  const found: string[] = []
  for (const m of proxy.matchAll(/(?:^|[\s;=/])([^\s;=/@:]+):([^\s;/@]+)@/g)) {
    found.push(`${m[1]}:${m[2]}`, m[2])
  }
  return found
}

/** Take credentials out of a web address and nothing else. */
export function stripUrlCredentials(url: string): string {
  return url.replace(URL_USERINFO, '$1')
}

/**
 * Make a piece of text safe to send.
 *
 * Cookie file lines go before anything else, since nothing about them is
 * worth keeping. Then literal secrets, while they are still whole — every later
 * rule rewrites text and could break one up so it no longer matches. `redact`
 * goes last and catches the generic shapes: headers, signed query parameters,
 * Telegram tokens.
 */
export function scrubText(text: string, scrub: Scrub): string {
  let out = text
    .replace(COOKIE_WARNING, '$1 (contents removed)')
    .replace(COOKIE_ENTRY, '<cookie file entry removed>')

  const literals = [...(scrub.secrets ?? []), ...proxyCredentials(scrub.proxy)]
    .filter((value) => value && value.length >= MIN_LITERAL)
    .sort((a, b) => b.length - a.length)
  for (const value of literals) out = out.split(value).join(MASK)

  if (scrub.cookiesFile && scrub.cookiesFile.length >= MIN_LITERAL) {
    for (const variant of slashVariants(scrub.cookiesFile)) out = out.split(variant).join(COOKIES)
  }
  out = out.replace(URL_USERINFO, '$1').replace(COOKIE_PATH, COOKIES)

  // A home directory of `/` or `C:` would turn every path into `~`. The
  // lookahead stops `C:\Users\ann` from matching inside `C:\Users\anna`.
  const home = scrub.homeDir?.replace(/[\\/]+$/, '')
  if (home && home.length >= 3) {
    for (const variant of slashVariants(home)) {
      out = out.replace(new RegExp(`${escapeRegExp(variant)}(?![\\w.-])`, 'gi'), '~')
    }
  }
  out = out.replace(PROFILE_DIR, '~')

  /*
    The user name as a folder anywhere else — `D:\Profiles\denis\...`. Never
    inside a web address: a Windows account called "user" must not turn
    YouTube's `/user/` channel links into `/~/`. Everything between addresses
    is searched as it stands rather than word by word, so a name with a space
    in it is still one name.
  */
  const user = scrub.userName?.trim()
  if (user && user.length >= 2) {
    const segment = new RegExp(`(?<=[\\\\/])${escapeRegExp(user)}(?=[\\\\/\\s"'<>|]|$)`, 'gim')
    out = out
      .split(WEB_ADDRESS)
      .map((part, i) => (i % 2 ? part : part.replace(segment, '~')))
      .join('')
  }

  return redact(out)
}

// ---------------------------------------------------------------------------
// Building the report
// ---------------------------------------------------------------------------

const TAIL_LINES = 60
const TAIL_CHARS = 6000
const OMITTED = '[… earlier output omitted]'

/**
 * The end of a block of output, which is where the reason lives.
 *
 * Lines first, then characters, and the character cut moves forward to the
 * next line break so the block never opens on half a line. The marker counts
 * against the cap, so the result is never longer than `maxChars`.
 */
export function outputTail(text: string, maxLines = TAIL_LINES, maxChars = TAIL_CHARS): string {
  // ffmpeg rewrites one status line with bare carriage returns.
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  const whole = lines.join('\n')
  let kept = lines.slice(-maxLines).join('\n')
  const budget = maxChars - OMITTED.length - 1
  if (kept.length > budget) {
    kept = kept.slice(-budget)
    const nl = kept.indexOf('\n')
    if (nl >= 0 && nl < kept.length - 1) kept = kept.slice(nl + 1)
  }
  return kept.length < whole.length ? `${OMITTED}\n${kept}` : kept
}

/** The last few lines of an error — the full output travels separately. */
function errorLines(raw: string): string {
  const lines = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim())
  return lines.slice(-5).join('\n').slice(-1500)
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

function describeWork(ctx: FailureContext): string {
  if (ctx.stage === 'detect') return 'detection'
  const kind = ctx.kind === 'trim' || ctx.kind === 'convert' ? `${ctx.kind} (local file)` : 'download'
  const parts = [kind]
  if (ctx.mode) parts.push(ctx.mode)
  if (ctx.formatId) parts.push(`format ${ctx.formatId}`)
  else if (ctx.quality) parts.push(`quality ${ctx.quality}`)
  if (ctx.job) parts.push(ctx.job)
  else if (hasTrim(ctx.range)) {
    const start = clock(ctx.range?.start ?? 0)
    const end = ctx.range?.end != null ? clock(ctx.range.end) : 'end'
    parts.push(`trim ${start}–${end}${ctx.precise === false ? ' (keyframe cut)' : ''}`)
  }
  return parts.join(' · ')
}

const STAGE_NAMES: Record<string, string> = { scraping: 'page scan', browsing: 'hidden browser' }

function describeDetection(trace: DetectTrace): string {
  const parts: string[] = []
  if (trace.resolverThrew) parts.push('built-in resolver threw (see raw error)')
  else parts.push(`built-in resolver: ${trace.resolver ?? 'none'}`)
  if (trace.universal) {
    const steps = trace.universal.stages.map((s) => STAGE_NAMES[s] ?? s)
    const how = steps.length ? [...new Set(steps)].join(' → ') : 'started'
    const browser = trace.universal.browserAllowed ? '' : ' (hidden browser off in settings)'
    parts.push(`universal detection: ${how}${browser}, found nothing`)
  } else {
    parts.push('universal detection: not run')
  }
  return parts.join(' · ')
}

const onOff = (value: boolean): string => (value ? 'on' : 'off')

/**
 * Turn a recorded failure into the report the user previews and the developer
 * receives.
 *
 * One ordered list of rows feeds both the form fields and the plain text, so
 * what the preview shows is exactly what is sent. The link goes in whole — it
 * is the reason for the report, and the user sees it before sending — with
 * only a `user:pass@` taken out. Everything else that came from the machine
 * goes through `scrubText`.
 */
export function buildReport(ctx: FailureContext, env: ReportEnv): BuiltReport {
  const clean = (value: string | undefined): string | undefined =>
    value ? scrubText(value, env.scrub) : undefined

  const local = Boolean(ctx.local)
  const link = local ? (clean(ctx.url) ?? '') : stripUrlCredentials(ctx.url)
  const host = local ? 'local file' : reportHost(ctx.url) || 'unknown site'
  const resolved = ctx.resolvedUrl ?? ctx.detection?.resolvedUrl
  const code = ctx.errorCode ?? 'unclassified'

  const label =
    ctx.stage === 'detect'
      ? 'detection failed'
      : ctx.kind === 'trim' || ctx.kind === 'convert'
        ? `${ctx.kind} failed`
        : 'download failed'
  const subject = isUnsupportedSite(ctx.stage, ctx.errorCode)
    ? `[UVD ${env.appVersion}] unsupported site: ${host}`
    : `[UVD ${env.appVersion}] ${label}: ${host} (${code})`

  const output = ctx.engineOutput ? outputTail(scrubText(ctx.engineOutput, env.scrub)) : undefined
  const raw = ctx.rawError ? clean(errorLines(ctx.rawError)) : undefined

  const rows: [string, string | undefined][] = [
    ['what failed', describeWork(ctx)],
    ['site', host],
    ['link', link],
    ['resolved link', resolved && resolved !== ctx.url ? clean(resolved) : undefined],
    ['extractor', ctx.extractor],
    ['title', clean(ctx.title)],
    ['error code', code],
    ['message', clean(ctx.message)],
    ['raw error', raw && raw !== clean(ctx.message) ? raw : undefined],
    ['detection', ctx.detection ? describeDetection(ctx.detection) : undefined],
    [
      'settings',
      `cookies ${onOff(ctx.flags.cookies)} · proxy ${onOff(ctx.flags.proxy)} · ` +
        `custom filename template ${onOff(ctx.flags.customTemplate)}`
    ],
    ['app', env.appVersion],
    ['system', `${env.platform} ${env.arch} ${env.osRelease}`],
    ['electron', env.electron],
    ['yt-dlp', env.ytdlp || 'unknown'],
    ['ffmpeg', env.ffmpeg || 'unknown'],
    ['language', env.language],
    ['time', new Date(ctx.at).toISOString()],
    ['engine output', output]
  ]

  const fields: Record<string, string> = {}
  const lines: string[] = ['Universal Video Downloader error report', '']
  for (const [name, value] of rows) {
    if (!value) continue
    fields[name] = value
    if (!value.includes('\n')) {
      lines.push(`${name}: ${value}`)
      continue
    }
    // A block gets a blank line either side, so the rows after it read as rows.
    if (lines[lines.length - 1] !== '') lines.push('')
    lines.push(`${name}:`, value, '')
  }
  while (lines[lines.length - 1] === '') lines.pop()

  return { subject, fields, text: lines.join('\n') }
}

/** The JSON FormSubmit expects: the fields, plus its own settings and the form's page. */
export function formSubmitBody(report: BuiltReport): Record<string, string> {
  return { _subject: report.subject, _template: 'table', _url: REPORT_TARGET.formUrl, ...report.fields }
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export interface FetchResponseLike {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export type FetchLike = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal }
) => Promise<FetchResponseLike>

/**
 * Post a report and say plainly whether it arrived.
 *
 * `fetch` is passed in: main hands over Electron's `net.fetch`, which follows
 * the session proxy like the rest of the app's own requests, and the tests
 * hand over a stub so nothing is ever sent from a test run.
 *
 * The Referer is set by hand because nothing else would set it: `net.fetch`
 * copies the headers it is given and has no page of its own to refer from.
 */
export async function postReport(
  report: BuiltReport,
  fetchImpl: FetchLike,
  timeoutMs = 20_000
): Promise<PostOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(REPORT_TARGET.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Referer: REPORT_TARGET.formUrl
      },
      body: JSON.stringify(formSubmitBody(report)),
      signal: controller.signal
    })
    const reply = (await response.json().catch(() => null)) as {
      success?: unknown
      message?: unknown
    } | null
    // FormSubmit sends the flag as a string. Anything short of a clear yes is a no.
    if (response.ok && (reply?.success === true || reply?.success === 'true')) return { ok: true }
    /*
      FormSubmit's message is the only place a refusal says why — "needs
      Activation", "open this page through a web server". It is about the form,
      never the report, so it can go in the log; without it every refusal
      reads the same there.
    */
    const message = typeof reply?.message === 'string' ? reply.message.slice(0, 300) : ''
    const reason = /activat/i.test(message) ? 'notActivated' : 'rejected'
    return message ? { ok: false, reason, detail: message } : { ok: false, reason }
  } catch {
    return { ok: false, reason: 'network' }
  } finally {
    clearTimeout(timer)
  }
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

export interface RateLimiter {
  /** Claim a slot for one report; false when the limit is reached. */
  take(): boolean
}

/**
 * A ceiling on how many reports one installation sends.
 *
 * Every report is a click, so a person never gets near it. What it guards
 * against is a loop — a watch that fails the same way every ten minutes
 * overnight, a bug that re-renders a prompt — turning one inbox into a flood.
 * A sliding window, so the limit is about the last hour, not the clock hour.
 */
export function createRateLimiter(
  limits: { perHour: number; perDay: number } = { perHour: 5, perDay: 20 },
  now: () => number = Date.now
): RateLimiter {
  const sent: number[] = []
  return {
    take(): boolean {
      const at = now()
      while (sent.length && at - sent[0] >= DAY) sent.shift()
      const lastHour = sent.filter((t) => at - t < HOUR).length
      if (lastHour >= limits.perHour || sent.length >= limits.perDay) return false
      sent.push(at)
      return true
    }
  }
}

// ---------------------------------------------------------------------------
// The mail-app fallback
// ---------------------------------------------------------------------------

/*
  The whole link, not just the body. Windows hands a mailto to the mail client
  through a command line that stops a little past two thousand characters, and
  some clients give up sooner — so the cap is on what is actually handed over,
  with room to spare.
*/
export const MAILTO_MAX = 1800
const SHORTENED = '\n\n[shortened to fit an email link - "copy report" in the app has the full text]'

/**
 * A `mailto:` link to the developer carrying the report, never longer than
 * `max`.
 *
 * Percent-encoding makes the budget hard to guess — a Cyrillic title costs six
 * characters a letter — so the body is cut by measuring the encoded result.
 * By code point, never inside a surrogate pair: encodeURIComponent throws on
 * half of one.
 */
export function buildMailto(subject: string, body: string, max = MAILTO_MAX): string {
  const headFor = (s: string): string =>
    `mailto:${REPORT_TARGET.address}?subject=${encodeURIComponent(s)}&body=`
  const full = headFor(subject) + encodeURIComponent(body)
  if (full.length <= max) return full

  // A subject that leaves no room even for the note is shortened itself.
  const note = encodeURIComponent(SHORTENED).length
  const letters = Array.from(subject)
  while (letters.length && headFor(letters.join('')).length + note > max) letters.pop()
  const head = headFor(letters.join(''))

  const chars = Array.from(body)
  const fits = (n: number): boolean =>
    head.length + encodeURIComponent(chars.slice(0, n).join('') + SHORTENED).length <= max
  let lo = 0
  let hi = chars.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (fits(mid)) lo = mid
    else hi = mid - 1
  }
  return head + encodeURIComponent(chars.slice(0, lo).join('') + SHORTENED)
}

/**
 * The one kind of mailto the app will open.
 *
 * `openExternal` only ever opened web addresses. Widening it to every mailto
 * would let the window address mail to anyone; this lets it reach the
 * developer, with a link no longer than the fallback ever builds.
 */
export function isReportMailto(url: string): boolean {
  return url.startsWith(`mailto:${REPORT_TARGET.address}?`) && url.length <= MAILTO_MAX
}
