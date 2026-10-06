import { describe, expect, it } from 'vitest'
import { describeNetError, describeProxyRefusal, REQUEST_TIMED_OUT, unreachableCode } from './neterror'
import { classifyYtdlpError } from '../services/options'

/*
  A toast once read `net::ERR_CONNECTION_REFUSED` and nothing else: no host, no
  verb, nothing to act on. The site was reachable a minute later.
*/
describe('describeNetError', () => {
  const url = 'https://old.yummyani.me/catalog/item/x'

  it('turns the bare code into a sentence that names the host', () => {
    const out = describeNetError(new Error('net::ERR_CONNECTION_REFUSED'), url)
    expect(out.message).toBe(
      'Could not reach old.yummyani.me: the connection was refused. Check your connection or proxy. (ERR_CONNECTION_REFUSED)'
    )
  })

  it('says what kind of failure it was', () => {
    expect(describeNetError(new Error('net::ERR_NAME_NOT_RESOLVED'), url).message).toContain(
      'could not resolve host'
    )
    expect(describeNetError(new Error('net::ERR_PROXY_CONNECTION_FAILED'), url).message).toContain(
      'proxy'
    )
    expect(describeNetError(new Error('net::ERR_CONNECTION_TIMED_OUT'), url).message).toContain(
      'timed out'
    )
  })

  it('lands on the classifier rules, so the home screen translates it', () => {
    const network = /connection|network|resolve host|unreachable/
    const timeout = /timed out|timeout/
    expect(describeNetError(new Error('net::ERR_CONNECTION_REFUSED'), url).message).toMatch(network)
    expect(describeNetError(new Error('net::ERR_INTERNET_DISCONNECTED'), url).message).toMatch(
      network
    )
    expect(describeNetError(new Error('net::ERR_CONNECTION_TIMED_OUT'), url).message).toMatch(timeout)
  })

  it('leaves errors that are not network codes exactly as they were', () => {
    const other = new Error('HTTP 404')
    expect(describeNetError(other, url)).toBe(other)
  })

  it('copes with an unparseable address', () => {
    expect(describeNetError(new Error('net::ERR_FAILED'), 'not a url').message).toContain(
      'Could not reach not a url'
    )
  })
})

/*
  A host blocked from this network took about two minutes to report: after the
  engine gave up, the hidden browser loaded the same address over the same
  network and waited out its whole timeout to fail the same way.
*/
describe('unreachableCode', () => {
  const url = 'https://ok.ru/video/1234567'
  const described = (code: string): Error => describeNetError(new Error(`net::${code}`), url)

  it('knows a host that could not be reached at all', () => {
    for (const code of [
      'ERR_NAME_NOT_RESOLVED',
      'ERR_NAME_RESOLUTION_FAILED',
      'ERR_CONNECTION_REFUSED',
      'ERR_ADDRESS_UNREACHABLE',
      'ERR_INTERNET_DISCONNECTED',
      'ERR_PROXY_CONNECTION_FAILED'
    ]) {
      expect(unreachableCode(described(code)), code).toBe('network')
    }
  })

  it('calls a host that never answered a timeout', () => {
    expect(unreachableCode(described('ERR_CONNECTION_TIMED_OUT'))).toBe('timeout')
    expect(unreachableCode(described('ERR_TIMED_OUT'))).toBe('timeout')
    expect(unreachableCode(new Error(REQUEST_TIMED_OUT))).toBe('timeout')
  })

  it('leaves a site that answered alone, even with a refusal', () => {
    // The site is there; a real browser may still get past a bad certificate
    // chain or a 403 that a bare request could not.
    expect(unreachableCode(described('ERR_CERT_AUTHORITY_INVALID'))).toBeUndefined()
    expect(unreachableCode(described('ERR_SSL_PROTOCOL_ERROR'))).toBeUndefined()
    expect(unreachableCode(new Error('HTTP 403'))).toBeUndefined()
    expect(unreachableCode(new Error('HTTP 503'))).toBeUndefined()
    expect(unreachableCode(undefined)).toBeUndefined()
  })
})

/*
  An authenticated or socks5h proxy failed every one of the app's own requests
  with ERR_NO_SUPPORTED_PROXIES, which fell through to "a network error
  occurred" and "check your connection" - on a connection that was fine.
*/
describe('describeNetError for the proxy setting', () => {
  const url = 'https://api.telegram.org/bot/sendMessage'

  it('points an unusable proxy address at the setting', () => {
    const out = describeNetError(new Error('net::ERR_NO_SUPPORTED_PROXIES'), url).message
    expect(out).toBe(
      'Could not reach api.telegram.org: the proxy address is not in a form the app can use for its own requests. Check the proxy in Settings → Network. (ERR_NO_SUPPORTED_PROXIES)'
    )
    expect(classifyYtdlpError(out, true).code).toBe('network')
  })

  it('says a SOCKS proxy turned the connection away', () => {
    const out = describeNetError(new Error('net::ERR_SOCKS_CONNECTION_FAILED'), url).message
    expect(out).toContain('the SOCKS proxy did not let the connection through')
    expect(out).toContain('Settings → Network')
    expect(classifyYtdlpError(out, true).code).toBe('network')
  })

  it('points the other proxy failures at the setting too', () => {
    expect(describeNetError(new Error('net::ERR_PROXY_CONNECTION_FAILED'), url).message).toContain(
      'Check the proxy in Settings → Network.'
    )
  })
})

describe('describeProxyRefusal', () => {
  it('turns a 407 into a sentence the home screen translates as a network failure', () => {
    const out = describeProxyRefusal('https://old.yummyani.me/catalog').message
    expect(out).toBe(
      'Could not reach old.yummyani.me: the proxy did not accept the user name and password. Check the proxy in Settings → Network. (HTTP 407)'
    )
    expect(classifyYtdlpError(out, true).code).toBe('network')
  })

  it('says so when the proxy wants credentials the app does not hold', () => {
    const out = describeProxyRefusal('https://old.yummyani.me/catalog', true).message
    expect(out).toContain('the proxy asks for a user name and password')
    expect(classifyYtdlpError(out, true).code).toBe('network')
  })
})
