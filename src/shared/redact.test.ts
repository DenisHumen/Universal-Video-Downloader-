import { describe, expect, it } from 'vitest'
import { formatLine, redact, shouldLog, timestamp } from './redact'

/*
  Every secret shape this app can hold gets a case here, added at the same time
  as the code that introduces it. A denylist is only as good as its list, and
  the failure mode is silent: nobody notices a missing rule until a bug report
  arrives with a live session cookie in it.
*/

const AT = new Date(2026, 7, 25, 18, 32, 23, 386)

describe('redact', () => {
  it('removes a captured session cookie', () => {
    const line = 'GET failed  Cookie: sessionid=abc123; csrftoken=zzz'
    const out = redact(line)
    expect(out).not.toContain('abc123')
    expect(out).not.toContain('zzz')
    expect(out).toContain('Cookie:')
  })

  it('removes a bearer token from a header', () => {
    expect(redact('Authorization: Bearer eyJhbGciOi.super.secret')).not.toContain('eyJhbGciOi')
  })

  it('removes the password out of a URL', () => {
    const out = redact('connecting to smb://media:hunter2@nas.local/share')
    expect(out).not.toContain('hunter2')
    // The parts that help diagnose stay.
    expect(out).toContain('nas.local')
    expect(out).toContain('media')
  })

  it('removes a Telegram bot token, which lives in the path', () => {
    // A rule written for query parameters would miss every request we make.
    const out = redact('POST api.telegram.org/bot1234567890:FAKEfakeFAKEfakeFAKEfakeFAKEfake123/sendMessage')
    expect(out).not.toContain('FAKEfakeFAKE')
    expect(out).toContain('1234567890')
    expect(out).toContain('sendMessage')
  })

  it('removes signed-CDN parameters, which are what engine output is full of', () => {
    const out = redact('https://cdn.test/v.m3u8?hdnts=exp=1780000000~hmac=deadbeef&token=abc')
    expect(out).not.toContain('deadbeef')
    expect(out).not.toContain('abc')
    expect(out).toContain('cdn.test')
  })

  it('removes a password however it is written as a field', () => {
    expect(redact('password=hunter2')).not.toContain('hunter2')
    expect(redact('"smbPassword": "hunter2"')).not.toContain('hunter2')
    expect(redact('botToken = 123abc456def')).not.toContain('123abc456def')
  })

  it('leaves everything worth reading alone', () => {
    const line = 'download failed  id=7f3a91c2 site=yummyani status=403 bytes=1240000'
    expect(redact(line)).toBe(line)
  })

  /*
    The first version used a bracketed placeholder and grew a bracket on every
    pass, because the value patterns stop at a quote or an end of line — so the
    placeholder was itself a value worth redacting.
  */
  it('is idempotent', () => {
    for (const line of [
      'Cookie: a=b; c=d',
      'smb://u:p@h/s',
      'api.telegram.org/bot123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/getMe',
      'password=x',
      '?token=y&sig=z'
    ]) {
      expect(redact(redact(line)), line).toBe(redact(line))
    }
  })
})

describe('timestamp', () => {
  it('is local time with the offset spelled out', () => {
    // Whoever reads the file means six on their own clock, and a long run can
    // cross a daylight-saving change.
    expect(timestamp(AT)).toMatch(/^2026-08-25 18:32:23\.386[+-]\d{2}:\d{2}$/)
  })
})

describe('formatLine', () => {
  const base = { at: AT, level: 'info' as const, subsystem: 'watcher' }

  it('puts the fields worth grepping in a fixed order', () => {
    const out = formatLine({ ...base, message: 'New episode found', fields: { id: '7f3a91c2' } })
    expect(out).toContain('INFO ')
    expect(out).toContain('watcher')
    expect(out).toContain('New episode found')
    expect(out).toContain('id=7f3a91c2')
  })

  it('drops fields with nothing in them rather than printing key=undefined', () => {
    const out = formatLine({ ...base, message: 'x', fields: { id: 'a', why: undefined, s: '' } })
    expect(out).toContain('id=a')
    expect(out).not.toContain('why=')
    expect(out).not.toContain('s=')
  })

  /*
    Without this, `grep ERROR` finds the first line of a crash and none of the
    rest — which is exactly the part that explains it.
  */
  it('gives every line of a stack trace its own prefix', () => {
    const out = formatLine({
      ...base,
      level: 'error',
      message: 'Boom\n  at one\n  at two'
    })
    const lines = out.split('\n')
    expect(lines).toHaveLength(3)
    for (const line of lines) expect(line).toContain('ERROR  watcher')
  })

  it('redacts what it formats, so no caller can bypass it', () => {
    const out = formatLine({ ...base, message: 'Cookie: sessionid=secret-value' })
    expect(out).not.toContain('secret-value')
  })

  it('redacts values that arrive as fields too', () => {
    const out = formatLine({ ...base, message: 'upload', fields: { url: 'smb://u:pw@h/s' } })
    expect(out).not.toContain('pw@')
  })
})

describe('shouldLog', () => {
  it('keeps engine chatter out of a default run', () => {
    expect(shouldLog('debug', 'info')).toBe(false)
    expect(shouldLog('info', 'info')).toBe(true)
    expect(shouldLog('error', 'info')).toBe(true)
  })

  it('lets everything through when a bug report is being prepared', () => {
    expect(shouldLog('debug', 'debug')).toBe(true)
  })
})
