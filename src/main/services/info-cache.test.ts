import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { INFO_TTL_MS, InfoCache, infoKey, isStaleInfoError } from './info-cache'

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

  it('never carries the proxy itself, which may hold a password', () => {
    expect(infoKey('https://site.test/v/1', { ...access, proxy: 'http://user:secret@p:1' })).not.toContain('secret')
  })
})

describe('isStaleInfoError', () => {
  it('recognises expired addresses and a file the engine could not read', () => {
    expect(isStaleInfoError('ERROR: unable to download video data: HTTP Error 403: Forbidden')).toBe(true)
    expect(isStaleInfoError('HTTP Error 410: Gone')).toBe(true)
    expect(isStaleInfoError('json.decoder.JSONDecodeError: Expecting value: line 1')).toBe(true)
  })

  it('leaves real failures alone', () => {
    expect(isStaleInfoError('ERROR: [youtube] x: Private video')).toBe(false)
    expect(isStaleInfoError('No space left on device')).toBe(false)
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

  it('clears what a previous session left, and only its own files', () => {
    const { cache, dir } = setup()
    writeFileSync(join(dir, 'old.info.json'), '{}')
    writeFileSync(join(dir, 'keep.txt'), 'x')
    cache.clearDir()
    expect(readdirSync(dir)).toEqual(['keep.txt'])
  })

  it('treats a folder it cannot write to as a miss', () => {
    const cache = new InfoCache(() => {
      throw new Error('no userData here')
    })
    cache.put('k', '{}')
    expect(cache.take('k')).toBeNull()
  })
})
