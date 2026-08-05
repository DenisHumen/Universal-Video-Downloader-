import { powerSaveBlocker } from 'electron'

let blockerId: number | null = null

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
 * The blocker is released the moment the last transfer stops, so an idle app
 * never holds the machine up.
 */
export function setKeepAwake(active: boolean): void {
  if (active) {
    if (blockerId != null && powerSaveBlocker.isStarted(blockerId)) return
    blockerId = powerSaveBlocker.start('prevent-app-suspension')
    return
  }
  if (blockerId != null) {
    if (powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId)
    blockerId = null
  }
}
