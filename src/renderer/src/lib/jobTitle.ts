import type { ConvertTarget, TrimRange } from '@shared/types'
import type { TranslateFn } from '../i18n'
import { formatDuration } from './format'

/*
  What a clip or a conversion is called in the queue and the Library. They kept
  their source's title, so a film and three cuts of it were four rows of one name,
  told apart only by a line of small print that the Library does not have.
*/

const moment = (seconds: number): string => formatDuration(seconds).padStart(5, '0')

export function clipTitle(t: TranslateFn, title: string, range: TrimRange): string {
  const start = moment(range.start ?? 0)
  return range.end == null
    ? t('job.clipTitleOpen', { title, start })
    : t('job.clipTitle', { title, range: `${start}–${moment(range.end)}` })
}

/** No words in it, so one form for every language. */
export function convertedTitle(title: string, target: ConvertTarget): string {
  const height = target.height ? ` ${target.height}p` : ''
  return `${title} (${target.container.toUpperCase()}${height})`
}
