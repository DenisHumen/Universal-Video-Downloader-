import type { MediaInfo, VideoFormat } from '@shared/types'
import type { TranslateFn } from '../i18n'

/** What the engine adds to a code; neither is a part of a language name the system could look up. */
const ORIGINAL = /-orig$/i
const DESCRIBED = /-desc$/i

const namers = new Map<string, Intl.DisplayNames>()

function plainName(code: string, locale: string, standalone = true): string {
  try {
    let namer = namers.get(locale)
    if (!namer) {
      namer = new Intl.DisplayNames([locale], { type: 'language', fallback: 'code' })
      namers.set(locale, namer)
    }
    const name = namer.of(code.replace('_', '-')) ?? code
    // Russian names start in lower case, which is right inside a sentence and not on their own.
    return standalone ? name.charAt(0).toLocaleUpperCase(locale) + name.slice(1) : name
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

/** The same, for the middle of a sentence: "субтитры скачать не удалось: английский". */
export function languageInSentence(code: string, locale: string, t: TranslateFn): string {
  if (ORIGINAL.test(code)) return t('lang.original', { language: plainName(code.replace(ORIGINAL, ''), locale, false) })
  if (DESCRIBED.test(code)) return t('lang.described', { language: plainName(code.replace(DESCRIBED, ''), locale, false) })
  return plainName(code, locale, false)
}

/** Codes that say the site does not know, or that there are no words. */
const NOT_A_LANGUAGE = /^(und|zxx|mis|mul|unknown|none)$/i

/**
 * The audio languages worth asking about: none unless there are at least two.
 *
 * A format carrying only a language tag and no sound (a silent video stream is
 * tagged on some sites) offers nothing to choose. The site's original track, the
 * one it ranks above the rest or calls so in its note, comes first.
 */
export function audioLanguages(formats: VideoFormat[]): { code: string; original: boolean }[] {
  const found = new Map<string, boolean>()
  for (const f of formats) {
    if (f.kind !== 'audio' && f.kind !== 'video+audio') continue
    if (!f.language || NOT_A_LANGUAGE.test(f.language)) continue
    const original = (f.languagePreference ?? 0) >= 1000 || /\boriginal\b/i.test(f.formatNote ?? '')
    found.set(f.language, (found.get(f.language) ?? false) || original)
  }
  if (found.size < 2) return []
  return [...found]
    .map(([code, original]) => ({ code, original }))
    .sort((a, b) => Number(b.original) - Number(a.original))
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
