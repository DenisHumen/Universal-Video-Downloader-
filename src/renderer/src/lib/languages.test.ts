import { describe, expect, it } from 'vitest'
import type { TranslateFn } from '../i18n'
import { languageName, subtitleChoices } from './languages'

const t = ((key: string, params?: { language?: string }) =>
  key === 'lang.original' ? `${params?.language} (original)` : `${params?.language} (described)`) as TranslateFn

describe('languageName', () => {
  it('says a code the way a person would', () => {
    expect(languageName('de', 'en', t)).toBe('German')
    expect(languageName('de', 'ru', t)).toBe('Немецкий')
    expect(languageName('en-orig', 'en', t)).toBe('English (original)')
    expect(languageName('en-desc', 'en', t)).toBe('English (described)')
  })

  it('falls back to the code itself', () => {
    expect(languageName('not a code', 'en', t)).toBe('not a code')
  })
})

describe('subtitleChoices', () => {
  it('offers written tracks by name, and does not list them again as captions', () => {
    const { written, automatic } = subtitleChoices(
      { subtitleLanguages: ['ru', 'de'], autoCaptionLanguages: ['de', 'fr'] },
      'en',
      t
    )
    expect(written.map((x) => x.code)).toEqual(['de', 'ru'])
    expect(automatic.map((x) => x.code)).toEqual(['fr'])
  })

  it('puts what the video speaks and what this person reads ahead of the alphabet', () => {
    const { automatic } = subtitleChoices({ autoCaptionLanguages: ['af', 'ru-RU', 'zu', 'ko-orig', 'de'] }, 'ru', t)
    expect(automatic.slice(0, 2).map((x) => x.code)).toEqual(['ko-orig', 'ru-RU'])
  })

  it('never offers "all", because nothing adds it', () => {
    const { written, automatic } = subtitleChoices({ subtitleLanguages: ['en'], autoCaptionLanguages: ['en', 'ru'] }, 'en', t)
    expect([...written, ...automatic].map((x) => x.code)).not.toContain('all')
  })
})
