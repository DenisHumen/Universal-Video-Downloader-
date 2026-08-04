import { describe, expect, it } from 'vitest'
import { en } from './en'
import { ru } from './ru'
import { resolveLanguage, translate } from './index'

describe('dictionaries', () => {
  it('translate every English key', () => {
    const missing = Object.keys(en).filter((key) => !(key in ru))
    expect(missing).toEqual([])
  })

  it('carry no empty strings', () => {
    const blank = Object.entries(ru).filter(([, value]) => !value.trim())
    expect(blank).toEqual([])
  })

  it('keep the same placeholders on both sides', () => {
    const placeholders = (s: string): string[] => (s.match(/\{\w+\}/g) ?? []).sort()
    for (const [key, value] of Object.entries(en)) {
      expect(placeholders(ru[key as keyof typeof en]), `placeholders differ for ${key}`).toEqual(
        placeholders(value)
      )
    }
  })
})

describe('resolveLanguage', () => {
  it('honours an explicit choice regardless of the OS locale', () => {
    expect(resolveLanguage('ru', 'en-US')).toBe('ru')
    expect(resolveLanguage('en', 'ru-RU')).toBe('en')
  })

  it('follows the OS locale on auto', () => {
    expect(resolveLanguage('auto', 'ru-RU')).toBe('ru')
    expect(resolveLanguage('auto', 'uk-UA')).toBe('ru')
    expect(resolveLanguage('auto', 'de-DE')).toBe('en')
  })

  it('falls back to English for a missing locale', () => {
    expect(resolveLanguage('auto', '')).toBe('en')
  })
})

describe('translate', () => {
  it('interpolates named parameters', () => {
    expect(translate('en', 'queue.items', { count: 3 })).toContain('3')
    expect(translate('ru', 'queue.items', { count: 3 })).toContain('3')
  })

  it('leaves an unknown placeholder alone instead of printing undefined', () => {
    expect(translate('en', 'update.available', {})).toContain('{version}')
  })
})
