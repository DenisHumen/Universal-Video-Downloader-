import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatCount,
  formatDuration,
  formatEta,
  formatSpeed,
  isProbablyUrl,
  splitPath
} from './format'

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

  // The word "left" belongs to the caller, which is the side that knows which
  // language the interface is running in.
  it('uses the coarsest sensible unit, and no words', () => {
    expect(formatEta(45)).toBe('45s')
    expect(formatEta(90)).toBe('1m 30s')
    expect(formatEta(3700)).toBe('1h 1m')
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

/*
  A finished row truncated its path from the end, so a long title pushed the
  file name off and left only the folders - the half nobody was looking for.
*/
describe('splitPath', () => {
  it('splits a Windows path at its last backslash', () => {
    expect(splitPath('C:\\Users\\demo\\Downloads\\youtube\\Some Long Title [abc123].mp4')).toEqual({
      dir: 'C:\\Users\\demo\\Downloads\\youtube\\',
      base: 'Some Long Title [abc123].mp4'
    })
  })

  it('splits a POSIX path, and a Windows path that mixes both separators', () => {
    expect(splitPath('/home/demo/Videos/clip.mkv')).toEqual({ dir: '/home/demo/Videos/', base: 'clip.mkv' })
    expect(splitPath('C:\\Users\\demo/Downloads/clip.mp4')).toEqual({
      dir: 'C:\\Users\\demo/Downloads/',
      base: 'clip.mp4'
    })
  })

  it('puts back together into exactly the path it was given', () => {
    for (const path of ['C:\\a\\b.mp4', '/a/b.mp4', 'b.mp4', '', '\\\\192.168.1.10\\media\\b.mp4']) {
      const { dir, base } = splitPath(path)
      expect(dir + base).toBe(path)
    }
  })

  it('treats a bare file name as all name', () => {
    expect(splitPath('clip.mp4')).toEqual({ dir: '', base: 'clip.mp4' })
  })
})
