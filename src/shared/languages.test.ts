import { describe, expect, it } from 'vitest'
import { cleanLanguage, cleanLanguages, MAX_SUBTITLE_LANGUAGES } from './languages'

describe('cleanLanguage', () => {
  it('takes the codes sites use', () => {
    for (const code of ['en', 'pt-BR', 'zh-Hans', 'en-orig', 'es-419', 'en_US']) expect(cleanLanguage(code)).toBe(code)
  })

  it('refuses every language, an exclusion, a pattern and an option', () => {
    for (const code of ['all', 'ALL', '-live_chat', 'en.*', 'en,ru', '--exec', '', ' en', 7, undefined]) {
      expect(cleanLanguage(code)).toBeUndefined()
    }
  })
})

describe('cleanLanguages', () => {
  it('drops what is unusable and repeats, within the limit', () => {
    expect(cleanLanguages(['en', 'all', 'en', 'ru'])).toEqual(['en', 'ru'])
    const many = Array.from({ length: 20 }, (_, i) => `l${i}`)
    expect(cleanLanguages(many)).toHaveLength(MAX_SUBTITLE_LANGUAGES)
  })

  it('is nothing at all when nothing is left', () => {
    expect(cleanLanguages(['all'])).toBeUndefined()
    expect(cleanLanguages([])).toBeUndefined()
    expect(cleanLanguages('en')).toBeUndefined()
  })
})
