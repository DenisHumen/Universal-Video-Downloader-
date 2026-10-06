import { describe, expect, it } from 'vitest'
import { isProxyValue, parseProxy, proxyUser, splitProxyPassword, withProxyPassword } from './proxy'

/*
  The proxy field saved every keystroke, and every save repointed the app's own
  requests - at `h`, then `ht`, then `http`. It now commits on blur or Enter,
  and only a value with the shape of a proxy address. Refusing a form yt-dlp
  takes would be worse than the original bug, so most of these are about what
  must be let through.
*/

describe('isProxyValue', () => {
  it('takes an empty value, which means the system network', () => {
    expect(isProxyValue('')).toBe(true)
    expect(isProxyValue('   ')).toBe(true)
  })

  it('takes the forms yt-dlp and Chromium accept', () => {
    expect(isProxyValue('http://192.168.1.10:8080')).toBe(true)
    expect(isProxyValue('https://proxy.example.com:443/')).toBe(true)
    expect(isProxyValue('socks5://192.168.1.10:1080')).toBe(true)
    expect(isProxyValue('socks5h://192.168.1.10:1080')).toBe(true)
    expect(isProxyValue(' http://192.168.1.10:8080 ')).toBe(true)
  })

  it('takes a bare host, with or without a port', () => {
    expect(isProxyValue('192.168.1.10:8080')).toBe(true)
    expect(isProxyValue('localhost:3128')).toBe(true)
    expect(isProxyValue('proxy.example.com')).toBe(true)
  })

  it('takes credentials', () => {
    expect(isProxyValue('http://user:pass@192.168.1.10:8080')).toBe(true)
    expect(isProxyValue('user:p%40ss@proxy.example.com:3128')).toBe(true)
  })

  it('takes an IPv6 address in brackets', () => {
    expect(isProxyValue('[::1]:8080')).toBe(true)
    expect(isProxyValue('http://[2001:db8::1]:3128')).toBe(true)
    expect(isProxyValue('socks5://[::ffff:192.168.1.10]')).toBe(true)
  })

  it('refuses a half-typed or mistyped address', () => {
    expect(isProxyValue('http://')).toBe(false)
    expect(isProxyValue('http://:8080')).toBe(false)
    expect(isProxyValue('192.168.1.10:')).toBe(false)
    expect(isProxyValue('192.168.1.10:80a')).toBe(false)
    expect(isProxyValue('proxy example.com')).toBe(false)
    expect(isProxyValue('http://192.168.1.10:8080/path')).toBe(false)
  })

  it('refuses a port outside the range', () => {
    expect(isProxyValue('192.168.1.10:0')).toBe(false)
    expect(isProxyValue('192.168.1.10:65536')).toBe(false)
    expect(isProxyValue('192.168.1.10:65535')).toBe(true)
  })

  it('refuses a Chromium rule list, which yt-dlp cannot use', () => {
    expect(isProxyValue('http=192.168.1.10:8080;https=192.168.1.10:8080')).toBe(false)
  })
})

/*
  A password typed into the address went to settings.json and onto every
  engine command line. It is lifted out and put back only in memory, and the
  rest of the address must come back exactly as typed.
*/
describe('parseProxy', () => {
  it('takes an address apart without changing any of it', () => {
    expect(parseProxy('http://user:p%40ss@Proxy.Example.com:3128/')).toEqual({
      scheme: 'http://',
      user: 'user',
      password: 'p%40ss',
      address: 'Proxy.Example.com:3128/'
    })
    expect(parseProxy('192.168.1.10:8080')).toEqual({ scheme: '', address: '192.168.1.10:8080' })
  })

  it('reads a bare user@host as credentials, not as a scheme', () => {
    expect(parseProxy('user:pass@proxy.example.com:3128')).toMatchObject({
      scheme: '',
      user: 'user',
      password: 'pass'
    })
  })

  it('ends the credentials at the last @, as URL parsers do', () => {
    expect(parseProxy('http://user:p@ss@192.168.1.10:8080')).toMatchObject({
      password: 'p@ss',
      address: '192.168.1.10:8080'
    })
  })
})

describe('splitProxyPassword', () => {
  it('lifts the password out, decoded, and keeps the user', () => {
    expect(splitProxyPassword('http://user:p%40ss@host:8080')).toEqual({
      proxy: 'http://user@host:8080',
      password: 'p@ss'
    })
  })

  it('drops the user too when there was only a password', () => {
    expect(splitProxyPassword('http://:secret@192.168.1.10:8080')).toEqual({
      proxy: 'http://192.168.1.10:8080',
      password: 'secret'
    })
  })

  it('leaves an address without a password alone', () => {
    expect(splitProxyPassword('socks5h://user@192.168.1.10:1080')).toEqual({
      proxy: 'socks5h://user@192.168.1.10:1080'
    })
    expect(splitProxyPassword('')).toEqual({ proxy: '' })
  })

  it('keeps a password that is not valid percent-encoding as it was typed', () => {
    expect(splitProxyPassword('http://user:100%@192.168.1.10:8080').password).toBe('100%')
  })
})

describe('withProxyPassword', () => {
  it('puts the password back, encoded, after the user', () => {
    expect(withProxyPassword('http://user@192.168.1.10:8080', 'p@ss:w/rd+')).toBe(
      'http://user:p%40ss%3Aw%2Frd%2B@192.168.1.10:8080'
    )
  })

  it('round-trips what splitProxyPassword took out', () => {
    const typed = 'socks5h://me:p%40ss%20word@192.168.1.10:1080'
    const { proxy, password } = splitProxyPassword(typed)
    expect(withProxyPassword(proxy, password)).toBe(typed)
  })

  it('adds nothing to an address without a user', () => {
    // A password left over from another proxy must not follow the next address.
    expect(withProxyPassword('http://192.168.1.10:8080', 'p@ss')).toBe('http://192.168.1.10:8080')
  })

  it('uses an address that still carries its own password as it is', () => {
    expect(withProxyPassword('http://user:inline@192.168.1.10:8080', 'stored')).toBe(
      'http://user:inline@192.168.1.10:8080'
    )
  })

  it('leaves the address alone when no password is stored', () => {
    expect(withProxyPassword('http://user@192.168.1.10:8080', undefined)).toBe(
      'http://user@192.168.1.10:8080'
    )
  })
})

describe('proxyUser', () => {
  it('names the user, decoded, or nothing', () => {
    expect(proxyUser('http://me%40corp@192.168.1.10:8080')).toBe('me@corp')
    expect(proxyUser('http://192.168.1.10:8080')).toBeUndefined()
    expect(proxyUser('http://:secret@192.168.1.10:8080')).toBeUndefined()
  })
})
