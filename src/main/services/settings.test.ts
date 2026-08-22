import { describe, expect, it } from 'vitest'
import { isSafeTemplate, migrate } from './settings'

/*
  `migrate` runs on the first launch after every update, for every existing
  user, and its caller swallows anything it throws by resetting the whole
  configuration to defaults. It had no tests.
*/

describe('migrate', () => {
  it('maps a palette that no longer exists onto the nearest survivor', () => {
    // Somebody who chose `daylight` wants a light window, not a reset.
    expect(migrate({ theme: 'daylight' }).theme).toBe('day')
    expect(migrate({ theme: 'midnight' }).theme).toBe('night')
    expect(migrate({ theme: 'carbon' }).theme).toBe('night')
    expect(migrate({ theme: 'nebula' }).theme).toBe('night')
  })

  it('leaves a palette that still exists alone', () => {
    expect(migrate({ theme: 'day' }).theme).toBe('day')
    expect(migrate({ theme: 'night' }).theme).toBe('night')
  })

  it('falls back to night for a theme nobody has ever heard of', () => {
    expect(migrate({ theme: 'chartreuse' }).theme).toBe('night')
  })

  it('drops the accent that the redesign removed', () => {
    expect('accent' in migrate({ accent: 'violet' })).toBe(false)
  })

  it('clamps the numbers a hand-edited file could put out of range', () => {
    expect(migrate({ concurrentDownloads: 99 }).concurrentDownloads).toBe(8)
    expect(migrate({ concurrentDownloads: 0 }).concurrentDownloads).toBe(1)
    expect(migrate({ concurrentDownloads: 2.6 }).concurrentDownloads).toBe(3)
    expect(migrate({ playlistLimit: 99999 }).playlistLimit).toBe(5000)
    expect(migrate({ playlistLimit: 1 }).playlistLimit).toBe(10)
  })

  it('passes everything else through untouched', () => {
    const raw = { downloadDir: 'D:\\Videos', proxy: 'http://p:8080', cookiesFile: 'c.txt' }
    expect(migrate(raw)).toMatchObject(raw)
  })

  it('replaces a filename template that would write outside the folder', () => {
    expect(migrate({ filenameTemplate: '../../evil.%(ext)s' }).filenameTemplate).toBe(
      '%(title)s [%(id)s].%(ext)s'
    )
  })
})

describe('isSafeTemplate', () => {
  it('accepts the shapes people actually use', () => {
    expect(isSafeTemplate('%(title)s [%(id)s].%(ext)s')).toBe(true)
    // Per-uploader subfolders are a real thing, and stay inside the folder.
    expect(isSafeTemplate('%(uploader)s/%(title)s.%(ext)s')).toBe(true)
    expect(isSafeTemplate('')).toBe(true)
  })

  it('refuses to climb out of the download folder', () => {
    expect(isSafeTemplate('../%(title)s.%(ext)s')).toBe(false)
    expect(isSafeTemplate('a/../../b/%(title)s.%(ext)s')).toBe(false)
    expect(isSafeTemplate('a\\..\\..\\b.%(ext)s')).toBe(false)
  })

  it('refuses an absolute path, which would discard the folder entirely', () => {
    expect(isSafeTemplate('C:\\Windows\\System32\\%(title)s.%(ext)s')).toBe(false)
    expect(isSafeTemplate('/etc/cron.d/%(title)s')).toBe(false)
    expect(isSafeTemplate('\\\\server\\share\\%(title)s.%(ext)s')).toBe(false)
  })

  it('is not fooled by a name that merely contains two dots', () => {
    expect(isSafeTemplate('%(title)s..%(ext)s')).toBe(true)
    expect(isSafeTemplate('season..2/%(title)s.%(ext)s')).toBe(true)
  })
})
