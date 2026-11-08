import type { MediaInfo } from '@shared/types'
import type { TranslateFn } from '../i18n'

/** What the engine adds to a code; neither is a part of a language name the system could look up. */
const ORIGINAL = /-orig$/i
const DESCRIBED = /-desc$/i

const namers = new Map<string, Intl.DisplayNames>()

function plainName(code: string, locale: string): string {
  try {
    let namer = namers.get(locale)
    if (!namer) {
      namer = new Intl.DisplayNames([locale], { type: 'language', fallback: 'code' })
      namers.set(locale, namer)
    }
    const name = namer.of(code.replace('_', '-')) ?? code
    // Russian names start in lower case, and these stand alone.
    return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1)
  } catch {
    // Not a code the system can read at all. It is still the site's name for the track.
    return code
  }
}

/** A language code as a person would say it: "German", "English (original)". */
export function languageName(code: string, locale: string, t: TranslateFn): string {
  if (ORIGINAL.test(code)) return t('lang.original', { language: plainName(code.replace(ORIGINAL, ''), locale) })
  if (DESCRIBED.test(code)) return t('lang.described', { language: plainName(code.replace(DESCRIBED, ''), locale) })
  return plainName(code, locale)
}

/**
 * What the subtitles row offers: by name, the ones people wrote first.
 *
 * Machine-made captions on YouTube run to every language it can translate to,
 * so the two that are most likely to be wanted go ahead of the alphabet: what
 * the video speaks, then what this person reads. A language with a written
 * track is not listed again, since the engine prefers that one anyway.
 */
export function subtitleChoices(
  info: Pick<MediaInfo, 'subtitleLanguages' | 'autoCaptionLanguages'>,
  locale: string,
  t: TranslateFn
): { written: { code: string; label: string }[]; automatic: { code: string; label: string }[] } {
  const named = (code: string): { code: string; label: string } => ({ code, label: languageName(code, locale, t) })
  const byName = (a: { label: string }, b: { label: string }): number => a.label.localeCompare(b.label, locale)
  const writtenCodes = new Set(info.subtitleLanguages ?? [])
  const reads = (code: string): boolean => code === locale || code.startsWith(`${locale}-`)
  const rank = (code: string): number => (ORIGINAL.test(code) ? 0 : reads(code) ? 1 : 2)
  return {
    written: [...writtenCodes].map(named).sort(byName),
    automatic: (info.autoCaptionLanguages ?? [])
      .filter((code) => !writtenCodes.has(code))
      .map(named)
      .sort((a, b) => rank(a.code) - rank(b.code) || byName(a, b))
  }
}
