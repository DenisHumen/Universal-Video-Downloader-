import { isProbablyUrl } from './format'

export interface BatchLines {
  /** Every distinct link, in the order pasted. */
  links: string[]
  /** Lines that are not links (shown, never queued). */
  invalid: string[]
  /** Links pasted more than once, counted beyond their first time. */
  duplicates: number
}

/**
 * The inline batch (5.4): one link per line, validated line by line, with
 * repeats dropped. Whitespace inside a line separates links too, so a
 * paste of "a b c" is three links, as it always was - and words next to a link
 * are not held against it. A line with no link is one line, however many words
 * it has: "3 lines are not links" for one sentence was simply not so.
 */
export function parseBatch(text: string): BatchLines {
  const seen = new Set<string>()
  const links: string[] = []
  const invalid: string[] = []
  let duplicates = 0
  for (const line of text.split(/\r?\n/)) {
    const tokens = line.trim().split(/\s+/).filter(Boolean)
    const found = tokens.filter((token) => isProbablyUrl(token))
    if (tokens.length && !found.length) invalid.push(line.trim())
    for (const value of found) {
      if (seen.has(value)) {
        duplicates++
        continue
      }
      seen.add(value)
      links.push(value)
    }
  }
  return { links, invalid, duplicates }
}

/** Pasted text that holds more than one link: it opens the batch instead of the single-link card. */
export function isMultiLink(text: string): boolean {
  return parseBatch(text).links.length > 1
}
