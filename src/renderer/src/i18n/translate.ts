import type { LanguageId } from '@shared/types'
import { en, type Dictionary, type TranslationKey } from './en'
import { ru } from './ru'

/*
  The dictionaries and nothing that needs a window: the main process reads them
  too, for what it says outside one - a Telegram message, the `uvd` command - and
  has no use for the store and hooks in `index.ts`, or for React behind them.
*/

/** A language the interface is actually written in, as opposed to a preference. */
export type Language = Exclude<LanguageId, 'auto'>

const DICTIONARIES: Record<Language, Dictionary> = { en, ru }

/** Map an OS locale ('ru-RU', 'uk', …) onto a locale we actually ship. */
export function resolveLanguage(preference: LanguageId, systemLocale: string): 'en' | 'ru' {
  if (preference !== 'auto') return preference
  const base = (systemLocale || 'en').toLowerCase().split(/[-_]/)[0]
  // Russian is the shared reading language across most post-Soviet locales.
  return ['ru', 'be', 'uk', 'kk', 'ky', 'uz', 'tg', 'az', 'hy', 'mo'].includes(base) ? 'ru' : 'en'
}

export type TranslateParams = Record<string, string | number>

function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match
  )
}

export function translate(
  language: 'en' | 'ru',
  key: TranslationKey,
  params?: TranslateParams
): string {
  const dict = DICTIONARIES[language] ?? en
  return interpolate(dict[key] ?? en[key] ?? key, params)
}

export type TranslateFn = (key: TranslationKey, params?: TranslateParams) => string

/**
 * The keys whose English value lists plural forms, '|'-separated.
 *
 * Worked out from the dictionary itself, so a string becomes a plural key by
 * being written as one, and tp() refuses any other key at compile time.
 */
export type PluralKey = {
  [K in TranslationKey]: (typeof en)[K] extends `${string}|${string}` ? K : never
}[TranslationKey]

/*
  Which form sits where in a plural key, per language.

  Counts used to dodge grammar: English said "1 videos", and Russian avoided
  the question with a colon — "серий: 5" — which reads like a database dump.
  Intl.PluralRules names the category a number falls in; this is the order a
  translator writes the forms in. English has two; Russian has the three
  anyone writes (одна серия, две серии, пять серий).
*/
export const PLURAL_FORMS: Record<Language, Intl.LDMLPluralRule[]> = {
  en: ['one', 'other'],
  ru: ['one', 'few', 'many']
}

/*
  Russian's fourth category, 'other', is the fractional one, and a fraction
  takes the same form as two to four — "1,5 серии" — so it borrows that slot
  rather than needing a form of its own.
*/
const PLURAL_ALIASES: Partial<Record<Language, Partial<Record<Intl.LDMLPluralRule, Intl.LDMLPluralRule>>>> = {
  ru: { other: 'few' }
}

const pluralRules = new Map<Language, Intl.PluralRules>()
const counts = new Map<Language, Intl.NumberFormat>()

function cached<T>(cache: Map<Language, T>, language: Language, make: () => T): T {
  let value = cache.get(language)
  if (value === undefined) {
    value = make()
    cache.set(language, value)
  }
  return value
}

function pluralIndex(language: Language, count: number): number {
  const category = cached(pluralRules, language, () => new Intl.PluralRules(language)).select(count)
  return PLURAL_FORMS[language].indexOf(PLURAL_ALIASES[language]?.[category] ?? category)
}

/**
 * A counted string in the right grammatical form: "1 episode", "5 episodes",
 * "21 серия", "22 серии". The number is `{count}` in the template, written
 * the way the language writes numbers ("1,000" / "1 000").
 *
 * A form the translator left out falls back to the last one written, which
 * is the general plural in both languages and still reads as a sentence.
 */
export function translatePlural(
  language: Language,
  key: PluralKey,
  count: number,
  params?: TranslateParams
): string {
  const dict = DICTIONARIES[language] ?? en
  const forms = (dict[key] ?? en[key]).split('|')
  const form = forms[pluralIndex(language, count)] ?? forms[forms.length - 1]
  const number = cached(counts, language, () => new Intl.NumberFormat(language)).format(count)
  return interpolate(form, { count: number, ...params })
}

export type TranslatePluralFn = (key: PluralKey, count: number, params?: TranslateParams) => string

export type { TranslationKey }
