import { describe, expect, it } from 'vitest'
import { updateErrorDetail, updateErrorText } from './updateError'

const t = ((key: string) => key) as never

describe('updateErrorText', () => {
  // What Settings showed during a GitHub outage, headers and all.
  it('says a server is not answering instead of printing the exchange', () => {
    const raw =
      '504 "method: GET url: https://github.com/o/r/releases/download/v4.0.8/latest.yml\n\n Data:\n <html><body><h1>504 Gateway Time-out</h1>\n</body></html>\n\n " Headers: { "cache-control": "no-cache" }'
    expect(updateErrorText(t, raw)).toBe('update.notAnswering')
    expect(updateErrorText(t, 'net::ERR_INTERNET_DISCONNECTED')).toBe('update.notAnswering')
    expect(updateErrorText(t, 'connect ETIMEDOUT 140.82.121.3:443')).toBe('update.notAnswering')
    expect(updateErrorText(t, 'net::ERR_HTTP2_SERVER_REFUSED_STREAM')).toBe('update.notAnswering')
  })

  it('says anything else in a plain line, and keeps the first line of it for the tooltip', () => {
    expect(updateErrorText(t, 'sha512 checksum mismatch\nexpected abc')).toBe('update.failed')
    expect(updateErrorDetail('sha512 checksum mismatch\nexpected abc')).toBe('sha512 checksum mismatch')
    expect(updateErrorDetail('x'.repeat(400))).toHaveLength(161)
    expect(updateErrorDetail('  ')).toBeUndefined()
    expect(updateErrorDetail(undefined)).toBeUndefined()
  })

  it('does not take a number inside a checksum for an HTTP status', () => {
    expect(updateErrorText(t, 'checksum a1502f mismatch')).toBe('update.failed')
  })

  it('falls back when there is no message', () => {
    expect(updateErrorText(t, undefined)).toBe('update.failed')
    expect(updateErrorText(t, '  ')).toBe('update.failed')
  })
})
