import { describe, expect, it } from 'vitest'
import {
  KEEP_SESSION_COOKIE_S,
  loginOrigin,
  netscapeCount,
  persistentCopy,
  saveKind,
  toNetscape,
  withLogin
} from './browser-logins-rules'

describe('staying signed in', () => {
  it('gives a session cookie a month, keeping it host-only when it was', () => {
    const now = 1_700_000_000
    expect(
      persistentCopy(
        { name: 'sid', value: 'x', domain: 'example.com', hostOnly: true, path: '/', secure: true, session: true },
        now
      )
    ).toEqual({
      url: 'https://example.com/',
      name: 'sid',
      value: 'x',
      path: '/',
      secure: true,
      httpOnly: undefined,
      sameSite: undefined,
      expirationDate: now + KEEP_SESSION_COOKIE_S
    })
    const wide = persistentCopy({ name: 'a', value: '1', domain: '.example.com', session: true }, now)
    expect(wide).toMatchObject({ url: 'http://example.com/', domain: '.example.com' })
  })

  it('leaves alone a cookie that already outlives a restart', () => {
    expect(
      persistentCopy({ name: 'a', value: '1', domain: 'x.com', session: false, expirationDate: 5 }, 0)
    ).toBeUndefined()
  })
})

describe('the jar the engine reads', () => {
  it('writes the Netscape format, HttpOnly and subdomain flags included', () => {
    const text = toNetscape([
      { name: 'sid', value: 'v', domain: '.site.tv', path: '/', secure: true, httpOnly: true, expirationDate: 2e9 },
      { name: 'pref', value: 'p', domain: 'site.tv', hostOnly: true, path: '/', session: true }
    ])
    const lines = text.trim().split('\n')
    expect(lines[0]).toBe('# Netscape HTTP Cookie File')
    expect(lines).toContain('#HttpOnly_.site.tv\tTRUE\t/\tTRUE\t2000000000\tsid\tv')
    expect(lines).toContain('site.tv\tFALSE\t/\tFALSE\t0\tpref\tp')
    expect(netscapeCount(text)).toBe(2)
  })

  it('keeps YouTube cookies out unless someone is signed in to Google', () => {
    const visit = [
      { name: 'CONSENT', value: 'y', domain: '.youtube.com' },
      { name: 'sid', value: 'v', domain: '.site.tv' }
    ]
    expect(toNetscape(visit)).not.toContain('youtube.com')
    const signedIn = [...visit, { name: '__Secure-3PSID', value: 's', domain: '.youtube.com' }]
    expect(toNetscape(signedIn)).toContain('CONSENT')
  })

  it('counts nothing in an empty jar', () => {
    expect(netscapeCount(toNetscape([]))).toBe(0)
  })
})

describe('saved passwords', () => {
  it('keeps them for https pages and this machine only', () => {
    expect(loginOrigin('https://site.tv/login?x=1')).toBe('https://site.tv')
    expect(loginOrigin('http://localhost:3000/a')).toBe('http://localhost:3000')
    expect(loginOrigin('http://site.tv/login')).toBeUndefined()
    expect(loginOrigin('about:blank')).toBeUndefined()
  })

  it('tells a new login from a changed password from the same one', () => {
    const saved = [{ username: 'ann', password: '1' }]
    expect(saveKind(saved, { username: 'ann', password: '1' })).toBe('same')
    expect(saveKind(saved, { username: 'ann', password: '2' })).toBe('update')
    expect(saveKind(saved, { username: 'bob', password: '1' })).toBe('new')
    expect(withLogin(saved, { username: 'ann', password: '2' })).toEqual([{ username: 'ann', password: '2' }])
    expect(withLogin(saved, { username: 'bob', password: '3' })[0].username).toBe('bob')
  })
})
