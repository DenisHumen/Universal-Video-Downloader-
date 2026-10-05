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

/**
 * Start watching, or keep watching if already started.
 *
 * Settings are applied whenever any of them changes, and this was restarted
 * each time - every character typed into any field on the settings screen
 * re-read the clipboard as the new starting point. A link copied a moment
 * before was taken for one that was already there and never offered.
 */
export function startClipboardWatch(onLink: (url: string) => void): void {
  deliver = onLink
  if (timer) return
  // Seed with whatever is already on the clipboard so we don't fire on startup.
  lastSeen = safeRead()
  timer = setInterval(() => {
    const text = safeRead()
    if (!text || text === lastSeen) return
    lastSeen = text
    if (URL_RE.test(text) && text.length < 2048) deliver(text)
  }, 1200)
}

export function stopClipboardWatch(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function safeRead(): string {
  try {
    return clipboard.readText().trim()
  } catch {
    return ''
  }
}
