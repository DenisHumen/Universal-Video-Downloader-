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
  if (/sign in|log ?in|logged in|private video|members? only|requires authentication|account/.test(lower)) {
    return `This video requires you to be signed in.${cookieHint}`
  }
  if (/geo|not available in your country|region|blocked in your/.test(lower)) {
    return 'This video is not available in your region.'
  }
  if (/unsupported url|no video formats|unable to extract|nothing to download/.test(lower)) {
    return `Could not find a downloadable video at this link.${cookieHint}`
  }
  if (/timed out|timeout|connection|network|resolve host|unreachable/.test(lower)) {
    return 'Network problem reaching the site. Check your connection or proxy and try again.'
  }
  return line.replace(/^ERROR:\s*/i, '')
}
