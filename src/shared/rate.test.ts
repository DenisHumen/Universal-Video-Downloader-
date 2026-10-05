import { describe, expect, it } from 'vitest'
import { normaliseRate } from './rate'

/*
  The field saved whatever was typed, and yt-dlp refuses "2MB", "1,5M" and a
  Cyrillic "2М" with a usage error - so one ordinary entry made every download
  after it fail. Every accepted output here was run past the engine itself.
*/
describe('normaliseRate', () => {
  it('passes the forms the engine already takes', () => {
    expect(normaliseRate('2M')).toBe('2M')
    expect(normaliseRate('500K')).toBe('500K')
    expect(normaliseRate('1.5M')).toBe('1.5M')
    expect(normaliseRate('1G')).toBe('1G')
  })

  it('drops the byte suffix the engine refuses', () => {
    expect(normaliseRate('2MB')).toBe('2M')
    expect(normaliseRate('2MiB')).toBe('2M')
    expect(normaliseRate('2mb/s')).toBe('2M')
  })

  it('reads a decimal comma and a Russian unit', () => {
    expect(normaliseRate('1,5 Мб/с')).toBe('1.5M')
    expect(normaliseRate('1,5M')).toBe('1.5M')
    expect(normaliseRate('300 кб')).toBe('300K')
    expect(normaliseRate('1 ГБ')).toBe('1G')
  })

  it('reads a Cyrillic letter typed on a Russian layout as the Latin one', () => {
    // The two М look identical in the field; only one of them is a unit to yt-dlp.
    expect(normaliseRate('2М')).toBe('2M')
  })

  it('closes up the space between number and unit', () => {
    expect(normaliseRate('500 K')).toBe('500K')
    expect(normaliseRate('  2M  ')).toBe('2M')
  })

  it('treats an empty field as no limit', () => {
    expect(normaliseRate('')).toBe('')
    expect(normaliseRate('   ')).toBe('')
  })

  it('refuses words and junk', () => {
    expect(normaliseRate('fast')).toBeNull()
    expect(normaliseRate('2X')).toBeNull()
    expect(normaliseRate('-2M')).toBeNull()
    expect(normaliseRate('2M2')).toBeNull()
  })

  it('refuses a bare number, which the engine would read as bytes a second', () => {
    // "500" is almost always "500K" with the letter forgotten.
    expect(normaliseRate('500')).toBeNull()
    expect(normaliseRate('500B')).toBeNull()
  })

  it('refuses a megabit figure rather than reading it as megabytes', () => {
    // Off by a factor of eight is worse than a line saying what is expected.
    expect(normaliseRate('20 Мбит/с')).toBeNull()
    expect(normaliseRate('20Mbps')).toBeNull()
  })

  it('refuses a limit the engine would round down to zero', () => {
    // yt-dlp: error: rate limit "0" must be positive
    expect(normaliseRate('0M')).toBeNull()
    expect(normaliseRate('0.0001K')).toBeNull()
    expect(normaliseRate('0.5K')).toBe('0.5K')
  })
})
