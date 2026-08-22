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
  {
    re: /\b410\b|http error 404|\bgone\b|\b404\b|has been removed|video.*deleted|not found/,
    code: 'unavailable',
    message:
      'This video is unavailable — it may have been removed, made private, or the site is blocking access from your region.',
    cookies: true
  },
  {
    re: /age|verify your age|18 u\.s\.c|age-?restricted|sensitive content/,
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
    re: /sign in|log ?in|logged in|private video|members? only|requires authentication|account/,
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
    re: /ffmpeg|postprocessing|conversion failed/,
    code: 'postprocess',
    message: 'Post-processing failed — the video downloaded but could not be merged or converted.'
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

export function classifyYtdlpError(raw: string, cookiesEnabled: boolean): ClassifiedError {
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

/** Transient failures worth retrying automatically before bothering the user. */
export function isTransientError(raw: string): boolean {
  const lower = raw.toLowerCase()
  if (
    /drm|widevine|private|removed|deleted|age-?restricted|premium|no space left|permission denied|unsupported url/.test(
      lower
    )
  ) {
    return false
  }
  return /timed out|timeout|connection|network|unreachable|reset|\b5\d{2}\b|\b429\b|temporar|try again|incomplete|broken pipe/.test(
    lower
  )
}
