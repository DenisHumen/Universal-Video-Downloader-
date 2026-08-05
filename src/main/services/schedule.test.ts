import { describe, expect, it } from 'vitest'
import type { DownloadItem } from '@shared/types'
import { pendingOrder } from './schedule'

function q(id: string, createdAt: number, extra: Partial<DownloadItem> = {}): DownloadItem {
  return {
    id,
    url: `https://site/${id}`,
    title: id,
    mode: 'video',
    state: 'queued',
    percent: 0,
    outputDir: 'C:/dl',
    createdAt,
    ...extra
  }
}

const ids = (items: DownloadItem[]): string[] => items.map((i) => i.id)

describe('pendingOrder', () => {
  it('runs oldest first', () => {
    expect(ids(pendingOrder([q('c', 3), q('a', 1), q('b', 2)]))).toEqual(['a', 'b', 'c'])
  })

  it('puts a prioritised item ahead of everything waiting', () => {
    const items = [q('a', 1), q('b', 2), q('urgent', 3, { priority: 1 })]
    expect(ids(pendingOrder(items))).toEqual(['urgent', 'a', 'b'])
  })

  it('keeps repeated bumps in the order they were bumped', () => {
    // prioritizeDownload assigns max+1, so the later bump carries the higher number.
    const items = [q('a', 1), q('first', 2, { priority: 1 }), q('second', 3, { priority: 2 })]
    expect(ids(pendingOrder(items))).toEqual(['second', 'first', 'a'])
  })

  it('falls back to age when priorities match', () => {
    const items = [q('newer', 2, { priority: 5 }), q('older', 1, { priority: 5 })]
    expect(ids(pendingOrder(items))).toEqual(['older', 'newer'])
  })

  it('considers only items that are waiting', () => {
    const items = [
      q('running', 1, { state: 'downloading' }),
      q('done', 2, { state: 'completed' }),
      q('held', 3, { state: 'paused' }),
      q('broken', 4, { state: 'error' }),
      q('waiting', 5)
    ]
    expect(ids(pendingOrder(items))).toEqual(['waiting'])
  })

  it('treats a missing priority as normal rather than as zero-beats-nothing', () => {
    const items = [q('plain', 1), q('bumped', 2, { priority: 1 })]
    expect(ids(pendingOrder(items))).toEqual(['bumped', 'plain'])
  })

  it('does not mutate the array it was given', () => {
    const items = [q('c', 3), q('a', 1)]
    const before = ids(items)
    pendingOrder(items)
    expect(ids(items)).toEqual(before)
  })
})
