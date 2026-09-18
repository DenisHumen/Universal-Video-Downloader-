import { describe, expect, it } from 'vitest'
import { translate } from '../i18n'
import type { TranslateFn } from '../i18n'
import { releaseText } from './release'

const DAY = 86_400_000
const NOW = 1_800_000_000_000
const en: TranslateFn = (key, vars) => translate('en', key, vars)
const ru: TranslateFn = (key, vars) => translate('ru', key, vars)

describe('releaseText', () => {
  it('counts whole days while it is days away', () => {
    expect(releaseText(NOW + 36 * DAY, en, NOW)).toBe('out in 36 d')
    expect(releaseText(NOW + 35.2 * DAY, en, NOW)).toBe('out in 36 d')
  })

  it('switches to hours once the last day has begun', () => {
    expect(releaseText(NOW + DAY / 4, en, NOW)).toBe('out in 6 h')
  })

  it('says "any day now" for a date that passed, never a negative number', () => {
    expect(releaseText(NOW - 3 * DAY, en, NOW)).toBe('expected any day now')
  })

  it('admits it when the site gives no date', () => {
    expect(releaseText(undefined, en, NOW)).toBe('not out yet')
  })

  it('speaks the language of the interface, units included', () => {
    expect(releaseText(NOW + 36 * DAY, ru, NOW)).toBe('выйдет через 36 д')
  })
})
