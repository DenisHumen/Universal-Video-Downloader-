/**
 * A link sent to the app from outside: `uvd://open?url=<encoded http(s) link>`.
 *
 * Any web page can fire this, with whatever it likes after the scheme, as often
 * as it likes, so everything here assumes the sender is hostile. The answer is
 * a plain web address or nothing. Other query parameters are not read at all:
 * there is deliberately no way to say "and download it", or to name a folder.
 *
 * `uvd-kodik://` and its kind are queue addresses the resolvers read, and
 * `file:` is what the hidden browser would happily open; neither may arrive
 * this way, and being http or https after decoding is what keeps them out.
 */

/** What the clipboard watcher accepts too (clipboard.ts): nobody's video page is longer. */
export const MAX_LINK_LENGTH = 2048
/** Room for the same link with every character percent-encoded, looked at before anything parses it. */
const MAX_SENT_LENGTH = MAX_LINK_LENGTH * 3 + 64

/*
  Control and formatting characters, spaces, backslashes, and what a broken
  escape decodes to. `new URL` quietly drops tabs and newlines and turns `\` into
  `/`, so what it parsed and what somebody reads on screen could differ; the
  formatting ones include the marks that show text right to left.
*/
const UNSAFE_CHARACTER = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\s\\�]/u

const WEB_LINK = /^https?:\/\//i
const SENT_LINK = /^uvd:/i

/** Whether a launch argument is a `uvd:` link, good or bad. */
export const isSentLink = (arg: string): boolean => SENT_LINK.test(arg)

/**
 * A web address fit to put on screen, in the form the browser would read it, or
 * null. That form spells a look-alike host in punycode. A user name in front of
 * the host is refused: `https://bank.example@another.example/` exists to mislead.
 */
export function safeWebLink(candidate: string): string | null {
  if (candidate.length > MAX_LINK_LENGTH || UNSAFE_CHARACTER.test(candidate) || !WEB_LINK.test(candidate)) return null
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }
  if (!url.hostname || url.username || url.password) return null
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
}

/** The web address a `uvd://open?url=…` link carries, or null for anything else. */
export function linkFromSentUrl(sent: string): string | null {
  if (sent.length > MAX_SENT_LENGTH || UNSAFE_CHARACTER.test(sent)) return null
  let url: URL
  try {
    url = new URL(sent)
  } catch {
    return null
  }
  // The host of a scheme the URL standard does not know keeps its case.
  if (url.protocol !== 'uvd:' || url.hostname.toLowerCase() !== 'open' || url.port) return null
  if (url.username || url.password || (url.pathname !== '' && url.pathname !== '/')) return null
  // Two answers to one question is somebody hoping that two readers disagree.
  const carried = url.searchParams.getAll('url')
  return carried.length === 1 ? safeWebLink(carried[0]) : null
}

/**
 * The link on a command line, whether a first launch's or a second's.
 *
 * `refused` says an argument was trying to be a link and none was any good, so
 * a second launch can stay quiet: a rejected link must not even raise the window.
 * One bad `uvd:` link spoils the lot, since what stands beside it is whatever
 * it managed to smuggle onto the command line.
 */
export function linkFromArgv(argv: readonly string[]): { link?: string; refused: boolean } {
  if (argv.some((arg) => isSentLink(arg) && !linkFromSentUrl(arg))) return { refused: true }
  let refused = false
  for (const arg of argv) {
    const sent = isSentLink(arg)
    if (!sent && !WEB_LINK.test(arg)) continue
    const link = sent ? linkFromSentUrl(arg) : safeWebLink(arg)
    if (link) return { link, refused: false }
    refused = true
  }
  return { refused }
}

/**
 * A bookmark that does what the extension's button does, for a browser without
 * it. The page's own address is the only thing it reads.
 */
export const BOOKMARKLET = "javascript:void(location.href='uvd://open?url='+encodeURIComponent(location.href))"
