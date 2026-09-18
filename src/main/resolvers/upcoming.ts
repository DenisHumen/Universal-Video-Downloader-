/**
 * "This exists, and there is nothing to play yet."
 *
 * An announced title is not a failure, and it is not a missing page either: the
 * site knows its name, its poster and roughly when it is due. Saying only "no
 * streams found" throws all of that away, and leaves a watcher unable to tell
 * a title that is coming from one that is broken. So it gets its own error,
 * carrying what the site does know, and whoever catches it can decide that
 * waiting is the right response.
 */
export class NotReleasedError extends Error {
  readonly title: string
  readonly thumbnail?: string
  /** When the site expects it, in milliseconds. Absent when it does not say. */
  readonly releaseAt?: number

  constructor(details: { title: string; thumbnail?: string; releaseAt?: number }) {
    super('This title has not been released yet.')
    this.name = 'NotReleasedError'
    this.title = details.title
    this.thumbnail = details.thumbnail
    this.releaseAt = details.releaseAt
  }
}

/**
 * When the site expects the next episode, from what its API says.
 *
 * `next_date` is in seconds and is sometimes zero, sometimes in the past for a
 * title that slipped. A date that has already gone is still worth keeping: it
 * tells a watcher "any day now" rather than "no idea".
 */
export function releaseAtFrom(nextDate: unknown): number | undefined {
  const seconds = Number(nextDate)
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined
  return seconds * 1000
}
