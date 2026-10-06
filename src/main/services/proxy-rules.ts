import { decodeCredential, parseProxy } from '@shared/proxy'

/**
 * What Chromium can be told about the proxy, and what it has to be answered.
 *
 * The setting is written for yt-dlp, which takes credentials in the address
 * and the `socks5h` / `socks4a` names. Chromium takes neither: handed
 * `http://user:pass@host:8080` or `socks5h://host:1080`, `setProxy` resolved
 * without complaint, the log said the app's requests now went through the
 * proxy, and every one of them failed with ERR_NO_SUPPORTED_PROXIES - every
 * page, thumbnail, update check and Telegram message, for anyone with a paid
 * proxy or a Tor/v2ray setup, while downloads went on working.
 */

/** Why the rules differ from what was typed, for the log. */
export type ProxyCaveat = 'socksAuth' | 'socks4a'

export interface ChromiumProxy {
  /** What `setProxy` is given. Empty means the system's own network. */
  rules: string
  caveat?: ProxyCaveat
}

/**
 * Chromium's names for yt-dlp's. `socks5h` asks the proxy to resolve names,
 * which Chromium's SOCKS5 already does. `socks4a` has no equivalent: as
 * `socks4` the names are resolved on this computer, which the log says.
 */
const CHROMIUM_SCHEME: Record<string, string> = { socks5h: 'socks5', socks4a: 'socks4' }

function schemeName(scheme: string): string {
  return scheme.replace(/:\/\/$/, '').toLowerCase()
}

export function chromiumProxy(proxy: string): ChromiumProxy {
  const value = proxy.trim()
  if (!value) return { rules: '' }
  const { scheme, user, password, address } = parseProxy(value)
  const name = schemeName(scheme)
  /*
    Chromium cannot authenticate to a SOCKS proxy at all. Without the
    credentials the proxy turns every request away (ERR_SOCKS_CONNECTION_FAILED),
    so the app's own requests stay on the system network, as they did before
    they followed this setting, and the engine still uses the proxy.
  */
  if (name.startsWith('socks') && (user || password)) return { rules: '', caveat: 'socksAuth' }
  // A bare host:port is an HTTP proxy to Chromium too.
  const host = address.replace(/\/$/, '')
  const mapped = CHROMIUM_SCHEME[name] ?? name
  const rules = mapped ? `${mapped}://${host}` : host
  return name === 'socks4a' ? { rules, caveat: 'socks4a' } : { rules }
}

/**
 * Whether Chromium took the rules, from what it now resolves an address to.
 *
 * `setProxy` resolves for rules it could not parse; `resolveProxy` then answers
 * '' (or DIRECT), where a working proxy answers `PROXY host:port` or
 * `SOCKS5 host:port`. That answer is the only evidence there is.
 */
export function tookRules(rules: string, resolved: string): boolean {
  if (!rules) return true
  const answer = resolved.trim()
  return answer !== '' && !/^DIRECT$/i.test(answer)
}

/** The proxy the app's own requests may answer a 407 from, and with what. */
export interface ProxyCredentials {
  host: string
  port: number
  username: string
  password: string
}

/** Chromium's defaults, which is what a challenge reports when no port was typed. */
const DEFAULT_PORT: Record<string, number> = { '': 80, http: 80, https: 443 }

function bareHost(host: string): string {
  return host.replace(/^\[|\]$/g, '').toLowerCase()
}

/**
 * Only for HTTP and HTTPS proxies - Chromium never asks for SOCKS credentials -
 * and only when the address names a user.
 */
export function proxyCredentials(
  proxy: string,
  storedPassword: string | undefined
): ProxyCredentials | undefined {
  const { scheme, user, password, address } = parseProxy(proxy)
  const name = schemeName(scheme)
  if (!(name in DEFAULT_PORT) || !user) return undefined
  const match = /^(\[[^\]]*\]|[^:/]*)(?::(\d+))?\/?$/.exec(address)
  if (!match || !match[1]) return undefined
  return {
    host: bareHost(match[1]),
    port: match[2] ? Number(match[2]) : DEFAULT_PORT[name],
    username: decodeCredential(user),
    password: password !== undefined ? decodeCredential(password) : (storedPassword ?? '')
  }
}

/** The parts of Electron's `AuthInfo` that decide whether to answer. */
export interface ProxyChallenge {
  isProxy: boolean
  host: string
  port: number
}

/**
 * What to do with one challenge.
 *
 * `answer` with the credentials; `refused`, they were answered once and asked
 * for again; `unknown`, a proxy this app holds no credentials for; `site`, not
 * a proxy at all - a site's own login, which fails as it always did.
 */
export type LoginDecision =
  | { kind: 'answer'; username: string; password: string }
  | { kind: 'refused' }
  | { kind: 'unknown' }
  | { kind: 'site' }

/** How many answered requests to remember before starting again. */
const REMEMBERED = 200

/**
 * Answers a proxy's request for credentials once per request, then gives up.
 *
 * Nothing answered, and every request through an authenticated proxy failed.
 * Answering unconditionally is no better: a wrong password is challenged
 * again, answered again, for ever. So the first challenge for a request gets
 * the credentials, and a second one for the same request means they were
 * refused.
 *
 * Only the proxy the user configured is answered. A site asking for a login,
 * or a different proxy the system routes through, gets nothing - the password
 * is not handed to whoever asks for one.
 *
 * `key` names the request when one answerer serves many (the pages' `login`
 * event); a `net.request` gets an answerer of its own and needs none.
 */
export function createProxyLogin(
  current: () => ProxyCredentials | undefined
): (challenge: ProxyChallenge, key?: string) => LoginDecision {
  const answered = new Set<string>()
  return (challenge, key = '') => {
    if (!challenge.isProxy) return { kind: 'site' }
    const credentials = current()
    if (
      !credentials ||
      bareHost(challenge.host) !== credentials.host ||
      challenge.port !== credentials.port
    ) {
      return { kind: 'unknown' }
    }
    if (answered.has(key)) {
      // Forgotten as well, so loading the page again later gets one more try.
      answered.delete(key)
      return { kind: 'refused' }
    }
    if (answered.size >= REMEMBERED) answered.clear()
    answered.add(key)
    return { kind: 'answer', username: credentials.username, password: credentials.password }
  }
}
