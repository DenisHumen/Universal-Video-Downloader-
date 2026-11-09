/**
 * Whether a download will fit, worked out before it starts.
 *
 * Shared because both ends ask: the card says so before the click, and the queue
 * row fails early rather than an hour in, at 97%, with a partial file taking up
 * what little room was left.
 */

/** What a download is expected to weigh. */
export interface SizeEstimate {
  /** The file itself, or the streams together when they are merged. */
  bytes: number
  /** Every part has a size the site states. Otherwise it is a guess, good for a warning and not for a refusal. */
  exact: boolean
  /** Separate streams become one file, and for a moment all of them are on disk at once. */
  merging: boolean
}

/** What the disk says. */
export interface FreeSpace {
  bytes: number
  /** A network share may report anything, so it is good for a warning at most. */
  reliable: boolean
}

export type DiskVerdict = 'fits' | 'wontFit' | 'mayNotFit'

/** The room a download needs at its worst: both streams and the merged file beside them. */
export function roomNeeded(estimate: SizeEstimate, alreadyOnDisk = 0): number {
  const remaining = Math.max(0, estimate.bytes - Math.max(0, alreadyOnDisk))
  return estimate.merging ? remaining + estimate.bytes : remaining
}

/**
 * Fits, won't, or might not.
 *
 * Unknown on either side is "fits": nothing is said on a guess about a guess, and
 * a disk that cannot be asked is no reason to stop anyone. Only a stated size
 * against a disk that can be believed is a refusal.
 */
export function diskVerdict(
  estimate: SizeEstimate | undefined,
  free: FreeSpace | undefined,
  alreadyOnDisk = 0
): DiskVerdict {
  if (!estimate || !free || !(estimate.bytes > 0)) return 'fits'
  if (roomNeeded(estimate, alreadyOnDisk) <= free.bytes) return 'fits'
  return estimate.exact && free.reliable ? 'wontFit' : 'mayNotFit'
}

/** An estimate from the window, believed only as far as its shape. A wrong number can only ever cost a warning or a retry. */
export function cleanEstimate(raw: unknown): SizeEstimate | undefined {
  const e = raw as Partial<SizeEstimate> | null | undefined
  if (!e || typeof e !== 'object' || typeof e.bytes !== 'number') return undefined
  if (!Number.isFinite(e.bytes) || e.bytes <= 0) return undefined
  return { bytes: e.bytes, exact: e.exact === true, merging: e.merging === true }
}
