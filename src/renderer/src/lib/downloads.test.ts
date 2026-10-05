import { describe, expect, it } from 'vitest'
import type { DownloadItem } from '@shared/types'
import { applyDownloadsChanged } from './downloads'

function item(id: string, createdAt: number, overrides: Partial<DownloadItem> = {}): DownloadItem {
  return {
    id,
    url: `https://example.com/${id}`,
    title: id,
    mode: 'video',
    state: 'completed',
    percent: 100,
    outputDir: '/tmp',
    createdAt,
    ...overrides
  }
}

const ids = (list: DownloadItem[]): string[] => list.map((d) => d.id)

describe('applyDownloadsChanged', () => {
  // Newest first, as listDownloads returns it.
  const list = [item('c', 30), item('b', 20), item('a', 10)]

  it('applies updates, removals and new entries from one batch together', () => {
    const next = applyDownloadsChanged(list, {
      updated: [item('a', 10, { state: 'queued', percent: 0 }), item('d', 40, { state: 'queued' })],
      removed: ['b']
    })
    expect(ids(next)).toEqual(['d', 'c', 'a'])
    expect(next.find((d) => d.id === 'a')).toMatchObject({ state: 'queued', percent: 0 })
  })

  /*
    A playlist queued at once arrives as one batch. Prepending in arrival
    order put the oldest on top - the reverse of what the list shows after a
    restart, so rows swapped places on the next launch.
  */
  it('puts new entries on top, newest first, whatever order they arrived in', () => {
    const next = applyDownloadsChanged(list, {
      updated: [item('d', 40), item('f', 60), item('e', 50)],
      removed: []
    })
    expect(ids(next)).toEqual(['f', 'e', 'd', 'c', 'b', 'a'])
  })

  it('keeps every existing row where it was when it is updated', () => {
    const next = applyDownloadsChanged(list, {
      updated: [item('c', 30, { state: 'queued' }), item('a', 10, { state: 'queued' })],
      removed: []
    })
    expect(ids(next)).toEqual(['c', 'b', 'a'])
  })

  it('leaves untouched rows as the same objects, so their memoised rows skip the redraw', () => {
    const next = applyDownloadsChanged(list, { updated: [item('b', 20, { state: 'error' })], removed: [] })
    expect(next[0]).toBe(list[0])
    expect(next[2]).toBe(list[2])
    expect(next[1]).not.toBe(list[1])
  })

  // Removal is final: a row the user deleted must not come back as "new".
  it('lets a removal win over an update for the same id', () => {
    const next = applyDownloadsChanged(list, { updated: [item('b', 20)], removed: ['b'] })
    expect(ids(next)).toEqual(['c', 'a'])
  })

  it('returns the same array when the batch changes nothing', () => {
    expect(applyDownloadsChanged(list, { updated: [], removed: [] })).toBe(list)
    expect(applyDownloadsChanged(list, { updated: [], removed: ['gone'] })).toBe(list)
  })

  it('clears hundreds of rows in one pass', () => {
    const big = Array.from({ length: 500 }, (_, i) => item(`r${i}`, 500 - i))
    const doomed = big.filter((_, i) => i >= 40).map((d) => d.id)
    const next = applyDownloadsChanged(big, { updated: [], removed: doomed })
    expect(next).toHaveLength(40)
    expect(next[0].id).toBe('r0')
  })
})
