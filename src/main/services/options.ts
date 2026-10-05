import type { AppErrorCode, AppSettings } from '@shared/types'

/**
 * Engine arguments that control how restricted sites are accessed: proxy and
 * cookies. Cookies (from an installed browser or a cookies.txt file) let the
 * engine pass age-verification / login / region gates that many sites — adult
 * sites in particular — put in front of their videos.
 */
export function accessArgs(settings: AppSettings): string[] {
  const args: string[] = []
  if (settings.proxy) args.push('--proxy', settings.proxy)
  if (settings.cookiesFile) {
    args.push('--cookies', settings.cookiesFile)
  } else if (settings.cookiesFromBrowser) {
    args.push('--cookies-from-browser', settings.cookiesFromBrowser)
  }
  return args
}

/** `--add-header` pairs for streams that only work with specific headers. */
export function headerArgs(headers?: Record<string, string>): string[] {
  if (!headers) return []
  const args: string[] = []
  for (const [key, value] of Object.entries(headers)) {
    if (!value) continue
    // Referer has its own flag; the others would break the engine's own logic.
    if (/^(referer|range|accept-encoding|host|content-length)$/i.test(key)) continue
    /*
      These values are captured off a page we did not write. A carriage return
      or newline inside one would end the header and begin another as far as
      the engine is concerned, which is header injection by any other name.
      Neither belongs in a header value regardless.
    */
    const clean = value.replace(/[\r\n]+/g, ' ').trim()
    if (!clean) continue
    /*
      A NUL is dropped rather than patched. No real header carries one, and
      `spawn` refuses any argument containing it by throwing - which, before the
      download path caught that, left the row stuck on "downloading" for good.
    */
    if (clean.includes('\u0000') || key.includes('\u0000')) continue
    args.push('--add-header', `${key}:${clean}`)
  }
  return args
}

export function hasCookies(settings: AppSettings): boolean {
  return Boolean(settings.cookiesFile || settings.cookiesFromBrowser)
}

/**
 * What went wrong, as a code the renderer can translate plus the English
 * sentence to fall back on.
 *
 * The message used to be the only output, which meant every failure reached a
 * Russian-speaking user in English — the app is fully translated right up to
 * the moment something breaks, which is exactly when wording matters most. The
 * code carries the meaning across the IPC boundary; the message stays for the
 * log, the clipboard, and anything this table hasn't learned to recognise yet.
 */
export interface ClassifiedError {
  code?: AppErrorCode
  /** English fallback, always present. */
  message: string
  /** The failure looks like an access gate and no cookies are configured. */
  cookieHint: boolean
}

interface Rule {
  re: RegExp
  code: AppErrorCode
  message: string
  /** Suggest cookies when they aren't configured yet. */
  cookies?: boolean
}

