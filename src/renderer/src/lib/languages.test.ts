import { describe, expect, it } from 'vitest'
import type { VideoFormat } from '@shared/types'
import type { TranslateFn } from '../i18n'
import { audioLanguages, languageName, subtitleChoices } from './languages'

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

describe('audioLanguages', () => {
  const f = (over: object): VideoFormat => ({ id: 'x', ext: 'm4a', kind: 'audio', resolution: 'audio', ...over })

  it('offers nothing unless there is a real choice', () => {
    expect(audioLanguages([])).toEqual([])
    expect(audioLanguages([f({ language: 'en' }), f({ language: 'en' })])).toEqual([])
    expect(audioLanguages([f({ language: 'en' }), f({ language: 'und' })])).toEqual([])
    // A silent video stream's tag is not a track.
    expect(audioLanguages([f({ language: 'en' }), f({ kind: 'video', language: 'de' })])).toEqual([])
  })

  it('counts combined formats, once per language, with the original first', () => {
    expect(
      audioLanguages([
        f({ language: 'de' }),
        f({ kind: 'video+audio', language: 'fr' }),
        f({ language: 'en', languagePreference: 10000 }),
        f({ language: 'de' })
      ])
    ).toEqual([
      { code: 'en', original: true },
      { code: 'de', original: false },
      { code: 'fr', original: false }
    ])
    expect(audioLanguages([f({ language: 'ja', formatNote: 'Japanese original, medium' }), f({ language: 'en' })])[0]).toEqual({
      code: 'ja',
      original: true
    })
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
