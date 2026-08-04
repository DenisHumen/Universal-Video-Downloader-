import { describe, expect, it } from 'vitest'
import { clampTime, parseClock, toClock } from './time'

describe('toClock', () => {
  it('drops the hour for short positions', () => {
    expect(toClock(0)).toBe('0:00')
    expect(toClock(65)).toBe('1:05')
    expect(toClock(599)).toBe('9:59')
  })

  it('adds hours once they exist', () => {
    expect(toClock(3661)).toBe('1:01:01')
    expect(toClock(65, true)).toBe('0:01:05')
  })

  it('never renders a negative position', () => {
    expect(toClock(-5)).toBe('0:00')
  })
})

describe('parseClock', () => {
  it('reads bare seconds', () => {
    expect(parseClock('90')).toBe(90)
    expect(parseClock('0')).toBe(0)
  })

  it('reads mm:ss and hh:mm:ss', () => {
    expect(parseClock('1:30')).toBe(90)
    expect(parseClock('01:02:03')).toBe(3723)
  })

  it('accepts fractions with either separator', () => {
    expect(parseClock('1:30.5')).toBe(90.5)
    expect(parseClock('2,5')).toBe(2.5)
  })

  it('returns undefined for junk, so the field keeps its old value', () => {
    expect(parseClock('')).toBeUndefined()
    expect(parseClock('abc')).toBeUndefined()
    expect(parseClock('1:2:3:4')).toBeUndefined()
    expect(parseClock('-5')).toBeUndefined()
  })
})

describe('clampTime', () => {
  it('keeps the value inside the clip', () => {
    expect(clampTime(-3)).toBe(0)
    expect(clampTime(120, 100)).toBe(100)
    expect(clampTime(42, 100)).toBe(42)
  })

  it('rounds to a tenth of a second', () => {
    expect(clampTime(1.2345)).toBe(1.2)
  })

  it('treats a missing maximum as unbounded', () => {
    expect(clampTime(9999)).toBe(9999)
  })
})
