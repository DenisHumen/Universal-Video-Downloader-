import { create } from 'zustand'
import type { LanguageId } from '@shared/types'
import { en, type Dictionary, type TranslationKey } from './en'
import { ru } from './ru'

const DICTIONARIES: Record<Exclude<LanguageId, 'auto'>, Dictionary> = { en, ru }

export const LANGUAGES: { id: LanguageId; label: string }[] = [
  { id: 'auto', label: 'auto' },
  { id: 'en', label: 'english' },
  { id: 'ru', label: 'русский' }
]

/** Map an OS locale ('ru-RU', 'uk', …) onto a locale we actually ship. */
export function resolveLanguage(preference: LanguageId, systemLocale: string): 'en' | 'ru' {
  if (preference !== 'auto') return preference
  const base = (systemLocale || 'en').toLowerCase().split(/[-_]/)[0]
  // Russian is the shared reading language across most post-Soviet locales.
  return ['ru', 'be', 'uk', 'kk', 'ky', 'uz', 'tg', 'az', 'hy', 'mo'].includes(base) ? 'ru' : 'en'
}

interface I18nState {
  language: 'en' | 'ru'
  setLanguage: (language: 'en' | 'ru') => void
}

export const useI18n = create<I18nState>((set) => ({
  language: 'en',
  setLanguage: (language) => set({ language })
}))

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

/** Subscribe a component to the active language. */
export function useT(): TranslateFn {
  const language = useI18n((s) => s.language)
  return (key, params) => translate(language, key, params)
}

/** Non-reactive access, for callbacks outside the React tree. */
export function t(key: TranslationKey, params?: TranslateParams): string {
  return translate(useI18n.getState().language, key, params)
}

export type { TranslationKey }
