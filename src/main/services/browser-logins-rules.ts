/**
 * The rules behind staying signed in, apart from Electron so they can be tested.
 *
 * See browser-logins.ts for the why.
 */

/** The fields of an Electron cookie these rules read. */
export interface JarCookie {
  name: string
  value: string
  domain?: string
  hostOnly?: boolean
  path?: string
  secure?: boolean
  httpOnly?: boolean
  session?: boolean
  expirationDate?: number
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
}

/** How long a cookie the site meant for "this visit" is kept: a month, like "remember me". */
export const KEEP_SESSION_COOKIE_S = 30 * 24 * 3600

/**
 * The same cookie, made to outlive a restart. Undefined for one that already does.
 *
 * Shaped for `session.cookies.set`, which wants a URL rather than a domain and
 * treats a given domain as "and its subdomains" - so a host-only cookie is set
 * without one, or it would start reaching every subdomain.
 */
export function persistentCopy(
  cookie: JarCookie,
  nowS: number
): (Omit<JarCookie, 'hostOnly' | 'session'> & { url: string }) | undefined {
  if (!cookie.session || !cookie.domain) return undefined
  const host = cookie.domain.replace(/^\./, '')
  const path = cookie.path || '/'
  return {
    url: `${cookie.secure ? 'https' : 'http'}://${host}${path}`,
    name: cookie.name,
    value: cookie.value,
    ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
    path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    expirationDate: nowS + KEEP_SESSION_COOKIE_S
  }
}

/** Google's sign-in cookies: present only when somebody is signed in. */
const GOOGLE_SIGNED_IN = /^(SID|__Secure-1PSID|__Secure-3PSID|SAPISID)$/
const GOOGLE = /(^|\.)(youtube\.com|google\.[a-z.]+|googlevideo\.com)$/i

/**
 * The jar, in the Netscape format yt-dlp reads with `--cookies`.
 *
 * YouTube's and Google's cookies go in only when they hold a sign-in. Handed
 * the consent and tracking cookies of a signed-out visit, the engine switches
 * to the clients that accept cookies, which YouTube treats worse than the ones
 * it uses without - so browsing YouTube here would have made YouTube downloads
 * fail. Signed in, the cookies are the point.
 */
export function toNetscape(cookies: JarCookie[]): string {
  const signedInToGoogle = cookies.some(
    (c) => GOOGLE.test((c.domain ?? '').replace(/^\./, '')) && GOOGLE_SIGNED_IN.test(c.name)
  )
  const lines = ['# Netscape HTTP Cookie File', '# Written by Universal Video Downloader from its built-in browser.', '']
  for (const c of cookies) {
    const domain = c.domain ?? ''
    if (!domain || /[\t\n\r]/.test(c.name + c.value + domain + (c.path ?? ''))) continue
    if (!signedInToGoogle && GOOGLE.test(domain.replace(/^\./, ''))) continue
    const sub = !c.hostOnly && domain.startsWith('.')
    lines.push(
      [
        (c.httpOnly ? '#HttpOnly_' : '') + domain,
        sub ? 'TRUE' : 'FALSE',
        c.path || '/',
        c.secure ? 'TRUE' : 'FALSE',
        String(c.session || !c.expirationDate ? 0 : Math.floor(c.expirationDate)),
        c.name,
        c.value
      ].join('\t')
    )
  }
  return lines.join('\n') + '\n'
}

/** How many cookies `toNetscape` wrote: none means there is no point passing the file. */
export function netscapeCount(text: string): number {
  return text.split('\n').filter((l) => l && (!l.startsWith('#') || l.startsWith('#HttpOnly_'))).length
}

export interface SavedLogin {
  username: string
  password: string
}

/**
 * Where a password may be kept and filled: an https page, or this machine.
 * A password typed into a plain-http page is already in the open; keeping it
 * would only mean filling it into the next page that pretends to be that site.
 */
export function loginOrigin(url: string): string | undefined {
  try {
    const u = new URL(url)
    if (u.protocol === 'https:') return u.origin
    if (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)) return u.origin
  } catch {
    /* not a URL */
  }
  return undefined
}

/** What saving a login just typed would do: nothing, add one, or change a password. */
export function saveKind(saved: SavedLogin[], typed: SavedLogin): 'same' | 'new' | 'update' {
  const match = saved.find((s) => s.username === typed.username)
  if (!match) return 'new'
  return match.password === typed.password ? 'same' : 'update'
}

/** The list with `typed` saved in it: replacing the same username, newest first. */
export function withLogin(saved: SavedLogin[], typed: SavedLogin): SavedLogin[] {
  return [typed, ...saved.filter((s) => s.username !== typed.username)]
}
