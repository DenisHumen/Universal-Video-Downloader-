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

const CHECK_CONNECTION = 'Check your connection or proxy.'
/*
  A failure the proxy caused points at the proxy setting rather than at "your
  connection": the network is usually fine, and the address in Settings is the
  one thing the reader can change.
*/
const CHECK_PROXY = 'Check the proxy in Settings → Network.'

const REASONS: [RegExp, string, string?][] = [
  [
    /NO_SUPPORTED_PROXIES/,
    'the proxy address is not in a form the app can use for its own requests',
    CHECK_PROXY
  ],
  [/SOCKS_CONNECTION_FAILED/, 'the SOCKS proxy did not let the connection through', CHECK_PROXY],
  [/CONNECTION_REFUSED/, 'the connection was refused'],
  [/CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_ABORTED/, 'the connection was dropped'],
  [/NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED/, 'could not resolve host'],
  [/INTERNET_DISCONNECTED|NETWORK_CHANGED|ADDRESS_UNREACHABLE/, 'the network is unreachable'],
  [/TIMED_OUT/, 'the connection timed out'],
  [
    /PROXY_CONNECTION_FAILED|TUNNEL_CONNECTION_FAILED|PROXY_AUTH/,
    'the proxy did not let the connection through',
    CHECK_PROXY
  ],
  [/CERT_|SSL_/, 'the secure connection could not be established']
]

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    // An internal scheme, or nothing that parses - show what we have.
    return url
  }
}

export function describeNetError(err: unknown, url: string): Error {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  const code = raw.match(/net::(ERR_[A-Z_]+)/)?.[1]
  if (!code) return err instanceof Error ? err : new Error(raw)

  const match = REASONS.find(([re]) => re.test(code))
  const reason = match?.[1] ?? 'a network error occurred'
  const advice = match?.[2] ?? CHECK_CONNECTION
  return new Error(`Could not reach ${hostOf(url)}: ${reason}. ${advice} (${code})`)
}

/**
 * A 407: the proxy asked for credentials and did not take the ones it got -
 * or, `missing`, asked for some the app does not hold for it.
 *
 * It arrives as a response or an abandoned request rather than a network
 * error, so it used to read "HTTP 407", or nothing at all.
 */
export function describeProxyRefusal(url: string, missing = false): Error {
  const reason = missing
    ? 'the proxy asks for a user name and password'
    : 'the proxy did not accept the user name and password'
  return new Error(`Could not reach ${hostOf(url)}: ${reason}. ${CHECK_PROXY} (HTTP 407)`)
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
