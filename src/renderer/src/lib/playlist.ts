import type { MediaInfo, PlaylistEntry, PlaylistPlace, StreamSeason } from '@shared/types'

/**
 * The newest episode of a series: the highest-numbered episode of its
 * highest-numbered season. By number rather than by position, because the
 * lists are only as ordered as the site that sent them.
 */
export function latestEpisode(seasons: StreamSeason[]): { season: number; episode: number } | undefined {
  const withEpisodes = seasons.filter((s) => s.episodes.length > 0)
  if (!withEpisodes.length) return undefined
  const last = withEpisodes.reduce((a, b) => (b.season > a.season ? b : a))
  return { season: last.season, episode: Math.max(...last.episodes) }
}

/**
 * Each chosen entry with its place in the playlist it came from.
 *
 * Numbered by position in the whole list, not in the selection: taking items
 * 10 to 12 of a course gives files 10, 11 and 12. Counting the selection
 * instead would call them 1, 2 and 3 - which sorts them in among the first
 * three if those are downloaded later, and says nothing true about either.
 *
 * The count is the whole list's too, which may be longer than what was listed
 * (a channel deeper than the listing limit), so the number's width does not
 * change between two downloads from the same list.
 */
export function placeEntries(
  info: Pick<MediaInfo, 'title' | 'playlistCount' | 'entries'>,
  chosen: PlaylistEntry[],
  layout: { folder: boolean; numbered: boolean }
): { entry: PlaylistEntry; playlist: PlaylistPlace }[] {
  const entries = info.entries ?? []
  const position = new Map<string, number>()
  // The first time a link appears is its place; a repeat is refused as a duplicate anyway.
  entries.forEach((e, i) => {
    if (!position.has(e.url)) position.set(e.url, i + 1)
  })
  const count = Math.max(info.playlistCount ?? 0, entries.length)
  return chosen.map((entry, i) => ({
    entry,
    playlist: {
      title: info.title,
      index: position.get(entry.url) ?? i + 1,
      count,
      folder: layout.folder,
      numbered: layout.numbered
    }
  }))
}
