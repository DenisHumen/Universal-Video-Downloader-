/**
 * Whether a value can be used as the proxy setting.
 *
 * Shared, because the settings screen has to know before it saves. The field
 * used to save on every keystroke, and every save reconfigured the app's own
 * network: typing `http://127.0.0.1:8080` pointed every request in flight at
 * `h`, then `ht`, then `http`, and so on to the end.
 *
 * Deliberately loose. The same string goes to yt-dlp as `--proxy` and to
 * Chromium, and refusing something either of them takes would be worse than
 * letting a typo through, so all this asks for is the shape of a proxy
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
