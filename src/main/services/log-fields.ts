import type { DownloadItem } from '@shared/types'

/**
 * What the log file may say about a download.
 *
 * Picked here, once, rather than at each call site, because the item is full
 * of things that must never reach a file people attach to bug reports: the
 * Cookie and Authorization headers captured off a signed-in site, a resolved
 * CDN address whose query string is its signature, the local path of a file
 * being trimmed. The redactor in `@shared/redact` catches the shapes it knows,
 * and it is a denylist; the safer rule is not to hand it those values at all.
 *
 * The site's host is what tells one site's failures from another's, and that
 * is all the address contributes. A resolver's internal scheme gives only its
 * name — `uvd-yummy://` carries an encoded player address where a host would
 * be, which reads as noise and is nobody's business.
 */
export function downloadFields(
  item: Pick<DownloadItem, 'id' | 'kind' | 'url' | 'sourceUrl' | 'extractor'>
): Record<string, string | undefined> {
  const local = item.kind === 'trim' || item.kind === 'convert'
  return {
    id: item.id.slice(0, 8),
    kind: local ? item.kind : undefined,
    host: local ? undefined : siteOf(item.sourceUrl || item.url),
    extractor: item.extractor
  }
}

/** The host of a web address, or the name of an internal scheme. Never the rest. */
export function siteOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.hostname || undefined
    return parsed.protocol.replace(/:$/, '') || undefined
  } catch {
    return undefined
  }
}
