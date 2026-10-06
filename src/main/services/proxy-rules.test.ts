import { describe, expect, it } from 'vitest'
import {
  chromiumProxy,
  createProxyLogin,
  proxyCredentials,
  tookRules,
  type ProxyCredentials
} from './proxy-rules'

/*
  An authenticated proxy (`http://user:pass@host`) and a `socks5h://` one, both
  fine for yt-dlp, were handed to Chromium as typed. It accepted the call and
  then failed every request the app made itself - pages, thumbnails, update
  checks, Telegram - with ERR_NO_SUPPORTED_PROXIES, while downloads worked.
*/
describe('chromiumProxy', () => {
  it.each([
    ['', { rules: '' }],
    ['http://192.168.1.10:8080', { rules: 'http://192.168.1.10:8080' }],
    // Credentials are answered on a 407, never put in the rules.
    ['http://user:pass@192.168.1.10:8080', { rules: 'http://192.168.1.10:8080' }],
    ['http://user@192.168.1.10:8080', { rules: 'http://192.168.1.10:8080' }],
    ['https://proxy.example.com:443/', { rules: 'https://proxy.example.com:443' }],
    // Chromium's SOCKS5 already resolves names at the proxy.
    ['socks5h://192.168.1.10:1080', { rules: 'socks5://192.168.1.10:1080' }],
    ['SOCKS5H://192.168.1.10:1080', { rules: 'socks5://192.168.1.10:1080' }],
    ['socks5://192.168.1.10:1080', { rules: 'socks5://192.168.1.10:1080' }],
    ['socks4a://192.168.1.10:1080', { rules: 'socks4://192.168.1.10:1080', caveat: 'socks4a' }],
    // A bare host:port is an HTTP proxy to Chromium as well.
    ['192.168.1.10:8080', { rules: '192.168.1.10:8080' }],
    ['user@192.168.1.10:8080', { rules: '192.168.1.10:8080' }],
    ['[::1]:8080', { rules: '[::1]:8080' }]
  ])('%s', (proxy, expected) => {
    expect(chromiumProxy(proxy)).toEqual(expected)
  })

  it('keeps the system network for a SOCKS proxy that needs a password', () => {
    // Chromium cannot sign in to SOCKS; stripping the password only changes the error.
    const system = { rules: '', caveat: 'socksAuth' }
    expect(chromiumProxy('socks5://user:pass@192.168.1.10:1080')).toEqual(system)
    expect(chromiumProxy('socks5h://user@192.168.1.10:1080')).toEqual(system)
  })
})

describe('tookRules', () => {
  it('reads an empty answer or DIRECT as rules Chromium could not use', () => {
    expect(tookRules('http://192.168.1.10:8080', 'PROXY 192.168.1.10:8080')).toBe(true)
    expect(tookRules('socks5://192.168.1.10:1080', 'SOCKS5 192.168.1.10:1080')).toBe(true)
    expect(tookRules('http://192.168.1.10:8080', '')).toBe(false)
    expect(tookRules('http://192.168.1.10:8080', 'DIRECT')).toBe(false)
  })

  it('has nothing to check for the system network', () => {
    expect(tookRules('', 'DIRECT')).toBe(true)
  })
})

describe('proxyCredentials', () => {
  it('pairs the user in the address with the stored password', () => {
    expect(proxyCredentials('http://user@192.168.1.10:8080', 'p@ss')).toEqual({
      host: '192.168.1.10',
      port: 8080,
      username: 'user',
      password: 'p@ss'
    })
  })

  it('decodes what the address percent-encodes', () => {
    const credentials = proxyCredentials('http://me%40corp:p%3Ass@proxy.example.com:3128', undefined)
    expect(credentials).toMatchObject({ username: 'me@corp', password: 'p:ss' })
  })

  it('fills in the port Chromium would use', () => {
    expect(proxyCredentials('http://user@proxy.example.com', 'x')?.port).toBe(80)
    expect(proxyCredentials('https://user@proxy.example.com', 'x')?.port).toBe(443)
    expect(proxyCredentials('user@proxy.example.com', 'x')?.port).toBe(80)
  })

  it('takes an IPv6 host without its brackets, as a challenge reports it', () => {
    expect(proxyCredentials('http://user@[2001:db8::1]:3128', 'x')).toMatchObject({
      host: '2001:db8::1',
      port: 3128
    })
  })

  it('has nothing to answer without a user, or for SOCKS', () => {
    expect(proxyCredentials('http://192.168.1.10:8080', 'x')).toBeUndefined()
    expect(proxyCredentials('socks5://user@192.168.1.10:1080', 'x')).toBeUndefined()
    expect(proxyCredentials('', 'x')).toBeUndefined()
  })
})

describe('createProxyLogin', () => {
  const credentials: ProxyCredentials = {
    host: '192.168.1.10',
    port: 8080,
    username: 'user',
    password: 'p@ss'
  }
  const challenge = { isProxy: true, host: '192.168.1.10', port: 8080 }

  const answer = { kind: 'answer', username: 'user', password: 'p@ss' }

  it('answers once, then gives up', () => {
    // A wrong password is challenged again; answering every time loops for ever.
    const decide = createProxyLogin(() => credentials)
    expect(decide(challenge)).toEqual(answer)
    expect(decide(challenge)).toEqual({ kind: 'refused' })
  })

  it('keeps count per request when one answerer serves many', () => {
    const decide = createProxyLogin(() => credentials)
    expect(decide(challenge, '1 https://a.example/')).toEqual(answer)
    expect(decide(challenge, '2 https://a.example/')).toEqual(answer)
    expect(decide(challenge, '1 https://a.example/')).toEqual({ kind: 'refused' })
    // Forgotten after the refusal, so loading the page again gets one more try.
    expect(decide(challenge, '1 https://a.example/')).toEqual(answer)
  })

  it('does not hand the password to a site or to a proxy the user did not set', () => {
    const decide = createProxyLogin(() => credentials)
    expect(decide({ ...challenge, isProxy: false })).toEqual({ kind: 'site' })
    expect(decide({ ...challenge, host: '192.168.1.11' })).toEqual({ kind: 'unknown' })
    expect(decide({ ...challenge, port: 3128 })).toEqual({ kind: 'unknown' })
  })

  it('matches the host without regard to case or brackets', () => {
    const decide = createProxyLogin(() => ({ ...credentials, host: 'proxy.example.com' }))
    expect(decide({ ...challenge, host: 'Proxy.Example.com' })).toEqual(answer)
  })

  it('has nothing to answer when no proxy with a user is configured', () => {
    expect(createProxyLogin(() => undefined)(challenge)).toEqual({ kind: 'unknown' })
  })

  it('reads the credentials at each challenge, so a new password applies at once', () => {
    let password = 'old'
    const decide = createProxyLogin(() => ({ ...credentials, password }))
    password = 'new'
    expect(decide(challenge)).toMatchObject({ password: 'new' })
  })
})
