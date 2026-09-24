import { describe, expect, it } from 'vitest'
import { describeNetError } from './neterror'

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
