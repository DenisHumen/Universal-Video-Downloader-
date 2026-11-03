/**
 * GNOME HIG capitalisation (D7), for strings written in 3.x's lower-case
 * voice that the 4.0 settings now show as titles and subtitles. New strings
 * are written in the right case in the dictionaries; these keep the older
 * ones consistent on screen until the copy pass (5.8) rewrites them.
 */

const SMALL = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'to', 'as', 'at', 'by', 'in', 'of', 'on', 'from', 'with', 'per', 'via'])

/** English header capitalisation: every word but the small ones in the middle; the rest of each word as written. */
export function headerCaps(text: string): string {
  const parts = text.split(/(\s+)/)
  const words = parts.map((p, i) => (/\S/.test(p) ? i : -1)).filter((i) => i >= 0)
  return parts
    .map((p, i) => {
      const n = words.indexOf(i)
      if (n < 0) return p
      if (n > 0 && n < words.length - 1 && SMALL.has(p.toLowerCase())) return p
      return p.charAt(0).toUpperCase() + p.slice(1)
    })
    .join('')
}

/** Sentence case: the first letter, and the first after each full stop, capitalised. */
export function sentenceCase(text: string): string {
  return text.replace(/(^\s*|[.!?]\s+)(\p{Ll})/gu, (_, lead: string, ch: string) => lead + ch.toUpperCase())
}

/** A title in the language's convention: English header caps, Russian (and others) sentence case. */
export function titleCase(text: string, language: string): string {
  return language === 'en' ? headerCaps(text) : sentenceCase(text)
}
