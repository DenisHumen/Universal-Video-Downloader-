/**
 * A Chromium network failure as a sentence.
 *
 * Electron's `net` rejects with the bare code - `net::ERR_CONNECTION_REFUSED` -
 * and that reached the screen as-is: no host, no verb, nothing a person could
 * act on. The code is kept at the end, because it is what a search engine or a
 * bug report wants; the sentence in front of it is what the reader wants.
 *
 * The wording is chosen to land on the existing classifier's `network` and
 * `timeout` rules ("connection", "resolve host", "timed out"), so the home and
 * search screens translate it like any other failure instead of quoting it.
 */

const REASONS: [RegExp, string][] = [
  [/CONNECTION_REFUSED/, 'the connection was refused'],
  [/CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_ABORTED/, 'the connection was dropped'],
  [/NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED/, 'could not resolve host'],
  [/INTERNET_DISCONNECTED|NETWORK_CHANGED|ADDRESS_UNREACHABLE/, 'the network is unreachable'],
  [/TIMED_OUT/, 'the connection timed out'],
  [/PROXY_CONNECTION_FAILED|TUNNEL_CONNECTION_FAILED|PROXY_AUTH/, 'the proxy did not let the connection through'],
  [/CERT_|SSL_/, 'the secure connection could not be established']
]

export function describeNetError(err: unknown, url: string): Error {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  const code = raw.match(/net::(ERR_[A-Z_]+)/)?.[1]
  if (!code) return err instanceof Error ? err : new Error(raw)

  let host = url
  try {
    host = new URL(url).host
  } catch {
    /* an internal scheme, or nothing that parses - show what we have */
  }
  const reason = REASONS.find(([re]) => re.test(code))?.[1] ?? 'a network error occurred'
  return new Error(`Could not reach ${host}: ${reason}. Check your connection or proxy. (${code})`)
}
