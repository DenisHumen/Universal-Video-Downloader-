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

/** A cookie as `session.cookies.set` takes it. */
export interface CookieToSet {
  url: string
  name: string
  value: string
  domain?: string
  path: string
  secure: boolean
  httpOnly: boolean
  expirationDate?: number
}

/**
 * The cookies in a Netscape file, ready for the built-in browser: what importing
 * a sign-in from another browser reads, since the engine exports it as one.
 * Expired ones are left out, and so is a line that is not a cookie.
 */
export function fromNetscape(text: string, nowS: number): CookieToSet[] {
  const out: CookieToSet[] = []
  for (const raw of text.split(/\r?\n/)) {
    let line = raw
    let httpOnly = false
    if (line.startsWith('#HttpOnly_')) {
      httpOnly = true
      line = line.slice('#HttpOnly_'.length)
    } else if (!line || line.startsWith('#')) continue
    const f = line.split('\t')
    if (f.length < 7) continue
    const [domain, sub, path, secureFlag, expires, name] = f
    const value = f.slice(6).join('\t')
    const host = domain.replace(/^\./, '')
    if (!host || !name) continue
    const expiry = Number(expires)
    if (expiry > 0 && expiry < nowS) continue
    const secure = secureFlag === 'TRUE'
    const cookiePath = path || '/'
    out.push({
      url: `${secure ? 'https' : 'http'}://${host}${cookiePath}`,
      name,
      value,
      // As in persistentCopy: a domain makes it "and every subdomain", which a
      // host-only cookie (and every __Host- one) must not become.
      ...(sub === 'TRUE' && domain.startsWith('.') && !name.startsWith('__Host-') ? { domain } : {}),
      path: cookiePath,
      secure,
      httpOnly,
      ...(expiry > 0 ? { expirationDate: expiry } : {})
    })
  }
  return out
}

/** How many sites some cookies are for, near enough: what the import tells the user. */
export function siteCount(cookies: { url: string }[]): number {
  const sites = new Set<string>()
  for (const c of cookies) {
    const host = new URL(c.url).hostname.split('.')
    sites.add(host.slice(-2).join('.'))
  }
  return sites.size
}

export type ImportFailure = 'notFound' | 'locked' | 'encrypted' | 'failed'

/** Why the engine could not read a browser's cookies, from what it printed. */
export function importFailure(stderr: string): ImportFailure {
  if (/could not find .*(cookies database|profile|directory)|no such file|not installed/i.test(stderr)) {
    return 'notFound'
  }
  if (/could not copy .*cookie database|database is locked/i.test(stderr)) return 'locked'
  if (/decrypt|app.bound|keyring|DPAPI|keychain/i.test(stderr)) return 'encrypted'
  return 'failed'
}
