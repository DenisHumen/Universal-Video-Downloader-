import { clipboard } from 'electron'

/**
 * Optional convenience: watch the system clipboard and surface links the user
 * copies elsewhere, so downloading doesn't require switching to the app first.
 * Off by default — it only runs when the user turns it on in Settings.
 */

const URL_RE = /^(https?:\/\/|www\.)\S+\.\S+/i

let timer: NodeJS.Timeout | null = null
let lastSeen = ''
let deliver: (url: string) => void = () => {}
/** Bumped on every start and stop, so a read still under way when the watch stopped is dropped. */
let generation = 0

/** How long one read may take before it counts as empty. */
export const READ_TIMEOUT_MS = 1500

/**
 * The read under way, whichever run started it. A run started while an older
 * run's read is still out waits on that same read rather than issuing a second
 * one, so reads never overlap.
 */
let inFlight: Promise<string> | null = null

/**
 * Start watching, or keep watching if already started.
 *
 * Settings are applied whenever any of them changes, and this was restarted
 * each time - every character typed into any field on the settings screen
 * re-read the clipboard as the new starting point. A link copied a moment
 * before was taken for one that was already there and never offered.
 *
 * Electron 44 made `clipboard.readText()` return a promise, so the seed and
 * each tick are asynchronous; nothing is offered until the seed has landed.
 * A read that never answers counts as empty after READ_TIMEOUT_MS, so it
 * cannot stop the watch for good; and whether a read is out is kept per run,
 * so an old run's read can never clear (or hold) a new run's.
 */
export function startClipboardWatch(onLink: (url: string) => void): void {
  deliver = onLink
  if (timer) return
  const run = ++generation
  let seeded = false
  // Seed with whatever is already on the clipboard so we don't fire on startup.
  let reading = true
  void sharedRead().then((text) => {
    reading = false
    if (run !== generation) return
    lastSeen = text
    seeded = true
  })
  timer = setInterval(() => {
    if (!seeded || reading) return
    reading = true
    void sharedRead().then((text) => {
      reading = false
      if (run !== generation) return
      if (!text || text === lastSeen) return
      lastSeen = text
      if (URL_RE.test(text) && text.length < 2048) deliver(text)
    })
  }, 1200)
}

export function stopClipboardWatch(): void {
  generation++
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

/** One read at a time, shared by whoever asks while it is out. */
function sharedRead(): Promise<string> {
  if (!inFlight) {
    inFlight = readClipboardText().finally(() => {
      inFlight = null
    })
  }
  return inFlight
}

/**
 * The clipboard's text, trimmed; empty when it cannot be read or does not
 * answer within READ_TIMEOUT_MS. Never rejects.
 */
export async function readClipboardText(): Promise<string> {
  let timeout: NodeJS.Timeout | undefined
  const late = new Promise<string>((resolve) => {
    timeout = setTimeout(() => resolve(''), READ_TIMEOUT_MS)
  })
  try {
    const read = Promise.resolve()
      .then(() => clipboard.readText())
      .then((text) => text.trim())
    return await Promise.race([read, late])
  } catch {
    return ''
  } finally {
    clearTimeout(timeout)
  }
}
