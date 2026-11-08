import type { AppErrorCode } from '@shared/types'
import {
  translate,
  translatePlural,
  type TranslateFn,
  type TranslatePluralFn
} from '../../renderer/src/i18n/translate'
import { engineMissingText } from '../../renderer/src/lib/engineError'
import { localizeMainText } from '../../renderer/src/lib/mainText'
import type { MainLanguage } from './locale'

/**
 * The interface's dictionaries, for what main says to a person with no window
 * in front of them: a Telegram message, the `uvd` command.
 *
 * The same files the renderer reads rather than a second set, because a failure
 * has to read the same on a phone and on the screen, and the sentences for every
 * failure code are already there. Which language is the caller's to say, so all
 * of this runs without Electron or the settings; `currentLanguage` in `locale.ts`
 * is how the app answers that.
 */

export interface Words {
  t: TranslateFn
  tp: TranslatePluralFn
}

export function wordsIn(language: MainLanguage): Words {
  return {
    t: (key, params) => translate(language, key, params),
    tp: (key, count, params) => translatePlural(language, key, count, params)
  }
}

/**
 * Why something failed, in a language: the translated sentence where the failure
 * has a code, one of main's fixed sentences where it does not, and anything else
 * as it was written, since a file name or the engine's own words have no other.
 */
export function reasonIn(language: MainLanguage, why: string, code?: AppErrorCode): string {
  const { t } = wordsIn(language)
  if (code === 'engineMissing') return engineMissingText(t, why)
  // Every code has its sentence at this key: `errors.ts` maps them one to one, and this does not compile otherwise.
  if (code) return t(`err.${code}` as const)
  return localizeMainText(t, why)
}

/** A figure with `digits` decimals, separated the way the language writes them: 1.25, 1,25. */
export function decimalIn(language: MainLanguage, value: number, digits: number): string {
  return new Intl.NumberFormat(language, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false
  }).format(value)
}
