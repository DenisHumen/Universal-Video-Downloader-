/**
 * A number of minutes as the unit a person would say it in.
 *
 * "every 1440 min" is true and unreadable; "every day" is what it means. The
 * unit comes back as a name rather than a word, because the word belongs to
 * the dictionary — a queue running in Russian must not say "6 h".
 */
export type SpanUnit = 'min' | 'h' | 'd'

export interface Span {
  n: number
  unit: SpanUnit
}

export function span(minutes: number): Span {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return { n: m, unit: 'min' }
  const h = m / 60
  if (h < 24) return { n: Math.round(h * 10) / 10, unit: 'h' }
  return { n: Math.round((h / 24) * 10) / 10, unit: 'd' }
}
