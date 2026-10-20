/**
 * Text folded for a forgiving match: case, accents and Russian ё don't count.
 * "Ёмкость" is found by typing "емкость", which is how most people type it.
 */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Whether a settings row answers the query: every word of it appears somewhere
 * in the row's label or hint, in any order. "sub lang" finds "subtitle
 * languages"; an empty query matches everything.
 */
export function matchesQuery(query: string, ...texts: (string | undefined)[]): boolean {
  const words = fold(query).split(' ').filter(Boolean)
  if (!words.length) return true
  const haystack = fold(texts.filter(Boolean).join(' '))
  return words.every((word) => haystack.includes(word))
}
