/**
 * What the built-in browser says it is.
 *
 * Google refuses to sign anyone in from an embedded browser: "This browser or
 * app may not be secure". It tells one apart by comparing what the page is told
 * with what Chromium sends anyway. The browser used to call itself Chrome 124
 * on Windows, while every request also carried `Sec-CH-UA` client hints naming
 * the real Chromium, its real version and the real system, and no "Google
 * Chrome" brand. One contradicted the other, and that alone was enough.
 *
 * So the browser now names its real version and system everywhere, and on
 * Google's sign-in pages it says it is Firefox. Firefox sends no client hints
 * and has no `navigator.userAgentData`, so with both taken away there is
 * nothing left to contradict it. This is what other Electron apps do to let
 * people sign in to Google; Google could close it, and nothing here can stop
 * that. Importing a sign-in from the user's own browser does not depend on it.
 */

/** Where Google asks for a password. Pages here get the Firefox identity. */
const SIGN_IN_HOSTS = new Set(['accounts.google.com', 'accounts.youtube.com'])

export function isGoogleSignIn(url: string | undefined): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && SIGN_IN_HOSTS.has(parsed.hostname)
  } catch {
    return false
  }
}

/** The part of a Chrome user agent that names the system, as Chrome itself writes it. */
function chromeSystem(platform: NodeJS.Platform): string {
  if (platform === 'win32') return 'Windows NT 10.0; Win64; x64'
  if (platform === 'darwin') return 'Macintosh; Intel Mac OS X 10_15_7'
  return 'X11; Linux x86_64'
}

function firefoxSystem(platform: NodeJS.Platform): string {
  if (platform === 'win32') return 'Windows NT 10.0; Win64; x64'
  if (platform === 'darwin') return 'Macintosh; Intel Mac OS X 10.15'
  return 'X11; Linux x86_64'
}

/** Chrome's own user agent for this Chromium: the major version only, as Chrome sends it. */
export function browserUserAgent(platform: NodeJS.Platform, chromeVersion: string | undefined): string {
  const major = chromeVersion?.split('.')[0] || '146'
  return `Mozilla/5.0 (${chromeSystem(platform)}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
}

/**
 * A current Firefox. It ships every four weeks, so the version is worked out
 * from the date rather than written down to go stale: an old Firefox is turned
 * away for being old.
 */
export function firefoxVersion(now: Date): number {
  const FIREFOX_135 = Date.UTC(2025, 1, 4)
  const FOUR_WEEKS = 28 * 24 * 3600 * 1000
  return 135 + Math.max(0, Math.floor((now.getTime() - FIREFOX_135) / FOUR_WEEKS))
}

export function signInUserAgent(platform: NodeJS.Platform, now: Date): string {
  const v = firefoxVersion(now)
  return `Mozilla/5.0 (${firefoxSystem(platform)}; rv:${v}.0) Gecko/20100101 Firefox/${v}.0`
}

/** A sign-in request's headers as Firefox would send them: its user agent, no client hints. */
export function signInHeaders(headers: Record<string, string>, userAgent: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (lower.startsWith('sec-ch-ua') || lower === 'user-agent') continue
    out[name] = value
  }
  out['User-Agent'] = userAgent
  return out
}

/** The built-in browser everywhere but Google's sign-in pages. */
export const BROWSER_UA = browserUserAgent(process.platform, process.versions.chrome)

/** On Google's sign-in pages. */
export const SIGN_IN_UA = signInUserAgent(process.platform, new Date())
