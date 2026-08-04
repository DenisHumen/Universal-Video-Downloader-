import { describe, expect, it } from 'vitest'
import { isNewerVersion, parseVersion } from './version'

describe('parseVersion', () => {
  it('strips a leading v and splits on dots', () => {
    expect(parseVersion('v1.9.0')).toEqual([1, 9, 0])
    expect(parseVersion('2.0.10')).toEqual([2, 0, 10])
  })

  it('treats non-numeric parts as 0 rather than NaN', () => {
    expect(parseVersion('1.9.0-beta.2')).toEqual([1, 9, 0, 0, 2])
  })
})

describe('isNewerVersion', () => {
  it('compares numerically, not lexicographically', () => {
    expect(isNewerVersion('1.10.0', '1.9.0')).toBe(true)
    expect(isNewerVersion('1.9.0', '1.10.0')).toBe(false)
  })

  it('handles the v prefix on either side', () => {
    expect(isNewerVersion('v1.9.1', '1.9.0')).toBe(true)
    expect(isNewerVersion('1.9.0', 'v1.9.0')).toBe(false)
  })

  it('is false for equal versions, so we never offer a pointless update', () => {
    expect(isNewerVersion('1.9.0', '1.9.0')).toBe(false)
  })

  it('handles different segment counts', () => {
    expect(isNewerVersion('2', '1.9.9')).toBe(true)
    expect(isNewerVersion('1.9', '1.9.0')).toBe(false)
  })
})
