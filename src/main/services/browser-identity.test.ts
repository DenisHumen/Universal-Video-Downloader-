import { describe, expect, it } from 'vitest'
import {
  browserUserAgent,
  firefoxVersion,
  isGoogleSignIn,
  signInHeaders,
  signInUserAgent
} from './browser-identity'

describe('what the built-in browser says it is', () => {
  it('names the real Chromium version and the real system', () => {
    expect(browserUserAgent('linux', '146.0.7680.31')).toBe(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
    )
    expect(browserUserAgent('darwin', '146.0.1')).toContain('Macintosh; Intel Mac OS X 10_15_7')
    expect(browserUserAgent('win32', undefined)).toContain('Windows NT 10.0; Win64; x64')
  })

  it('knows Google’s sign-in pages, and only over https', () => {
    expect(isGoogleSignIn('https://accounts.google.com/v3/signin/identifier?x=1')).toBe(true)
    expect(isGoogleSignIn('https://accounts.youtube.com/accounts/SetSID')).toBe(true)
    expect(isGoogleSignIn('https://www.google.com/search?q=accounts.google.com')).toBe(false)
    expect(isGoogleSignIn('http://accounts.google.com/')).toBe(false)
    expect(isGoogleSignIn('https://accounts.google.com.evil.tv/')).toBe(false)
    expect(isGoogleSignIn(undefined)).toBe(false)
    expect(isGoogleSignIn('not a url')).toBe(false)
  })

  it('keeps the Firefox version current', () => {
    expect(firefoxVersion(new Date(Date.UTC(2025, 1, 4)))).toBe(135)
    expect(firefoxVersion(new Date(Date.UTC(2025, 2, 4)))).toBe(136)
    expect(firefoxVersion(new Date(Date.UTC(2020, 0, 1)))).toBe(135)
    expect(signInUserAgent('linux', new Date(Date.UTC(2025, 2, 4)))).toBe(
      'Mozilla/5.0 (X11; Linux x86_64; rv:136.0) Gecko/20100101 Firefox/136.0'
    )
  })

  it('sends a sign-in request as Firefox would, with no client hints', () => {
    const out = signInHeaders(
      {
        'User-Agent': 'Chrome',
        'sec-ch-ua': '"Chromium";v="146"',
        'sec-ch-ua-mobile': '?0',
        'Sec-CH-UA-Platform': '"Linux"',
        Cookie: 'a=1',
        'Sec-Fetch-Mode': 'navigate'
      },
      'Firefox'
    )
    expect(out).toEqual({ Cookie: 'a=1', 'Sec-Fetch-Mode': 'navigate', 'User-Agent': 'Firefox' })
  })
})
