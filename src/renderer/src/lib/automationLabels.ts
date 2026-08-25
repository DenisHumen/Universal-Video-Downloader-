import type { TranslationKey } from '../i18n'
import type { RunState, StepKind } from '@shared/automation'

/**
 * Translation keys for the automation's two small enums.
 *
 * Written out rather than built with a template literal, and not only for
 * neatness: `i18n.test.ts` proves every key is used by searching the source for
 * it as a quoted string, so a key only ever reached through
 * `` t(`auto.step.${kind}`) `` reads as dead and fails the build. Spelling them
 * out is what keeps that check honest.
 */

export const STEP_LABEL: Record<StepKind, TranslationKey> = {
  download: 'auto.step.download',
  rename: 'auto.step.rename',
  upload: 'auto.step.upload',
  notify: 'auto.step.notify'
}

export const RUN_LABEL: Record<RunState, TranslationKey> = {
  running: 'auto.run.running',
  done: 'auto.run.done',
  failed: 'auto.run.failed'
}
