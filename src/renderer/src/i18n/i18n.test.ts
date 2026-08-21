import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
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
