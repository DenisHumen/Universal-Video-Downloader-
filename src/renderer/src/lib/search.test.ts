import { describe, expect, it } from 'vitest'
import type { SearchResult } from '@shared/types'
import { capLimit, firstLimit, mergeByUrl, mightHaveMore } from './search'

const row = (url: string, service: SearchResult['service'] = 'youtube'): SearchResult => ({
  id: url,
  title: url,
  url,
  service
})

describe('how far a search goes', () => {
  it('starts small and stops where main does', () => {
    expect([firstLimit('all'), capLimit('all')]).toEqual([6, 12])
    expect([firstLimit('youtube'), capLimit('youtube')]).toEqual([12, 30])
  })

  it('offers more only when a service filled its page', () => {
    const six = Array.from({ length: 6 }, (_, i) => row(`u${i}`))
    expect(mightHaveMore(six, 6)).toBe(true)
    expect(mightHaveMore(six.slice(1), 6)).toBe(false)
    // Twelve rows in all, but no service with a full page.
    const spread = Array.from({ length: 12 }, (_, i) => row(`u${i}`, i % 2 ? 'youtube' : 'soundcloud')).slice(0, 10)
    expect(mightHaveMore(spread, 6)).toBe(false)
    expect(mightHaveMore([], 6)).toBe(false)
  })
})

describe('mergeByUrl', () => {
  it('keeps the rows on screen in place and adds only what is new, once', () => {
    const { merged, fresh } = mergeByUrl([row('a'), row('b')], [row('b'), row('c'), row('c'), row('a'), row('d')])
    expect(merged.map((r) => r.url)).toEqual(['a', 'b', 'c', 'd'])
    expect(fresh.map((r) => r.url)).toEqual(['c', 'd'])
  })
})
