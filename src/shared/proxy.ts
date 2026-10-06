/**
 * Whether a value can be used as the proxy setting.
 *
 * Shared, because the settings screen has to know before it saves. The field
 * used to save on every keystroke, and every save reconfigured the app's own
 * network: typing `http://127.0.0.1:8080` pointed every request in flight at
 * `h`, then `ht`, then `http`, and so on to the end.
 *
 * Deliberately loose. The same address goes to yt-dlp and to Chromium, and
 * refusing something either of them takes would be worse than letting a typo
 * through, so all this asks for is the shape of a proxy
 * address: an optional scheme, optional credentials, a host or a bracketed
 * IPv6 address, and an optional port. No port is fine - both default it.
 *
 * Empty is valid: it means the system's own network.
 */
const PROXY =
  /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^\s@\/]+@)?(?:\[[0-9a-f:.]+\]|[^\s:\/@\[\]?#;,=]+)(?::(\d{1,5}))?\/?$/i

export function isProxyValue(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return true
  const match = PROXY.exec(trimmed)
  if (!match) return false
  if (match[1] === undefined) return true
  const port = Number(match[1])
  return port >= 1 && port <= 65535
}

/** A proxy address taken apart, without judging it - `isProxyValue` does that. */
export interface ProxyParts {
  /** `http://`, `socks5h://`..., or empty for a bare `host:port`. */
  scheme: string
  /** As typed, still percent-encoded. */
  user?: string
  password?: string
  /** `host[:port]`, as typed. */
  address: string
}

/**
 * Split by hand rather than with `new URL()`. That reads a bare
 * `user@proxy.example.com:3128` as the scheme `user`, and serialises with a
 * trailing slash and the host lowercased, so a setting that only lost its
 * password would come back looking different from what was typed.
 *
 * The last `@` ends the credentials, as it does for every URL parser: a
 * password typed with a raw `@` in it is still a password.
 */
export function parseProxy(value: string): ProxyParts {
  const trimmed = value.trim()
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(trimmed)?.[0] ?? ''
  const rest = trimmed.slice(scheme.length)
  const at = rest.lastIndexOf('@')
  const address = rest.slice(at + 1)
  if (at < 0) return { scheme, address }
  const userinfo = rest.slice(0, at)
  const colon = userinfo.indexOf(':')
  if (colon < 0) return { scheme, user: userinfo, address }
  return { scheme, user: userinfo.slice(0, colon), password: userinfo.slice(colon + 1), address }
}

/** A percent-encoded user name or password, or the text itself if it is not valid encoding. */
export function decodeCredential(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** The user name in the address, decoded, or undefined when there is none. */
export function proxyUser(value: string): string | undefined {
  const { user } = parseProxy(value)
  return user ? decodeCredential(user) : undefined
}

/**
 * The address without its password, and the password on its own.
 *
 * settings.json is the file people copy between machines and attach to bug
 * reports, and every engine process carried the setting on its command line,
 * where any other program can read it. So a password typed into the address
 * is lifted out of it and kept with the other secrets; the user name stays,
 * because it is what says the proxy needs one.
 */
export function splitProxyPassword(value: string): { proxy: string; password?: string } {
  const trimmed = value.trim()
  const { scheme, user, password, address } = parseProxy(trimmed)
  if (password === undefined) return { proxy: trimmed }
  return {
    proxy: user ? `${scheme}${user}@${address}` : `${scheme}${address}`,
    password: password ? decodeCredential(password) : undefined
  }
}

/**
 * The whole address again, password included - for the engine, in memory.
 *
 * Only when the address names a user. A password left over from another proxy
 * must not follow the next address typed, and one without a user name is never
 * asked for. An address that still carries its own password (a system with no
 * key store to keep it in) is used as it is.
 */
export function withProxyPassword(proxy: string, password: string | undefined): string {
  const trimmed = proxy.trim()
  const { scheme, user, password: inline, address } = parseProxy(trimmed)
  if (!user || inline !== undefined || !password) return trimmed
  return `${scheme}${user}:${encodeURIComponent(password)}@${address}`
}
