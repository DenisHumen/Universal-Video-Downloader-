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
/** A read still in flight; the next tick waits for it rather than starting a second one. */
let reading = false

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
 */
export function startClipboardWatch(onLink: (url: string) => void): void {
  deliver = onLink
  if (timer) return
  const run = ++generation
  let seeded = false
  // Seed with whatever is already on the clipboard so we don't fire on startup.
  void readClipboardText().then((text) => {
    if (run !== generation) return
    lastSeen = text
    seeded = true
  })
  timer = setInterval(() => {
    if (!seeded || reading) return
    reading = true
    void readClipboardText().then((text) => {
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

/** The clipboard's text, trimmed; empty when it cannot be read. Never rejects. */
export async function readClipboardText(): Promise<string> {
  try {
    return (await clipboard.readText()).trim()
  } catch {
    return ''
  }
}
