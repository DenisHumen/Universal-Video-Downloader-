/**
 * Following a channel or a playlist: deciding which of the uploads a listing
 * shows are new.
 *
 * Pure, and apart from the series code, because a series and a channel fail
 * differently. A series' episodes are numbered, so whatever has no number in
 * `seen` is new. A channel is a window of thirty over a list that may hold
 * thousands: delete one video from the top and the thirty-first slides in, which
 * nobody has seen and nobody uploaded this week. "Not seen" is not "new" here,
 * and taking it to be would quietly download the back catalogue, one deletion at
 * a time, for as long as the watch lives. So an upload has to earn being new -
 * by its date when the site gives one, otherwise by where it sits in the list.
 */

import { episodeKey, videoRef, type EpisodeRef, type Watch } from './automation'

/** How much of a list one check reads. Cheap on any site, and more than a channel uploads between looks. */
export const CHANNEL_WINDOW = 30

/** The most a person is offered to fetch when they start following. Nothing stops them downloading more from Home. */
export const CHANNEL_PICKS: readonly number[] = [0, 1, 3, 5, 10, CHANNEL_WINDOW]

/** A channel is not asked more often than this, whatever the watch says. A check that trips a bot check costs far more than it finds. */
export const CHANNEL_MIN_INTERVAL = 30

/** A clock on the far side of the world, a site that dates an upload by its time zone. */
const DATE_MARGIN_MS = 24 * 60 * 60 * 1000

/** Never-seen uploads sitting between seen ones before a list is taken to have been reordered. One or two is an old video made public again. */
const SHUFFLED_AT = 3

/** One entry of a listing. */
export interface ListedUpload {
  id: string
  url: string
  title: string
  /** Live or scheduled: it has no end yet, so there is nothing to fetch yet. */
  live?: boolean
  /** Milliseconds, when the site says. Most do not in a flat listing. */
  at?: number
}

/** The sentence a watch shows when a whole listing was set aside. In `mainText` for the screen's language. */
export const LIST_CHANGED =
  'This list changed so much that nothing on it could be told apart from what was already there, so none of it was downloaded. New uploads will be found from now on.'

/**
 * Whether a list keeps its newest at the end.
 *
 * Dates settle it when both ends have one. Without them, a YouTube playlist is
 * in the order it was built, and everything else - a channel's page, a feed - is
 * newest first. An uploads playlist (`UU…`) is a channel by another name. Asked
 * once, when the watch is made, and kept: a list whose answer changed between
 * checks would turn everything old into everything new.
 */
export function keepsNewestLast(url: string, entries: ListedUpload[]): boolean {
  const first = entries[0]?.at
  const last = entries[entries.length - 1]?.at
  if (first && last && first !== last) return first < last
  return /[?&]list=(?!UU)/.test(url)
}

/** The bare id, which is all `seen` needs: a channel's list is kept for as long as the watch lives. */
export function asSeen(ref: EpisodeRef): EpisodeRef {
  return videoRef(ref.videoId ?? '')
}

export function asRef(entry: ListedUpload): EpisodeRef {
  return videoRef(entry.id, entry.url, entry.title)
}

/** What one listing means for a watch. */
export interface Sifted {
  /** To fetch, oldest first, so a backlog arrives in the order it was made. */
  fresh: EpisodeRef[]
  /** Never fetched, and now counted as handled: they were there before anybody started following. */
  old: EpisodeRef[]
  /** Everything still to come: what is `fresh` now, and what is live until it ends. */
  owed: EpisodeRef[]
  /** The listing could not be squared with what the watch knew, and was set aside. */
  changed: boolean
}

/**
 * Sort a listing into new, old and not yet.
 *
 * `lists` is one list per tab of the page, each in the site's order. A channel's
 * front page has Videos, Shorts and Live, and each has its own newest.
 *
 * - Whatever the watch already owes is fetched wherever it now sits: the pick
 *   made when following, a stream that has ended, one that failed last time.
 * - Nothing known at all: the watch has no footing, so nothing is new.
 * - A date beats a position: since the last look is new, wherever it is listed.
 * - Otherwise only what is above the newest known upload is new. Below it, an
 *   unknown upload is an older one that slid into the window.
 * - A list with no known upload left, or with unknowns scattered between known
 *   ones, has been replaced or reshuffled. Its undated entries are taken to be
 *   old and the watch says so: a missed video can be fetched by hand, thirty
 *   unwanted ones cannot be taken back.
 */
