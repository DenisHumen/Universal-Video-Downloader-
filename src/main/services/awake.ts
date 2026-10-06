import { powerSaveBlocker } from 'electron'

let blockerId: number | null = null

/*
  Who needs the machine awake right now: 'queue' while anything is
  transferring, and one tag per automated episode from the end of its download
  until it is on the share and announced. A single on/off switch was not
  enough - the queue releasing it the moment an episode finished downloading
  let the machine sleep through that episode's upload, which then failed.
*/
const holders = new Set<string>()

/**
 * Keep the machine awake while downloads are running.
 *
 * The whole point of a queue is that you start it and walk away — and on every
 * desktop OS, walking away is exactly what triggers sleep. Suspending the
 * machine kills the transfer mid-file; yt-dlp can resume afterwards, but only
 * once someone comes back and notices, which defeats the queue.
 *
 * `prevent-app-suspension` deliberately, not `prevent-display-sleep`: the
 * screen should still turn off. Nothing here needs to be looked at, and holding
 * a laptop's display on all night to download three videos would be rude.
 *
 * The blocker is released the moment the last holder lets go, so an idle app
 * never holds the machine up.
 */
function sync(): void {
  if (holders.size > 0) {
    if (blockerId != null && powerSaveBlocker.isStarted(blockerId)) return
    blockerId = powerSaveBlocker.start('prevent-app-suspension')
    return
  }
  if (blockerId != null) {
    if (powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId)
    blockerId = null
  }
}

/** Hold the machine awake on behalf of `tag`. Holding it twice is holding it once. */
export function acquireAwake(tag: string): void {
  holders.add(tag)
  sync()
}

/** Let go on behalf of `tag`; the machine may sleep once nobody else holds it. */
export function releaseAwake(tag: string): void {
  holders.delete(tag)
  sync()
}
