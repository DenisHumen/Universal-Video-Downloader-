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

/** What `http.ts` rejects with when its own clock runs out before the site answers. */
export const REQUEST_TIMED_OUT = 'Request timed out'

/*
  Codes that mean the host was never reached, as opposed to reached and turned
  away. A certificate error or an HTTP status is deliberately not among them:
  the site is there, and a real browser may still get through where a bare
  request did not.
*/
const NO_ANSWER = /ERR_(CONNECTION_TIMED_OUT|TIMED_OUT)\b/
const NO_ROUTE =
  /ERR_(NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|CONNECTION_REFUSED|ADDRESS_UNREACHABLE|INTERNET_DISCONNECTED|PROXY_CONNECTION_FAILED)\b/

/**
 * Whether a failed request means the host cannot be reached from here at all,
 * and if so, which code says so: `timeout` when nothing answered, `network`
 * when the name, the route or the connection failed outright.
 */
export function unreachableCode(err: unknown): 'network' | 'timeout' | undefined {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  if (raw === REQUEST_TIMED_OUT || NO_ANSWER.test(raw)) return 'timeout'
  if (NO_ROUTE.test(raw)) return 'network'
  return undefined
}
