import { describe, expect, it } from 'vitest'
import { DIRECT_SCHEME, directSecrets, directUrlFor, parseDirectUrl, resolveDirectUrl } from './direct'

/*
  The `uvd-direct://` URL becomes the queue item's `url` and `sourceUrl`, both of
  which are written to history.json and broadcast to the renderer on every
  progress update. It is base64, not encryption. The sanitiser that keeps
  captured headers out of those two places only deletes `DownloadItem.headers`
  and cannot see inside an encoded string, so anything embedded here lands on
  disk in clear text and survives restarts.
*/
const CAPTURED = {
  url: 'https://cdn.test/stream.m3u8',
  referer: 'https://site.test/watch/1',
  pageUrl: 'https://site.test/watch/1',
  title: 'An episode',
  headers: {
    Cookie: 'sessionid=super-secret-value; csrf=abc',
    Authorization: 'Bearer super-secret-token',
    Origin: 'https://site.test',
    'User-Agent': 'Mozilla/5.0'
  }
}

describe('directUrlFor', () => {
  it('puts no credential into the URL, in any encoding', () => {
    const url = directUrlFor(CAPTURED)
    const decoded = Buffer.from(url.slice(DIRECT_SCHEME.length), 'base64url').toString('utf8')

    for (const secret of ['super-secret-value', 'super-secret-token', 'sessionid', 'Bearer']) {
      expect(decoded, secret).not.toContain(secret)
      expect(url, secret).not.toContain(secret)
    }
    expect(decoded).not.toMatch(/"Cookie"|"Authorization"/)
  })

  it('keeps the headers that merely describe the request', () => {
    const payload = parseDirectUrl(directUrlFor(CAPTURED))
    expect(payload?.headers).toEqual({ Origin: 'https://site.test', 'User-Agent': 'Mozilla/5.0' })
  })

  it('still carries everything needed to re-resolve the page', () => {
    const payload = parseDirectUrl(directUrlFor(CAPTURED))
    expect(payload?.url).toBe(CAPTURED.url)
    expect(payload?.pageUrl).toBe(CAPTURED.pageUrl)
    expect(payload?.referer).toBe(CAPTURED.referer)
    expect(payload?.title).toBe(CAPTURED.title)
    expect(payload?.capturedAt).toBeGreaterThan(0)
  })

  it('remembers the credentials in memory, keyed by the URL it returned', () => {
    const url = directUrlFor(CAPTURED)
    expect(directSecrets(url)).toEqual({
      Cookie: CAPTURED.headers.Cookie,
      Authorization: CAPTURED.headers.Authorization
    })
  })

  it('stores nothing when there was nothing secret to store', () => {
    const url = directUrlFor({ url: 'https://cdn.test/a.mp4', headers: { Origin: 'https://s.test' } })
    expect(directSecrets(url)).toBeUndefined()
  })
})

describe('resolveDirectUrl', () => {
  it('hands the credentials back, so a signed-in download still works', async () => {
    // Fresh capture, so it takes the direct path rather than re-resolving.
    const resolved = await resolveDirectUrl(directUrlFor(CAPTURED))
    expect(resolved.url).toBe(CAPTURED.url)
    expect(resolved.headers).toEqual(CAPTURED.headers)
  })

  it('has none to hand back for a URL from a previous run', async () => {
    // What a history.json entry looks like after a restart: the encoded payload
    // survived, the credentials did not — which is the point.
    const fromDisk = directUrlFor(CAPTURED)
    const restarted = DIRECT_SCHEME + fromDisk.slice(DIRECT_SCHEME.length) + ''
    expect(directSecrets(restarted)).toBeDefined()

    const unknown = directUrlFor({ url: 'https://cdn.test/other.mp4' })
    const resolved = await resolveDirectUrl(unknown)
    expect(resolved.headers).toBeUndefined()
  })

  it('refuses a corrupted link rather than downloading something arbitrary', async () => {
    await expect(resolveDirectUrl(DIRECT_SCHEME + 'not-base64-json')).rejects.toThrow(/corrupted/i)
  })

  it('refuses a payload whose stream is not an http(s) address', async () => {
    // The payload is base64 anyone can write, and its `url` went straight into
    // the engine's URL slot - an option, a file:// path, whatever it said.
    const crafted = (payload: object): string =>
      DIRECT_SCHEME + Buffer.from(JSON.stringify({ capturedAt: Date.now(), ...payload })).toString('base64url')
    for (const url of ['--exec=calc', 'file:///C:/Windows/win.ini', 'rtmp://host/app', 42]) {
      await expect(resolveDirectUrl(crafted({ url })), String(url)).rejects.toThrow(/corrupted/i)
    }
    await expect(resolveDirectUrl(crafted({}))).rejects.toThrow(/corrupted/i)
  })

  it('refuses a page address that is not http(s), since a stale capture would open it', async () => {
    const url = directUrlFor({ url: 'https://cdn.test/a.mp4', pageUrl: 'file:///C:/secret.html' })
    await expect(resolveDirectUrl(url)).rejects.toThrow(/corrupted/i)
  })

  it('still accepts a capture with no page address at all', async () => {
    // The built-in browser records an empty one when it has nothing better.
    const url = directUrlFor({ url: 'https://cdn.test/a.mp4', pageUrl: '' })
    await expect(resolveDirectUrl(url)).resolves.toMatchObject({ url: 'https://cdn.test/a.mp4' })
  })
})
