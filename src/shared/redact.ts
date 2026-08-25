/**
 * Keeping secrets out of the log file.
 *
 * This app handles more of them than its size suggests. It captures `Cookie`
 * and `Authorization` off sites the user is signed into — deliberately, because
 * that is often the only reason a CDN will serve the file — and it is about to
 * hold an SMB password and a Telegram bot token as well. The log is the one
 * place all of that can meet, because a log is written by every part of the
 * app and then handed to a stranger in a bug report.
 *
 * So redaction happens in the sink, on the finished line, rather than at the
 * call sites. A rule that has to be remembered is a rule that will be
 * forgotten; this one cannot be bypassed by writing the wrong thing.
 *
 * It is a denylist, which means it is only as good as its list. Two things
 * compensate: the logger refuses whole objects and takes named fields instead,
 * so there is no way to hand it a settings object and hope, and every secret
 * shape gets a test here at the same time as the code that introduces it.
 */

/**
 * A bare word on purpose.
 *
 * The first version used brackets, and redacting twice appended another one:
 * the value patterns below stop at a quote or an end of line, so `[REDACTED`
 * was itself a value worth redacting. `redact(redact(x)) === redact(x)` is a
 * test, not a hope.
 */
const MASK = 'REDACTED'

/** Headers whose value is a credential, not a description of the request. */
const SECRET_HEADER =
  /\b(cookie|set-cookie|authorization|proxy-authorization|x-csrf-token|x-auth-token|x-api-key)\b(\s*[:=]\s*)[^\r\n"',]*/gi

/** `smb://user:pass@host`, `http://bob:hunter2@proxy:8080`. */
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]{1,64}):([^/\s@]{1,256})@/gi

/**
 * A Telegram bot token lives in the URL *path*, not a header or a query
 * parameter: `api.telegram.org/bot<id>:<secret>/sendMessage`. A rule written
 * for query parameters would miss every single request this app makes to it.
 */
/*
  Not a word boundary before the digits. The URL is `/bot<id>:<secret>`, so the
  id is preceded by the `t` of "bot" — two word characters with no boundary
  between them, which meant the obvious rule matched nothing at all and every
  real request went into the log intact. A negative lookbehind for a digit does
  what the boundary was meant to: start at the beginning of the number, wherever
  that number happens to sit.
*/
const TELEGRAM_TOKEN = /(?<!\d)(\d{6,12}):([A-Za-z0-9_-]{25,})/g

/** Signed-CDN and API query parameters. */
const SECRET_PARAM =
  /\b(token|access_token|auth|auth_key|apikey|api_key|key|sig|signature|hdnts|hdntl|policy|expires|credential|password|passwd|pwd|secret)(=)[^&\s"'\r\n]*/gi

/** `password: "x"`, `botToken=x`, `"smbPassword": "x"`. */
const SECRET_FIELD =
  /\b(pass|passwd|password|pwd|secret|token|bot_?token|api_?key|apikey|smb_?password)("?\s*[:=]\s*"?)[^\s,;}"'\r\n]*/gi

/**
 * Strip anything that looks like a credential out of a line.
 *
 * Idempotent: running it twice gives the same string as running it once.
 */
export function redact(text: string): string {
  return text
    .replace(SECRET_HEADER, (_m, name: string, sep: string) => `${name}${sep}${MASK}`)
    .replace(URL_CREDENTIALS, (_m, scheme: string, user: string) => `${scheme}${user}:${MASK}@`)
    .replace(TELEGRAM_TOKEN, (_m, id: string) => `${id}:${MASK}`)
    .replace(SECRET_PARAM, (_m, name: string, sep: string) => `${name}${sep}${MASK}`)
    .replace(SECRET_FIELD, (_m, name: string, sep: string) => `${name}${sep}${MASK}`)
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

export function shouldLog(level: LogLevel, minimum: LogLevel): boolean {
  return ORDER[level] >= ORDER[minimum]
}

const p = (n: number, width = 2): string => String(Math.abs(n)).padStart(width, '0')

/**
 * Local time with an explicit offset, not UTC.
 *
 * Whoever reads this file says "it broke around six", and means six on their
 * own clock. The offset is there so a run that crosses a daylight-saving
 * change is still unambiguous.
 */
export function timestamp(at: Date): string {
  const offset = -at.getTimezoneOffset()
  const sign = offset < 0 ? '-' : '+'
  return (
    `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ` +
    `${p(at.getHours())}:${p(at.getMinutes())}:${p(at.getSeconds())}.${p(at.getMilliseconds(), 3)}` +
    `${sign}${p(Math.floor(Math.abs(offset) / 60))}:${p(Math.abs(offset) % 60)}`
  )
}

export interface LogEntry {
  at: Date
  level: LogLevel
  subsystem: string
  message: string
  fields?: Record<string, string | number | undefined>
}

/**
 * One event, one line — and every physical line carries the full prefix.
 *
 * A stack trace or a block of engine output arrives with newlines in it. If the
 * continuation lines were written bare, `grep ERROR` would find the first line
 * of a crash and none of the rest, which is the opposite of useful.
 */
export function formatLine(entry: LogEntry): string {
  const head =
    `${timestamp(entry.at)}  ${entry.level.toUpperCase().padEnd(5)}  ` +
    `${entry.subsystem.padEnd(9)}  `

  const pairs = Object.entries(entry.fields ?? {})
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' ')

  const body = String(entry.message).replace(/\r/g, '')
  const lines = body.split('\n')
  const last = lines.length - 1

  return lines
    .map((line, i) => redact(`${head}${line}${i === last && pairs ? `  ${pairs}` : ''}`))
    .join('\n')
}
