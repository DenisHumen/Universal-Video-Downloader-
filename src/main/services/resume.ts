import type { DownloadItem } from '@shared/types'

/**
 * States that mean an item was still going when it stopped being our problem —
 * because the app is quitting, or because it was quit last time and this is
 * what got written to history.
 */
export const WAS_RUNNING: DownloadItem['state'][] = [
  'queued',
  'detecting',
  'waiting',
  'downloading',
  'processing'
]

/**
 * Park an item that the app itself is interrupting.
 *
 * The `interrupted` flag is the whole point: it separates "the app stopped
 * this" from "the user pressed pause", and only the first is picked back up on
 * the next launch.
 *
 * This lives here because it has to be applied in two places that run at
 * different times — once when quitting, against live items, and once when
 * loading history, against whatever actually reached the disk. They disagreed:
 * the shutdown path set `paused` and flushed without the flag, and the load
 * path only flagged items whose *persisted* state was still in flight. So a
 * normal quit during a download saved it as plain `paused`, and the resume
 * never fired for the one case it exists for. One rule, one place.
 */
export function markInterrupted(item: DownloadItem): boolean {
  if (!WAS_RUNNING.includes(item.state)) return false
  /*
    A recording being saved was stopped by the person, not by the app. Flagged
    as interrupted it was picked up on the next launch like any download, which
    for a recording means starting the broadcast again: they pressed Stop, quit
    before the file was written, and came back to it recording. It stays
    paused, with everything recorded still there to be saved.
  */
  const stoppedByHand = item.savingLive === true
  item.state = 'paused'
  item.interrupted = !stoppedByHand
  // Whatever was saving a recording died with the app; what it was saving is still there.
  item.savingLive = undefined
  return true
}

/** Items to pick back up on launch. */
export function shouldResume(item: DownloadItem): boolean {
  return Boolean(item.interrupted) && item.state === 'paused'
}
