import { describe, expect, it } from 'vitest'
import type { DetectResult, MediaInfo } from '@shared/types'
import { DETECT_TTL_MS, DetectCache, InflightDetects } from './detectCache'

const ok = (id: string): DetectResult => ({ ok: true, info: { id } as MediaInfo })

describe('DetectCache', () => {
  it('answers the same video under any of its link shapes', () => {
    const cache = new DetectCache()
    cache.set('https://youtu.be/dQw4w9WgXcQ?si=abc', ok('a'))
    expect(cache.get('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual(ok('a'))
  })

  it('forgets a result after ten minutes', () => {
    let now = 0
    const cache = new DetectCache(DETECT_TTL_MS, () => now)
    cache.set('https://site.test/v/1', ok('a'))
    now = DETECT_TTL_MS
    expect(cache.get('https://site.test/v/1')).not.toBeNull()
    now = DETECT_TTL_MS + 1
    expect(cache.get('https://site.test/v/1')).toBeNull()
  })

  it('never keeps a failure', () => {
    const cache = new DetectCache()
    cache.set('https://site.test/v/1', { ok: false, error: 'x' })
    expect(cache.get('https://site.test/v/1')).toBeNull()
  })

  it('drops the oldest link past its size', () => {
    const cache = new DetectCache(DETECT_TTL_MS, Date.now, 2)
    cache.set('https://site.test/1', ok('1'))
    cache.set('https://site.test/2', ok('2'))
    cache.set('https://site.test/1', ok('1'))
    cache.set('https://site.test/3', ok('3'))
    expect(cache.get('https://site.test/2')).toBeNull()
    expect(cache.get('https://site.test/1')).not.toBeNull()
    expect(cache.get('https://site.test/3')).not.toBeNull()
  })
})

describe('InflightDetects', () => {
  it('hands a running detect over once, and forgets it when it settles', async () => {
    const inflight = new InflightDetects()
    let settle!: (r: DetectResult) => void
    const promise = new Promise<DetectResult>((resolve) => (settle = resolve))
    inflight.add('https://site.test/v/1', { requestId: 'r1', promise })
    expect(inflight.has('https://site.test/v/1')).toBe(true)
    expect(inflight.take('https://site.test/v/1')?.requestId).toBe('r1')
    expect(inflight.take('https://site.test/v/1')).toBeNull()

    const second = Promise.resolve(ok('b'))
    inflight.add('https://site.test/v/2', { requestId: 'r2', promise: second })
    await second
    await Promise.resolve()
    expect(inflight.has('https://site.test/v/2')).toBe(false)
    settle(ok('a'))
  })
})
