import type { AppSettings } from '@shared/types'

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
    args.push('--add-header', `${key}:${value}`)
  }
  return args
}

export function hasCookies(settings: AppSettings): boolean {
  return Boolean(settings.cookiesFile || settings.cookiesFromBrowser)
}

/**
 * Turn a raw yt-dlp error into a short, actionable message. When the failure
 * looks like an access gate and cookies aren't configured, we nudge the user
 * toward enabling them.
 */
export function humanizeYtdlpError(raw: string, cookiesEnabled: boolean): string {
  const line =
    raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .pop() || raw.trim()
  const lower = line.toLowerCase()
  const cookieHint = cookiesEnabled ? '' : ' Try enabling browser cookies in Settings → Access.'

  if (/\b410\b|http error 404|\bgone\b|\b404\b|has been removed|video.*deleted|not found/.test(lower)) {
    return `This video is unavailable — it may have been removed, made private, or the site is blocking access from your region.${cookieHint}`
  }
  if (/age|verify your age|18 u\.s\.c|age-?restricted|sensitive content/.test(lower)) {
    return `This content is age-restricted.${cookieHint}`
  }
  if (/\b429\b|too many requests|rate.?limit/.test(lower)) {
    return 'The site is rate-limiting us. Wait a minute and retry, or set a proxy in Settings → Network.'
  }
  if (/sign in|log ?in|logged in|private video|members? only|requires authentication|account/.test(lower)) {
    return `This video requires you to be signed in.${cookieHint}`
  }
  if (/\b40[13]\b|forbidden/.test(lower)) {
    return `The site refused the request.${cookieHint}`
  }
  if (/geo|not available in your country|region|blocked in your/.test(lower)) {
    return 'This video is not available in your region.'
  }
  if (/\bdrm\b|widevine|fairplay|playready/.test(lower)) {
    return 'This video is DRM-protected and cannot be downloaded.'
  }
  if (/no space left|enospc|disk full/.test(lower)) {
    return 'Your disk is full — free some space and try again.'
  }
  if (/permission denied|eacces|eperm/.test(lower)) {
    return 'No permission to write to the download folder. Pick another one in Settings.'
  }
  if (/ffmpeg|postprocessing|conversion failed/.test(lower)) {
    return 'Post-processing failed — the video downloaded but could not be merged or converted.'
  }
  if (/unsupported url|no video formats|unable to extract|nothing to download/.test(lower)) {
    return `Could not find a downloadable video at this link.${cookieHint}`
  }
  if (/timed out|timeout|connection|network|resolve host|unreachable/.test(lower)) {
    return 'Network problem reaching the site. Check your connection or proxy and try again.'
  }
  return line.replace(/^ERROR:\s*/i, '')
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
