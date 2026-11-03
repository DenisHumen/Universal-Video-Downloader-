import { useI18n, useT, type TranslationKey } from '../../i18n'
import { sentenceCase, titleCase } from '../../lib/caps'

/** A row title from a 3.x key, in the language's title case (English header caps, Russian sentence case). */
export function useTitle(): (key: TranslationKey) => string {
  const t = useT()
  const language = useI18n((s) => s.language)
  return (key) => titleCase(t(key), language)
}

/** A subtitle or description in sentence case (keys or already-translated text). */
export function useHint(): (text: string) => string {
  return (text) => sentenceCase(text)
}
