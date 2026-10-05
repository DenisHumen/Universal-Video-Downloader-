import { describe, expect, it } from 'vitest'
import { formatLine } from '@shared/redact'
import type { DownloadItem } from '@shared/types'
import { downloadFields, siteOf } from './log-fields'

/*
  Downloads used to leave no trace in uvd.log at all. Now every start, finish,
  retry and failure writes a line, and the item those lines describe carries
  live session headers, signed CDN addresses and local paths. These guard the
  one place that decides which of it reaches the file.
*/

const AT = new Date(2026, 7, 25, 18, 32, 23, 386)

function item(overrides: Partial<DownloadItem> = {}): DownloadItem {
  return {
    id: '7f3a91c2-5b1e-4c0a-9d7e-0123456789ab',
    url: 'https://cdn.example.test/hls/v.m3u8?token=s3cr3tvalue&expires=1780000000',
    sourceUrl: 'https://video.example.test/watch/12345?session=abcdef',
    title: 'Some title',
    mode: 'video',
    state: 'downloading',
    percent: 0,
    outputDir: 'C:\\Users\\someone\\Videos',
    createdAt: 0,
    headers: { Cookie: 'sessionid=cookievalue', Authorization: 'Bearer bearervalue' },
    extractor: 'generic',
    ...overrides
  }
}

function line(fields: Record<string, string | number | undefined>): string {
  return formatLine({ at: AT, level: 'warn', subsystem: 'download', message: 'Failed', fields })
}

describe('downloadFields', () => {
  it('names the site and nothing else of the address', () => {
    const out = line({ ...downloadFields(item()), code: 'network', attempt: 3 })
    expect(out).toContain('id=7f3a91c2 ')
    expect(out).toContain('host=video.example.test')
    expect(out).toContain('extractor=generic')
    expect(out).toContain('code=network')
    expect(out).toContain('attempt=3')
    for (const leak of ['watch/12345', 'session=', 'abcdef', 'cdn.example.test', 's3cr3tvalue', 'm3u8']) {
      expect(out, leak).not.toContain(leak)
    }
  })

  it('never carries the captured headers', () => {
    // The Cookie a CDN needed is a live login for whatever site the user is signed into.
    const out = line(downloadFields(item()))
    expect(out).not.toContain('cookievalue')
    expect(out).not.toContain('bearervalue')
  })

  it('drops credentials written into the address', () => {
    const out = line(downloadFields(item({ sourceUrl: 'https://bob:hunter2@video.example.test/x' })))
    expect(out).toContain('host=video.example.test')
    expect(out).not.toContain('hunter2')
    expect(out).not.toContain('bob')
  })

  it('gives a resolver scheme by name, not the encoded player address behind it', () => {
    const fields = downloadFields(item({ sourceUrl: 'uvd-yummy://aHR0cHM6Ly9rb2Rpay5pbmZv/3/720' }))
    expect(fields.host).toBe('uvd-yummy')
  })

  it('says nothing about where a local trim or conversion lives', () => {
    const path = 'C:\\Users\\someone\\Videos\\private.mp4'
    const out = line(downloadFields(item({ kind: 'trim', url: path, sourceUrl: undefined, extractor: undefined })))
    expect(out).toContain('kind=trim')
    expect(out).not.toContain('someone')
    expect(out).not.toContain('private')
    expect(out).not.toContain('host=')
  })

  it('leaves the kind out of an ordinary download', () => {
    expect(downloadFields(item()).kind).toBeUndefined()
    expect(downloadFields(item({ kind: 'download' })).kind).toBeUndefined()
  })
})

describe('siteOf', () => {
  it('has nothing to say about something that is not an address', () => {
    expect(siteOf(undefined)).toBeUndefined()
    expect(siteOf('')).toBeUndefined()
    expect(siteOf('not a url at all')).toBeUndefined()
  })
})
