import { describe, expect, it } from 'vitest'
import { translate } from '../i18n/translate'
import type { TranslateFn } from '../i18n'
import { clipTitle, convertedTitle } from './jobTitle'

const ru: TranslateFn = (key, params) => translate('ru', key, params)
const en: TranslateFn = (key, params) => translate('en', key, params)

describe('clipTitle', () => {
  it('says which part it is', () => {
    expect(clipTitle(ru, 'Фильм', { start: 10, end: 20 })).toBe('Фильм (отрезок 00:10–00:20)')
    expect(clipTitle(en, 'Film', { start: 10, end: 20 })).toBe('Film (clip 00:10–00:20)')
    expect(clipTitle(ru, 'Фильм', { end: 3700 })).toBe('Фильм (отрезок 00:00–1:01:40)')
  })

  it('has no end to name when it runs to the end', () => {
    expect(clipTitle(ru, 'Фильм', { start: 65 })).toBe('Фильм (отрезок с 01:05)')
    expect(clipTitle(en, 'Film', { start: 65 })).toBe('Film (clip from 01:05)')
  })
})

describe('convertedTitle', () => {
  it('says what it became', () => {
    expect(convertedTitle('Фильм', { mode: 'audio', container: 'mp3' })).toBe('Фильм (MP3)')
    expect(convertedTitle('Фильм', { mode: 'video', container: 'mkv', height: 720 })).toBe('Фильм (MKV 720p)')
  })
})
