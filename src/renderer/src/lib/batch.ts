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
 * paste of "a b c" is three links, as it always was.
 */
export function parseBatch(text: string): BatchLines {
  const seen = new Set<string>()
  const links: string[] = []
  const invalid: string[] = []
  let duplicates = 0
  for (const token of text.split(/\s+/)) {
    const value = token.trim()
    if (!value) continue
    if (!isProbablyUrl(value)) {
      invalid.push(value)
      continue
    }
    if (seen.has(value)) {
      duplicates++
      continue
    }
    seen.add(value)
    links.push(value)
  }
  return { links, invalid, duplicates }
}

/** Pasted text that holds more than one link: it opens the batch instead of the single-link card. */
export function isMultiLink(text: string): boolean {
  return parseBatch(text).links.length > 1
}
