import { describe, expect, it } from 'vitest'
import { isProxyValue } from './proxy'

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