export function siftUploads(watch: Watch, lists: ListedUpload[][]): Sifted {
  const known = new Set(watch.seen.map(episodeKey))
  const owed = new Map((watch.owed ?? []).filter((r) => !known.has(episodeKey(r))).map((r) => [episodeKey(r), r]))
  const since = (watch.lastListedAt ?? watch.lastCheckedAt ?? watch.createdAt) - DATE_MARGIN_MS

  const fresh = new Map<string, EpisodeRef>()
  const old = new Map<string, EpisodeRef>()
  const waiting = new Set<string>()
  let changed = false

  const handled = new Set<string>()
  // Across tabs: a video on two of them is one video, judged where it first turns up.
  const once = lists.map((list) =>
    list.filter((entry) => {
      const key = episodeKey(videoRef(entry.id))
      if (handled.has(key)) return false
      handled.add(key)
      return true
    })
  )
  const anyKnown = once.some((list) => list.some((e) => known.has(episodeKey(videoRef(e.id)))))

  for (const list of once) {
    const ordered = watch.newestLast ? [...list].reverse() : list
    const isKnown = ordered.map((e) => known.has(episodeKey(videoRef(e.id))))
    const top = isKnown.indexOf(true)
    const bottom = isKnown.lastIndexOf(true)
    const scattered = isKnown.filter((yes, i) => !yes && i > top && i < bottom).length
    const undated: ListedUpload[] = []

    ordered.forEach((entry, i) => {
      const ref = asRef(entry)
      const key = episodeKey(ref)
      if (known.has(key)) return
      if (entry.live) {
        waiting.add(key)
        owed.set(key, ref)
        return
      }
      if (owed.has(key)) return
      // Nothing was ever recorded here, so this is the first anyone has seen of it.
      if (!known.size) {
        old.set(key, ref)
        return
      }
      if (entry.at) {
        if (entry.at >= since) fresh.set(key, ref)
        else old.set(key, ref)
        return
      }
      if (top >= 0 && i > top) old.set(key, ref)
      else undated.push(entry)
    })

    /*
      `anyKnown` for the tab that only just appeared: a channel's first Shorts
      are new, and its list having nothing known says nothing about the others.
    */
    const replaced = top < 0 && !anyKnown && known.size > 0
    if (undated.length && (replaced || scattered >= SHUFFLED_AT)) {
      for (const entry of undated) old.set(episodeKey(videoRef(entry.id)), asRef(entry))
      changed = true
    } else {
      // Oldest first, so the far end of a backlog is not left behind what is fetched first.
      for (const entry of [...undated].reverse()) fresh.set(episodeKey(videoRef(entry.id)), asRef(entry))
    }
  }

  for (const [key, ref] of owed) {
    if (!waiting.has(key)) fresh.set(key, ref)
  }

  // What is new goes on the list of what is owed at once, so a pause or a closed app cannot lose it to the rules above.
  for (const [key, ref] of fresh) owed.set(key, ref)
  return {
    fresh: [...fresh.values()],
    old: [...old.values()].map(asSeen),
    owed: [...owed.values()],
    changed
  }
}

/**
 * What following starts out with: everything on the list counted as handled but
 * the `latest` newest, which are owed, as is whatever is live right now.
 */
export function firstFollow(
  entries: EpisodeRef[],
  waiting: EpisodeRef[],
  latest: number,
  newestLast: boolean
): { seen: EpisodeRef[]; owed: EpisodeRef[] } {
  const newestFirst = newestLast ? [...entries].reverse() : entries
  const picks = newestFirst.slice(0, latest)
  const rest = newestFirst.slice(latest)
  return { seen: rest.map(asSeen), owed: [...[...picks].reverse(), ...waiting] }
}
