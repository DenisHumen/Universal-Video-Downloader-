import type { SearchScope } from '@shared/types'
import type { TranslateFn } from '../i18n'

/**
 * What a search service is called on screen.
 *
 * Brand names stay as they are in every language; the two that are words,
 * not brands, are translated, so a Russian window never shows one English
 * label among translated ones.
 */
export function serviceLabel(s: SearchScope, t: TranslateFn): string {
  if (s === 'all') return t('search.allServices')
  if (s === 'yummyani') return t('search.anime')
  return BRAND[s] ?? s
}

const BRAND: Partial<Record<SearchScope, string>> = {
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  dailymotion: 'Dailymotion',
  bilibili: 'Bilibili',
  niconico: 'Niconico',
  pornhub: 'Pornhub'
}
