import { describe, expect, it } from 'vitest'
import { engineIsOlder, siteMayHaveChanged } from './engine-version'

describe('whether the engine is older than the latest', () => {
  it.each([
    ['2026.01.01', '2026.03.17', true],
    ['2026.03.17', '2026.03.17', false],
    ['2026.03.18', '2026.03.17', false],
    ['2026.3.9', '2026.3.10', true],
    ['2026.03.17', '2026.03.17.232', true],
    ['2026.03.17.232', '2026.03.17', false],
    ['2025.12.31', '2026.01.01', true]
  ])('%s against %s: %s', (current, latest, older) => {
    expect(engineIsOlder(current, latest)).toBe(older)
  })

  it.each([
    [undefined, '2026.03.17'],
    ['2026.03.17', undefined],
    ['mock', '2026.03.17'],
    ['2026.03.17', 'nightly']
  ])('says no when it cannot tell: %s against %s', (current, latest) => {
    expect(engineIsOlder(current, latest)).toBe(false)
  })
})

describe('whether a failure looks like a site having changed', () => {
  it('goes by the code when there is one', () => {
    expect(siteMayHaveChanged('noFormats')).toBe(true)
    expect(siteMayHaveChanged('playerChanged')).toBe(true)
  })

  it('a code about anything else is not it, whatever the words', () => {
    for (const code of ['network', 'signIn', 'botCheck', 'diskFull', 'geo', 'rateLimited'] as const) {
      expect(siteMayHaveChanged(code, 'Traceback (most recent call last)')).toBe(false)
    }
  })

  it('reads an unclassified failure for the signs of a stack', () => {
    expect(siteMayHaveChanged(undefined, 'Traceback (most recent call last):\n  File "x"')).toBe(true)
    expect(siteMayHaveChanged(undefined, 'ERROR: [site] x: please report this issue on github')).toBe(true)
    expect(siteMayHaveChanged(undefined, "KeyError: 'formats'")).toBe(true)
  })

  it('leaves the rest alone', () => {
    expect(siteMayHaveChanged(undefined, 'Something else went wrong')).toBe(false)
    expect(siteMayHaveChanged(undefined)).toBe(false)
  })
})
