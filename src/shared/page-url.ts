/*
  The app's internal links, as far as anyone but the resolvers needs to read them.
  In shared, and with no Buffer, because the Library's site names are worked out
  on both sides of the bridge.
*/

export const SNIFF_SCHEME = 'uvd-sniff://'
export const DIRECT_SCHEME = 'uvd-direct://'

function fromBase64Url(text: string): string {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
}

/**
 * The page a queued link stands for. A sniff or a browser pick is queued under
 * an app-internal scheme whose host means nothing; the page it came from is
 * inside. Empty when there is nothing that reads.
 */
export function pageUrlOf(src: string): string {
  try {
    if (src.startsWith(SNIFF_SCHEME)) return fromBase64Url(src.slice(SNIFF_SCHEME.length))
    if (src.startsWith(DIRECT_SCHEME)) {
      const payload = JSON.parse(fromBase64Url(src.slice(DIRECT_SCHEME.length))) as {
        pageUrl?: string
        referer?: string
        url?: string
      } | null
      return payload?.pageUrl || payload?.referer || payload?.url || ''
    }
  } catch {
    return ''
  }
  return src
}
