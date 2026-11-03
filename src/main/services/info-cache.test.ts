import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { INFO_TTL_MS, InfoCache, infoKey, infoReusable, isStaleInfoError } from './info-cache'

const access = { cookiesFile: '', cookiesFromBrowser: '', proxy: '' }

describe('infoKey', () => {
  it('is the same for every shape of one link', () => {
    expect(infoKey('https://youtu.be/dQw4w9WgXcQ?si=x', access)).toBe(
      infoKey('https://www.youtube.com/watch?v=dQw4w9WgXcQ', access)
    )
  })

  it('changes with cookies or the proxy, which change what the site shows', () => {
    const base = infoKey('https://site.test/v/1', access)
    expect(infoKey('https://site.test/v/1', { ...access, cookiesFromBrowser: 'firefox' })).not.toBe(base)
    expect(infoKey('https://site.test/v/1', { ...access, cookiesFile: '/c.txt' })).not.toBe(base)
    expect(infoKey('https://site.test/v/1', { ...access, proxy: 'http://p:1' })).not.toBe(base)
  })

  it('changes when the cookies file is rewritten at the same path', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'uvd-cookies-')), 'cookies.txt')
    writeFileSync(file, '# signed out\n')
    const before = infoKey('https://site.test/v/1', { ...access, cookiesFile: file })
    writeFileSync(file, '# signed in, with a session cookie\n')
    expect(infoKey('https://site.test/v/1', { ...access, cookiesFile: file })).not.toBe(before)
  })

  it('never carries the proxy itself, which may hold a password', () => {
    expect(infoKey('https://site.test/v/1', { ...access, proxy: 'http://user:secret@p:1' })).not.toContain('secret')
  })
})

describe('infoReusable', () => {
  it('is YouTube only', () => {
    expect(infoReusable('https://youtu.be/dQw4w9WgXcQ')).toBe(true)
    expect(infoReusable('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true)
    expect(infoReusable('https://vimeo.com/1')).toBe(false)
    expect(infoReusable('https://notyoutube.com/watch?v=x')).toBe(false)
    expect(infoReusable('https://music.youtube.com/watch?v=x')).toBe(false)
  })
})

describe('isStaleInfoError', () => {
  it('recognises an expired media address and a file the engine could not read', () => {
    expect(isStaleInfoError('ERROR: unable to download video data: HTTP Error 403: Forbidden')).toBe(true)
    expect(isStaleInfoError('[download] Got error: HTTP Error 410: Gone')).toBe(true)
    expect(isStaleInfoError('[download] fragment 3 of 40: HTTP Error 403: Forbidden')).toBe(true)
    expect(isStaleInfoError('json.decoder.JSONDecodeError: Expecting value: line 1')).toBe(true)
    expect(isStaleInfoError("ERROR: [Errno 2] No such file or directory: '/x/ab12.info.json'")).toBe(true)
  })

  it('leaves real failures alone', () => {
    expect(isStaleInfoError('ERROR: [youtube] x: Private video')).toBe(false)
    expect(isStaleInfoError('No space left on device')).toBe(false)
    expect(isStaleInfoError('ERROR: unable to download video data: HTTP Error 404: Not Found')).toBe(false)
    expect(isStaleInfoError('ERROR: Unable to download webpage: HTTP Error 403: Forbidden')).toBe(false)
    expect(isStaleInfoError('the signature has expired')).toBe(false)
  })
})

describe('InfoCache', () => {
  const setup = (): { cache: InfoCache; dir: string; clock: { now: number } } => {
    const dir = mkdtempSync(join(tmpdir(), 'uvd-info-'))
    const clock = { now: 1_000_000 }
    return { cache: new InfoCache(() => dir, INFO_TTL_MS, () => clock.now), dir, clock }
  }

  it('hands a fresh entry over once, as a file holding the JSON', () => {
    const { cache } = setup()
    cache.put('k', '{"id":"x"}')
    const file = cache.take('k')
    expect(file && readFileSync(file, 'utf-8')).toBe('{"id":"x"}')
    expect(cache.take('k')).toBeNull()
    cache.release(file!)
    expect(existsSync(file!)).toBe(false)
  })

  it('deletes an entry and its file once the time is up', () => {
    const { cache, dir, clock } = setup()
    cache.put('k', '{}')
    clock.now += INFO_TTL_MS + 1
    expect(cache.take('k')).toBeNull()
    expect(readdirSync(dir)).toEqual([])
  })

  it('replaces an older answer for the same link', () => {
    const { cache, dir } = setup()
    cache.put('k', '{"v":1}')
    cache.put('k', '{"v":2}')
    expect(readdirSync(dir)).toHaveLength(1)
    expect(readFileSync(cache.take('k')!, 'utf-8')).toBe('{"v":2}')
  })

  it('clears what a previous session left, and only its own files', async () => {
    const { cache, dir } = setup()
    writeFileSync(join(dir, 'old.info.json'), '{}')
    writeFileSync(join(dir, 'keep.txt'), 'x')
    await cache.clearDir()
    expect(readdirSync(dir)).toEqual(['keep.txt'])
  })

  it('spares what this session wrote while it was still clearing', async () => {
    const { cache, dir } = setup()
    writeFileSync(join(dir, 'old.info.json'), '{}')
    cache.put('k', '{}')
    await cache.clearDir()
    expect(readdirSync(dir)).toHaveLength(1)
    expect(cache.take('k')).not.toBeNull()
  })

  it('treats a folder it cannot write to as a miss', () => {
    const cache = new InfoCache(() => {
      throw new Error('no userData here')
    })
    cache.put('k', '{}')
    expect(cache.take('k')).toBeNull()
  })
})
