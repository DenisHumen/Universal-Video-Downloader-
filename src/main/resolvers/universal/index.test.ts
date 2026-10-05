import { beforeEach, describe, expect, it, vi } from 'vitest'
import { describeNetError, REQUEST_TIMED_OUT } from '../neterror'
import { resolveUniversal } from './index'

/*
  Both strategies are stand-ins: the scrape so a test can say how the page
  fetch failed, the hidden browser so it can prove it was never opened.
*/
const scrapeStatic = vi.hoisted(() => vi.fn())
const sniffPage = vi.hoisted(() => vi.fn())
vi.mock('./static', () => ({ scrapeStatic }))
vi.mock('./sniffer', () => ({ sniffPage }))

const PAGE = 'https://ok.ru/video/1234567'

beforeEach(() => {
  scrapeStatic.mockReset()
  sniffPage.mockReset()
  sniffPage.mockResolvedValue(null)
})

/*
  A host blocked from this network took about two minutes to report. After the
  engine gave up, the page was opened in the hidden browser regardless - which
  loaded the same address over the same network and waited out its whole
  timeout to fail the same way - and then the user was told nothing useful.
*/
describe('resolveUniversal, when the page cannot be reached', () => {
  it('never opens the browser for a host that does not resolve', async () => {
    scrapeStatic.mockRejectedValue(describeNetError(new Error('net::ERR_NAME_NOT_RESOLVED'), PAGE))
    await expect(resolveUniversal(PAGE)).rejects.toThrow(/Could not reach ok\.ru: could not resolve host/)
    expect(sniffPage).not.toHaveBeenCalled()
  })

  it('never opens the browser for a host that does not answer', async () => {
    scrapeStatic.mockRejectedValue(describeNetError(new Error('net::ERR_CONNECTION_TIMED_OUT'), PAGE))
    await expect(resolveUniversal(PAGE)).rejects.toThrow(/timed out/)
    scrapeStatic.mockRejectedValue(new Error(REQUEST_TIMED_OUT))
    await expect(resolveUniversal(PAGE)).rejects.toThrow(REQUEST_TIMED_OUT)
    expect(sniffPage).not.toHaveBeenCalled()
  })

  it('still tries the browser when the site answered with a refusal', async () => {
    // A 403 or a certificate the bare request did not trust: the site is there,
    // and a real browser may well get through.
    for (const err of [
      new Error('HTTP 403'),
      describeNetError(new Error('net::ERR_CERT_AUTHORITY_INVALID'), PAGE)
    ]) {
      sniffPage.mockClear()
      scrapeStatic.mockRejectedValue(err)
      await expect(resolveUniversal(PAGE)).resolves.toBeNull()
      expect(sniffPage, err.message).toHaveBeenCalledOnce()
    }
  })
})
