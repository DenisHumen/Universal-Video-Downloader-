import { describe, expect, it } from 'vitest'
import type { PlaylistEntry } from '@shared/types'
import { latestEpisode, placeEntries } from './playlist'

const entries: PlaylistEntry[] = Array.from({ length: 12 }, (_, i) => ({
  url: `https://site/v${i + 1}`,
  title: `Part ${i + 1}`
}))
const layout = { folder: true, numbered: true }

describe('placeEntries', () => {
  // Counting the selection would call parts 10-12 "1, 2, 3", and sort them in
  // among the real first three.
  it('numbers by position in the whole list, not in the selection', () => {
    const placed = placeEntries({ title: 'Course', entries }, entries.slice(9), layout)
    expect(placed.map((p) => p.playlist.index)).toEqual([10, 11, 12])
    expect(placed.map((p) => p.entry.title)).toEqual(['Part 10', 'Part 11', 'Part 12'])
  })

  it('keeps the position of entries picked out of order', () => {
    const placed = placeEntries({ title: 'Course', entries }, [entries[4], entries[1]], layout)
    expect(placed.map((p) => p.playlist.index)).toEqual([5, 2])
  })

  // A channel deeper than the listing limit: the width of the number follows
  // the whole channel, so two downloads from it pad the same way.
  it('counts the whole list, even past what was listed', () => {
    const [first] = placeEntries({ title: 'Channel', entries, playlistCount: 1500 }, entries, layout)
    expect(first.playlist).toEqual({ title: 'Channel', index: 1, count: 1500, folder: true, numbered: true })
    const [short] = placeEntries({ title: 'List', entries, playlistCount: 3 }, entries, layout)
    expect(short.playlist.count).toBe(12)
  })

  it('carries the layout chosen on the card', () => {
    const [p] = placeEntries({ title: 'L', entries }, entries, { folder: false, numbered: true })
    expect(p.playlist.folder).toBe(false)
    expect(p.playlist.numbered).toBe(true)
  })

  it('places a repeated link at its first appearance', () => {
    const twice = [...entries, { url: entries[0].url, title: 'again' }]
    const [p] = placeEntries({ title: 'L', entries: twice }, [twice[12]], layout)
    expect(p.playlist.index).toBe(1)
  })
})

describe('latestEpisode', () => {
  it('takes the highest episode of the highest season', () => {
    expect(
      latestEpisode([
        { season: 1, episodes: [1, 2, 3] },
        { season: 2, episodes: [1, 2, 3, 4, 5] }
      ])
    ).toEqual({ season: 2, episode: 5 })
  })

  // Sites send these in whatever order they keep them.
  it('goes by number, not by position in the list', () => {
    expect(
      latestEpisode([
        { season: 3, episodes: [8, 2, 9, 1] },
        { season: 1, episodes: [1, 2] }
      ])
    ).toEqual({ season: 3, episode: 9 })
  })

  it('skips a season with nothing in it yet, and has no answer for none', () => {
    expect(
      latestEpisode([
        { season: 1, episodes: [1, 2] },
        { season: 2, episodes: [] }
      ])
    ).toEqual({ season: 1, episode: 2 })
    expect(latestEpisode([])).toBeUndefined()
  })
})
