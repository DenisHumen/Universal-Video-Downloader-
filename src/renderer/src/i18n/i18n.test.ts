import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { en } from './en'
import { ru } from './ru'
import { PLURAL_FORMS, resolveLanguage, translate, translatePlural, type PluralKey } from './index'

const pluralKeys = (Object.keys(en) as (keyof typeof en)[]).filter((key) =>
  en[key].includes('|')
) as PluralKey[]

describe('dictionaries', () => {
  it('translate every English key', () => {
    const missing = Object.keys(en).filter((key) => !(key in ru))
    expect(missing).toEqual([])
  })

  it('carry no empty strings', () => {
    const blank = Object.entries(ru).filter(([, value]) => !value.trim())
    expect(blank).toEqual([])
  })

  // Compared as sets: a plural key repeats {count} once per form, and English
  // writes two forms where Russian writes three.
  it('keep the same placeholders on both sides', () => {
    const placeholders = (s: string): string[] => [...new Set(s.match(/\{\w+\}/g) ?? [])].sort()
    for (const [key, value] of Object.entries(en)) {
      expect(placeholders(ru[key as keyof typeof en]), `placeholders differ for ${key}`).toEqual(
        placeholders(value)
      )
    }
  })

  /*
    Hyphens stood in for dashes and three dots for an ellipsis in a handful of
    strings written later than the rest. The one exception is a literal file
    name, which really is "01 - title".
  */
  it('use real dashes and ellipses', () => {
    const literal = new Set(['playlist.numberingHint'])
    for (const dict of [en, ru] as Record<string, string>[]) {
      const slips = Object.entries(dict).filter(
        ([key, value]) => !literal.has(key) && (value.includes(' - ') || value.includes('...'))
      )
      expect(slips).toEqual([])
    }
  })
})

/*
  Counted strings list their forms '|'-separated. A form count that doesn't
  match the language's order would quietly pick the wrong form, and a '|' in an
  ordinary string would be printed as it is.
*/
describe('plural keys', () => {
  it('exist, so this suite tests something', () => {
    expect(pluralKeys.length).toBeGreaterThan(0)
  })

  it('write as many forms as their language has', () => {
    for (const key of pluralKeys) {
      expect(en[key].split('|'), `forms in en for ${key}`).toHaveLength(PLURAL_FORMS.en.length)
      expect(ru[key].split('|'), `forms in ru for ${key}`).toHaveLength(PLURAL_FORMS.ru.length)
    }
  })

  it('are the only strings with a "|" in them', () => {
    const plural = new Set<string>(pluralKeys)
    const stray = Object.entries(ru).filter(([key, value]) => !plural.has(key) && value.includes('|'))
    expect(stray).toEqual([])
  })

  it('pick the Russian form by the last digits, the way Russian counts', () => {
    const forms = [1, 3, 5, 11, 21, 22, 111, 0].map((n) => translatePlural('ru', 'auto.nEpisodes', n))
    expect(forms).toEqual([
      '1 серия',
      '3 серии',
      '5 серий',
      '11 серий',
      '21 серия',
      '22 серии',
      '111 серий',
      '0 серий'
    ])
  })

  it('agree the verb with the count where Russian needs it', () => {
    expect(translatePlural('ru', 'auto.dubCount', 1)).toBe('доступна 1 озвучка')
    expect(translatePlural('ru', 'auto.dubCount', 4)).toBe('доступны 4 озвучки')
    expect(translatePlural('ru', 'auto.dubCount', 12)).toBe('доступно 12 озвучек')
  })

  it('use the singular only for exactly one in English', () => {
    expect(translatePlural('en', 'auto.nEpisodes', 1)).toBe('1 episode')
    expect(translatePlural('en', 'auto.nEpisodes', 0)).toBe('0 episodes')
    expect(translatePlural('en', 'auto.nEpisodes', 21)).toBe('21 episodes')
    expect(translatePlural('en', 'queue.items', 1)).toBe('1 item')
  })

  it('give a fraction the form Russian gives it', () => {
    expect(translatePlural('ru', 'auto.nEpisodes', 1.5)).toBe('1,5 серии')
  })

  it('write the count the way the language writes numbers', () => {
    expect(translatePlural('en', 'playlist.videos', 1200)).toBe('1,200 videos')
    expect(translatePlural('ru', 'playlist.videos', 1200)).toBe('1 200 видео')
  })
})

/**
 * Every key in the dictionary is referenced somewhere.
 *
 * Nine of them weren't: labels for buttons that had been redesigned away,
 * messages for a flow that no longer exists. Dead strings are worse than dead
 * code, because a translator keeps faithfully translating them — so this fails
 * the build instead of letting them pile up again. Keys are always written as
 * literals at the call site (including inside the lookup tables that map a
 * state or a stage to one), which is what makes a plain text search sound.
 */
describe('dictionary coverage', () => {
  const sourceFiles = (dir: string): string[] => {
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) {
        if (entry !== 'i18n' && entry !== 'node_modules') out.push(...sourceFiles(path))
      } else if (/[.]tsx?$/.test(entry) && !/[.]test[.]/.test(entry)) {
        out.push(path)
      }
    }
    return out
  }

  it('has no key nothing uses', () => {
    const source = sourceFiles('src')
      .map((f) => readFileSync(f, 'utf-8'))
      .join('\n')
    const unused = Object.keys(en).filter((key) => !source.includes(`'${key}'`))
    expect(unused).toEqual([])
  })

  // t() on a plural key prints every form at once — "1 episode|1 episodes".
  it('reads plural keys only through tp()', () => {
    const source = sourceFiles('src')
      .map((f) => readFileSync(f, 'utf-8'))
      .join('\n')
    const misread = pluralKeys.filter((key) => {
      const uses = source.split(`'${key}'`).slice(0, -1)
      return uses.some((before) => !/\btp\(\s*$/.test(before))
    })
    expect(misread).toEqual([])
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
    expect(translate('en', 'playlist.downloadAll', { count: 3 })).toContain('3')
    expect(translate('ru', 'playlist.downloadAll', { count: 3 })).toContain('3')
  })

  it('leaves an unknown placeholder alone instead of printing undefined', () => {
    expect(translate('en', 'update.available', {})).toContain('{version}')
  })
})
