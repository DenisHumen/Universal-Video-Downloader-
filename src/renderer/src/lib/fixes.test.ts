import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppErrorCode } from '@shared/types'
import { en } from '../i18n/en'
import { ru } from '../i18n/ru'
import { cancelRetry, FIX_LABEL, fixFor, retryAt, RETRY_LATER_MS, scheduleRetry } from './fixes'

describe('fix buttons (6.2): the error code decides the fix', () => {
  const cases: [AppErrorCode, ReturnType<typeof fixFor>][] = [
    ['signIn', 'cookies'],
    ['ageRestricted', 'cookies'],
    ['forbidden', 'browser'],
    ['geo', 'browser'],
    ['unsupportedPlayer', 'browser'],
    ['emptyPage', 'browser'],
    ['noFormats', 'audioOnly'],
    ['diskFull', 'changeFolder'],
    ['permission', 'changeFolder'],
    ['rateLimited', 'retryLater'],
    ['network', null],
    ['timeout', null],
    ['drm', null]
  ]
  it.each(cases)('%s → %s', (code, fix) => {
    expect(fixFor(code)).toBe(fix)
  })

  it('offers cookies for an access gate that came with no code (members only)', () => {
    expect(fixFor(undefined, true)).toBe('cookies')
    expect(fixFor(undefined, false)).toBeNull()
    // A code's own fix wins over the hint.
    expect(fixFor('diskFull', true)).toBe('changeFolder')
  })

  it('labels every fix in both languages, in header caps in English, with an ellipsis where it asks for more', () => {
    for (const key of Object.values(FIX_LABEL)) {
      expect(en[key]).toBeTruthy()
      expect(ru[key]).toBeTruthy()
    }
    expect(en['fix.cookies']).toBe('Use Cookies From…')
    expect(en['fix.browser']).toBe('Open in Built-in Browser')
    expect(en['fix.audioOnly']).toBe('Audio Only')
    expect(en['fix.changeFolder']).toBe('Change Folder')
    expect(en['fix.retryLater']).toBe('Retry in 5 Min')
  })

  it('keeps the report consent wording, verbatim, in both languages', () => {
    expect(en['fix.reportConsent']).toContain('othing is sent without your click')
    expect(ru['fix.reportConsent']).toContain('ез вашего нажатия ничего не отправляется')
  })
})

describe('Retry in 5 Min', () => {
  afterEach(() => vi.useRealTimers())

  it('retries once after five minutes, and a second click does not stack', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const at = scheduleRetry('row', run, RETRY_LATER_MS, 1000)
    expect(at).toBe(1000 + RETRY_LATER_MS)
    expect(scheduleRetry('row', run, RETRY_LATER_MS, 2000)).toBe(at)
    vi.advanceTimersByTime(RETRY_LATER_MS - 1)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(1)
    expect(retryAt('row')).toBeUndefined()
  })

  it('can be called off', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    scheduleRetry('other', run)
    cancelRetry('other')
    vi.advanceTimersByTime(RETRY_LATER_MS)
    expect(run).not.toHaveBeenCalled()
  })
})
