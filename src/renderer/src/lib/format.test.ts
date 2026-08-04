import { describe, expect, it } from 'vitest'
import { formatBytes, formatCount, formatDuration, formatEta, formatSpeed, isProbablyUrl } from './format'

describe('formatBytes', () => {
  it('shows a dash for missing or nonsensical sizes', () => {
    expect(formatBytes(undefined)).toBe('—')
    expect(formatBytes(0)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
  })

  it('scales through the units', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(20 * 1024 * 1024 * 1024)).toBe('20 GB')
  })
})

describe('formatSpeed', () => {
  it('is empty when there is no speed to show', () => {
    expect(formatSpeed(undefined)).toBe('')
    expect(formatSpeed(0)).toBe('')
  })

  it('appends /s', () => {
    expect(formatSpeed(1536)).toBe('1.5 KB/s')
  })
})

describe('formatDuration', () => {
  it('drops the hour segment for short videos', () => {
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(596)).toBe('9:56')
  })

  it('includes hours when needed', () => {
    expect(formatDuration(3661)).toBe('1:01:01')
  })

  it('is empty for missing values', () => {
    expect(formatDuration(undefined)).toBe('')
    expect(formatDuration(-1)).toBe('')
  })
})

describe('formatEta', () => {
  it('is empty when unknown', () => {
    expect(formatEta(undefined)).toBe('')
    expect(formatEta(0)).toBe('')
  })

  it('uses the coarsest sensible unit', () => {
    expect(formatEta(45)).toBe('45s left')
    expect(formatEta(90)).toBe('1m 30s left')
    expect(formatEta(3700)).toBe('1h 1m left')
  })
})

describe('formatCount', () => {
  it('abbreviates thousands and millions', () => {
    expect(formatCount(999)).toBe('999')
    expect(formatCount(1500)).toBe('1.5K')
    expect(formatCount(1_234_567)).toBe('1.2M')
  })
})

describe('isProbablyUrl', () => {
  it('accepts real links', () => {
    expect(isProbablyUrl('https://youtube.com/watch?v=abc')).toBe(true)
    expect(isProbablyUrl('www.example.com/video')).toBe(true)
    expect(isProbablyUrl('example.com/watch/123')).toBe(true)
  })

  it('rejects plain search text, which routes to search instead', () => {
    expect(isProbablyUrl('big buck bunny')).toBe(false)
    expect(isProbablyUrl('')).toBe(false)
    expect(isProbablyUrl('   ')).toBe(false)
  })
})
