import { afterEach, describe, expect, it } from 'vitest'
import { useI18n } from '../i18n'
import {
  formatBytes,
  formatCount,
  formatDuration,
  formatEta,
  formatSpeed,
  isProbablyUrl,
  splitPath
} from './format'

afterEach(() => useI18n.setState({ language: 'en' }))

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

  it('keeps four digits whole rather than grouping them', () => {
    expect(formatBytes(1023 * 1024)).toBe('1023 KB')
  })

  // A Russian queue used to show English unit letters and a decimal point.
  it('writes Russian units with a decimal comma', () => {
    expect(formatBytes(512, 'ru')).toBe('512 Б')
    expect(formatBytes(1536, 'ru')).toBe('1,5 КБ')
    expect(formatBytes(1.5 * 1024 * 1024, 'ru')).toBe('1,5 МБ')
    expect(formatBytes(20 * 1024 ** 3, 'ru')).toBe('20 ГБ')
    expect(formatBytes(2 * 1024 ** 4, 'ru')).toBe('2,0 ТБ')
  })

  it('follows the interface language when none is given', () => {
    useI18n.setState({ language: 'ru' })
    expect(formatBytes(1536)).toBe('1,5 КБ')
  })
})

describe('formatSpeed', () => {
  it('is empty when there is no speed to show', () => {
    expect(formatSpeed(undefined)).toBe('')
    expect(formatSpeed(0)).toBe('')
  })

  it('appends per second', () => {
    expect(formatSpeed(1536)).toBe('1.5 KB/s')
    expect(formatSpeed(1536, 'ru')).toBe('1,5 КБ/с')
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

  // "осталось 1m 35s" — where "m" reads as metres.
  it('writes Russian units in Russian', () => {
    expect(formatEta(45, 'ru')).toBe('45 с')
    expect(formatEta(95, 'ru')).toBe('1 мин 35 с')
    expect(formatEta(3700, 'ru')).toBe('1 ч 1 мин')
  })

  it('rounds before splitting, so the seconds never reach sixty', () => {
    expect(formatEta(119.7)).toBe('2m 0s')
    expect(formatEta(59.6)).toBe('1m 0s')
  })
})

describe('formatCount', () => {
  it('abbreviates thousands and millions', () => {
    expect(formatCount(999)).toBe('999')
    expect(formatCount(1500)).toBe('1.5K')
    expect(formatCount(1_234_567)).toBe('1.2M')
  })

  it('goes on to billions instead of a four-digit million', () => {
    expect(formatCount(1_500_000_000)).toBe('1.5B')
  })

  it('abbreviates the way Russian does', () => {
    expect(formatCount(999, 'ru')).toBe('999')
    expect(formatCount(1500, 'ru')).toBe('1,5 тыс.')
    expect(formatCount(1_234_567, 'ru')).toBe('1,2 млн')
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