const RULES: Rule[] = [
  /*
    First on purpose. A tool that is missing or has failed says so unambiguously,
    while several of the rules below are guesses from vaguer wording - and one of
    them used to win this race. `not found` in the "unavailable" rule matched
    "ffmpeg not found", so every post-processing failure was reported to the user
    as "this video may have been removed, or blocked in your region - try
    enabling cookies": a wrong diagnosis, a wrong remedy, and a file that had in
    fact downloaded perfectly.
  */
  {
    re: /ffmpeg|ffprobe|postprocessing|conversion failed/,
    code: 'postprocess',
    message: 'Post-processing failed - the video downloaded but could not be merged or converted.'
  },
  {
    re: /\b410\b|http error 404|\bgone\b|\b404\b|has been removed|video.*deleted|video.*not found|no such video/,
    code: 'unavailable',
    message:
      'This video is unavailable — it may have been removed, made private, or the site is blocking access from your region.',
    cookies: true
  },
  /*
    The engine's own wording for outcomes that the looser rules further down
    either missed or gave to the wrong code. They are exact phrases, so they
    go before the rules that guess from single words: "Video unavailable. This
    video has been removed because the account ... has been terminated" was a
    sign-in problem by way of `account`, and a format that is not available
    is not a video that is unavailable. A bare "is not available" is not here
    on purpose - it would take the format and region lines above it.
  */
  {
    re: /requested format is not available/,
    code: 'noFormats',
    message: 'Could not find a downloadable video at this link.'
  },
  {
    re: /not available from your location|geo.?restrict|made this video available in your country|not available in your country|ip address is blocked|blocked from accessing/,
    code: 'geo',
    message: 'This video is not available in your region.'
  },
  {
    re: /video (is )?unavailable|no longer available|account .* terminated/,
    code: 'unavailable',
    message:
      'This video is unavailable — it may have been removed, made private, or the site is blocking access from your region.',
    cookies: true
  },
  {
    re: /only available for (subscribers|members)|members?[- ]only|join this channel/,
    code: 'signIn',
    message: 'This video requires you to be signed in.',
    cookies: true
  },
  {
    re: /live event will (begin|start)|premieres? in|premiere will begin|is upcoming/,
    code: 'upcoming',
    message:
      'This video has not started yet — it is a scheduled premiere or live stream. Try again once it begins.'
  },
  /*
    A failure to reach the host at all, in the words of the resolver, the OS
    and the TLS library. Up here because the line that carries it also carries
    the address: "Failed to resolve 'login.example.com'" or a path with
    /region/ in it would otherwise be read by the sign-in or region rules.
  */
  {
    re: /getaddrinfo|name or service not known|nodename nor servname|no address associated|temporary failure in name resolution|errno (-[23]|1100[14])\b|failed to establish a new connection|certificate verify failed|\[ssl/,
    code: 'network',
    message: 'Network problem reaching the site. Check your connection or proxy and try again.'
  },
  /*
    Anchored. This was a bare `age`, which matched inside "webpage" - and
    "Unable to download webpage: ..." is how the engine opens nearly every
    network failure it has. A refused connection, a 403, a 429, a timeout and
    a DNS failure were all reported as age-restricted content, with advice to
    set up cookies that could not have helped.
  */
  {
    re: /\bage[- ]?(restricted|gate|verif)|confirm your age|verify your age|18 u\.s\.c|inappropriate for some users|sensitive content/,
    code: 'ageRestricted',
    message: 'This content is age-restricted.',
    cookies: true
  },
  {
    re: /\b429\b|too many requests|rate.?limit/,
    code: 'rateLimited',
    message:
      'The site is rate-limiting us. Wait a minute and retry, or set a proxy in Settings → Network.'
  },
  {
    re: /sign in|log ?in|logged in|private video|members?[- ]only|requires authentication|account/,
    code: 'signIn',
    message: 'This video requires you to be signed in.',
    cookies: true
  },
  {
    re: /\b40[13]\b|forbidden/,
    code: 'forbidden',
    message: 'The site refused the request.',
    cookies: true
  },
  {
    re: /geo|not available in your country|region|blocked in your/,
    code: 'geo',
    message: 'This video is not available in your region.'
  },
  {
    re: /\bdrm\b|widevine|fairplay|playready/,
    code: 'drm',
    message: 'This video is DRM-protected and cannot be downloaded.'
  },
  {
    re: /no space left|enospc|disk full/,
    code: 'diskFull',
    message: 'Your disk is full — free some space and try again.'
  },
  {
    re: /permission denied|eacces|eperm/,
    code: 'permission',
    message: 'No permission to write to the download folder. Pick another one in Settings.'
  },
  {
    re: /unsupported url|no video formats|unable to extract|nothing to download/,
    code: 'noFormats',
    message: 'Could not find a downloadable video at this link.',
    cookies: true
  },
  {
    re: /timed out|timeout/,
    code: 'timeout',
    message: 'The site took too long to answer. Check your connection or proxy and try again.'
  },
  {
    re: /connection|network|resolve host|unreachable/,
    code: 'network',
    message: 'Network problem reaching the site. Check your connection or proxy and try again.'
  }
]

/**
 * ffmpeg finished having written nothing.
 *
 * When a section download starts somewhere ffmpeg cannot read from, it exits
 * cleanly with an empty file; yt-dlp calls that a finished download, and the
 * failure only surfaces at the next step, as a post-processing error about the
 * empty file. Reading the last line alone, that became "the video downloaded
 * but could not be merged" - the one thing that certainly had not happened.
 */
const WROTE_NOTHING = /size=\s*0ki?b\s+time=n\/a|video:0ki?b audio:0ki?b/

export function classifyYtdlpError(raw: string, cookiesEnabled: boolean): ClassifiedError {
  if (WROTE_NOTHING.test(raw.toLowerCase())) {
    return {
      code: 'cutFailed',
      message:
        'Nothing was recorded from the point you chose to start at, so there was nothing to process. ' +
        'Try downloading it without cutting, then trim the file.',
      cookieHint: false
    }
  }
  const line =
    raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .pop() || raw.trim()
  const lower = line.toLowerCase()

  for (const rule of RULES) {
    if (!rule.re.test(lower)) continue
    const cookieHint = Boolean(rule.cookies) && !cookiesEnabled
    return {
      code: rule.code,
      message: cookieHint
        ? `${rule.message} Try enabling browser cookies in Settings → Access.`
        : rule.message,
      cookieHint
    }
  }
  return { message: line.replace(/^ERROR:\s*/i, ''), cookieHint: false }
}

/**
 * Turn a raw yt-dlp error into a short, actionable message. When the failure
 * looks like an access gate and cookies aren't configured, we nudge the user
 * toward enabling them.
 */
export function humanizeYtdlpError(raw: string, cookiesEnabled: boolean): string {
  return classifyYtdlpError(raw, cookiesEnabled).message
}

/**
 * Lines that describe the run rather than the way it ended: ffmpeg's indented
 * input summary (Duration, Stream, Metadata), its section headers, warnings,
 * and the engine's own note that it is retrying a connection it then made.
 */
const NOT_THE_FAILURE =
  /^(\s|WARNING:|Input #|Output #|Stream mapping|Press \[q\])|retrying with new connection/i

/**
 * The last few lines that say why the run ended.
 *
 * Not only `ERROR:` lines: when the engine hands a download to ffmpeg, the
 * transient reason - "Connection reset by peer" - is in ffmpeg's own line just
 * above the engine's flat "ffmpeg exited with code 1".
 */
function failureTail(raw: string): string {
  return raw
    .split('\n')
    .filter((line) => line.trim() && !NOT_THE_FAILURE.test(line))
    .slice(-4)
    .join('\n')
    .toLowerCase()
}

/**
 * Transient failures worth retrying automatically before bothering the user.
 *
 * Read from the end of the output only, and a 5xx only where it is an HTTP
 * status. This used to scan the whole 4000-character tail for any three-digit
 * number starting with 5, so ffmpeg's "bitrate: 548 kb/s" in the input summary,
 * or "Top 500" in the file name, made a permanent failure wait twelve seconds
 * and run twice more before the user heard about it.
 */
export function isTransientError(raw: string): boolean {
  const tail = failureTail(raw)
  if (
    /drm|widevine|private|removed|deleted|age-?restricted|premium|no space left|permission denied|unsupported url/.test(
      tail
    )
  ) {
    return false
  }
  return /timed out|timeout|connection|network|unreachable|reset|http error 5\d\d|\b5\d\d:? (internal server error|bad gateway|service unavailable|gateway time-?out)|server returned 5xx|\b429\b|temporar|try again|incomplete|broken pipe/.test(
    tail
  )
}

/**
 * The engine was still trying to connect when its time ran out.
 *
 * With warnings off the engine says little until it gives up, but whatever it
 * did write before the probe was killed is worth reading: a connect timeout or
 * a failed name lookup means the host is unreachable from here, which is a
 * different thing to tell someone than "the site may be unsupported".
 */
export function stalledConnecting(stderr: string): boolean {
  return /connect timeout|failed to establish a new connection|getaddrinfo|name or service not known/i.test(
    stderr
  )
}
