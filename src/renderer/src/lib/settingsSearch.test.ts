import { describe, expect, it } from 'vitest'
import { fold, matchesQuery } from './settingsSearch'

describe('fold', () => {
  it('ignores case, accents, ё and spacing', () => {
    expect(fold('  Ёмкость  ДИСКА ')).toBe('емкость диска')
    expect(fold('Café')).toBe('cafe')
  })
})

describe('matchesQuery', () => {
  it('finds a row by any of its words, in any order, in label or hint', () => {
    expect(matchesQuery('sub lang', 'subtitle languages', 'comma separated')).toBe(true)
    expect(matchesQuery('separated', 'subtitle languages', 'comma separated')).toBe(true)
    expect(matchesQuery('lang proxy', 'subtitle languages')).toBe(false)
  })

  it('matches Russian labels whatever the ё', () => {
    expect(matchesQuery('еще', 'ещё раз')).toBe(true)
  })

  it('matches everything for an empty query, and copes with a missing hint', () => {
    expect(matchesQuery('', 'anything')).toBe(true)
    expect(matchesQuery('   ', undefined)).toBe(true)
    expect(matchesQuery('theme', 'theme', undefined)).toBe(true)
  })
})
