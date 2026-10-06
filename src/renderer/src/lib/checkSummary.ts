import type { CheckSummary } from '@shared/automation'
import type { TranslateFn } from '../i18n'
import type { ToastKind } from './toast'

/**
 * What the "check now" button says when the check comes back.
 *
 * It used to say "checked" whatever had happened - when nothing new turned up,
 * when episodes were found on a paused watch and left there, and when the watch
 * was already busy and nothing had been checked at all. Each of those is now
 * said as itself, with the count where there is one.
 */
export function describeCheck(
  summary: CheckSummary,
  t: TranslateFn,
  date: (at: number) => string
): { text: string; kind: ToastKind } {
  if ('busy' in summary) return { text: t('auto.checkBusy'), kind: 'info' }
  if ('error' in summary) return { text: summary.error, kind: 'error' }
  if ('notOut' in summary) {
    return {
      text: summary.releaseAt
        ? t('auto.checkNotOut', { date: date(summary.releaseAt) })
        : t('auto.releaseUnknown'),
      kind: 'info'
    }
  }
  if (!summary.fresh) return { text: t('auto.checkNothing'), kind: 'info' }
  if (summary.paused) return { text: t('auto.checkPaused', { n: summary.fresh }), kind: 'info' }
  if (summary.queued < summary.fresh) {
    return {
      text: t('auto.checkQueuedSome', { n: summary.queued, fresh: summary.fresh }),
      kind: 'success'
    }
  }
  return {
    text: summary.queued === 1 ? t('auto.checkQueuedOne') : t('auto.checkQueued', { n: summary.queued }),
    kind: 'success'
  }
}
