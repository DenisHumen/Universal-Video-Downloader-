import { clipboard } from 'electron'

/**
 * Optional convenience: watch the system clipboard and surface links the user
 * copies elsewhere, so downloading doesn't require switching to the app first.
 * Off by default — it only runs when the user turns it on in Settings.
 */

const URL_RE = /^(https?:\/\/|www\.)\S+\.\S+/i

let timer: NodeJS.Timeout | null = null
let lastSeen = ''

export function startClipboardWatch(onLink: (url: string) => void): void {
  stopClipboardWatch()
  // Seed with whatever is already on the clipboard so we don't fire on startup.
  lastSeen = safeRead()
  timer = setInterval(() => {
    const text = safeRead()
    if (!text || text === lastSeen) return
    lastSeen = text
    if (URL_RE.test(text) && text.length < 2048) onLink(text)
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
