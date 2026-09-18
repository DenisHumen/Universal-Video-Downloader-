import { daysUntil } from '@shared/automation'
import type { TranslateFn } from '../i18n'
import { span, type SpanUnit } from './span'

// Literals, so the dictionary check can see that these keys are used.
const UNIT: Record<SpanUnit, 'time.min' | 'time.h' | 'time.d'> = {
  min: 'time.min',
  h: 'time.h',
  d: 'time.d'
}

/**
 * How long until something that is not out yet, as a person would say it.
 *
 * Whole days while it is days away — "out in 36 d", never "36.4" — and hours
 * only once the last day has begun, which is the only time anyone counts them.
 * A date that has passed with nothing to show for it is not an error and not a
 * negative number: announcements slip, so it reads as "any day now".
 */
export function releaseText(releaseAt: number | undefined, t: TranslateFn, now = Date.now()): string {
  if (!releaseAt) return t('auto.releaseUnknown')
  const left = releaseAt - now
  if (left <= 0) return t('auto.releaseAny')
  if (left > 86_400_000) {
    return t('auto.releaseIn', { span: `${daysUntil(releaseAt, now)} ${t('time.d')}` })
  }
  const { n, unit } = span(left / 60_000)
  return t('auto.releaseIn', { span: `${n} ${t(UNIT[unit])}` })
}

/** The date itself, in the reader's own format. */
export function releaseDate(releaseAt: number, locale?: string): string {
  return new Date(releaseAt).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })
}
