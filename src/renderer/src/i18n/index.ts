import { create } from 'zustand'
import type { LanguageId } from '@shared/types'
import {
  translate,
  translatePlural,
  type PluralKey,
  type TranslateFn,
  type TranslateParams,
  type TranslatePluralFn,
  type TranslationKey
} from './translate'

export {
  PLURAL_FORMS,
  resolveLanguage,
  translate,
  translatePlural,
  type Language,
  type PluralKey,
  type TranslateFn,
  type TranslateParams,
  type TranslatePluralFn,
  type TranslationKey
} from './translate'

export const LANGUAGES: { id: LanguageId; label: string }[] = [
  { id: 'auto', label: 'auto' },
  { id: 'en', label: 'english' },
  { id: 'ru', label: 'русский' }
]

interface I18nState {
  language: 'en' | 'ru'
  setLanguage: (language: 'en' | 'ru') => void
}

export const useI18n = create<I18nState>((set) => ({
  language: 'en',
  setLanguage: (language) => set({ language })
}))

/** Subscribe a component to the active language. */
export function useT(): TranslateFn {
  const language = useI18n((s) => s.language)
  return (key, params) => translate(language, key, params)
}

/** Non-reactive access, for callbacks outside the React tree. */
export function t(key: TranslationKey, params?: TranslateParams): string {
  return translate(useI18n.getState().language, key, params)
}

/** The plural counterpart of useT. */
export function useTp(): TranslatePluralFn {
  const language = useI18n((s) => s.language)
  return (key, count, params) => translatePlural(language, key, count, params)
}

/** Non-reactive plural access, for callbacks outside the React tree. */
export function tp(key: PluralKey, count: number, params?: TranslateParams): string {
  return translatePlural(useI18n.getState().language, key, count, params)
}
