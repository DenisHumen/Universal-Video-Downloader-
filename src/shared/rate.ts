/** Кб, Мб and Гб are the Russian spellings of the same three units. */
const UNITS: Record<string, 'K' | 'M' | 'G'> = {
  K: 'K',
  M: 'M',
  G: 'G',
  К: 'K',
  М: 'M',
  Г: 'G'
}

const POWER = { K: 1, M: 2, G: 3 } as const

/**
 * A speed limit as people write it, in the form the engine will accept.
 *
 * yt-dlp reads `--limit-rate` as a number and one bare letter - `2M`, `500K`,
 * `1.5M` - and refuses everything else with a usage error that ends the run
 * before it starts. The field's own hint says "2M or 500K", and what people
 * typed instead was "2MB", "1,5M", or "2 Мб", which is how the same thing is
 * written in Russian. Each of those was saved as it was, and from then on every
 * download failed with an untranslated line about an "invalid rate limit" that
 * never pointed back at this setting.
 *
 * So the unit is read the way it is meant: a decimal comma, a K, M or G in
 * either alphabet, an optional byte suffix (B, iB, Б) and an optional "/s".
 *
 * A bare number is refused rather than passed on. The engine would take "500"
 * as five hundred bytes a second - a limit nobody sets on purpose, and one that
 * looks exactly like "I meant 500K and forgot the letter". A limit that comes
 * to less than a byte is refused too: the engine rounds it to zero and stops
 * with "rate limit must be positive", and an empty field already means no
 * limit at all.
 *
 * Returns '' for an empty field, the normalised rate for one the engine will
 * take, and null for anything else.
 */
export function normaliseRate(raw: string): string | null {
  const value = raw.trim()
  if (!value) return ''
  const match = value.match(/^(\d+(?:[.,]\d+)?)\s*([KMGkmgКМГкмг])(?:i?[BbБб])?(?:\/[SsСс])?$/)
  if (!match) return null
  const num = match[1].replace(',', '.')
  const unit = UNITS[match[2].toUpperCase()]
  if (!unit || Number(num) * 1024 ** POWER[unit] < 1) return null
  return `${num}${unit}`
}
