import type { DetectResult } from '@shared/types'
import { normalizeUrl } from '@shared/urls'

/** How long a detected link stays answered without asking the engine again. */
export const DETECT_TTL_MS = 10 * 60_000

/**
 * Detect results by canonical link, for a while.
 *
 * Re-pasting the link that is on screen, coming back to Home after queueing
 * one format to queue another, the clipboard strip offering a link that was
 * just detected: each of these used to run the engine again for a result it
 * had produced seconds earlier. Only successes are kept. A failure may well
 * be the moment rather than the link, and a retry has to really retry.
 *
 * Ten minutes, because what is cached includes stream addresses some sites
 * sign for about that long; the download re-resolves the page regardless.
 */
export class DetectCache {
  private readonly entries = new Map<string, { result: DetectResult; at: number }>()

  constructor(
    private readonly ttlMs = DETECT_TTL_MS,
    private readonly now: () => number = Date.now,
    /** Past this many links the oldest goes; a result can carry a long playlist. */
    private readonly max = 50
  ) {}

  get(url: string): DetectResult | null {
    const key = normalizeUrl(url)
    const entry = this.entries.get(key)
    if (!entry) return null
    if (this.now() - entry.at > this.ttlMs) {
      this.entries.delete(key)
      return null
    }
    return entry.result
  }

  set(url: string, result: DetectResult): void {
    if (!result.ok || !result.info) return
    const key = normalizeUrl(url)
    // Re-inserted, so the Map's order stays oldest-first.
    this.entries.delete(key)
    this.entries.set(key, { result, at: this.now() })
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }

  delete(url: string): void {
    this.entries.delete(normalizeUrl(url))
  }
}

/** A detect started before anyone asked for it, which Home can adopt instead of starting its own. */
export interface InflightDetect {
  requestId: string
  promise: Promise<DetectResult>
}

/**
 * Speculative detects by canonical link: one at most per link, removed once it
 * settles, is adopted, or is called off.
 */
export class InflightDetects {
  private readonly entries = new Map<string, InflightDetect>()

  has(url: string): boolean {
    return this.entries.has(normalizeUrl(url))
  }

  add(url: string, detect: InflightDetect): void {
    const key = normalizeUrl(url)
    this.entries.set(key, detect)
    // Gone when it settles - but only if it is still the one on file.
    const clear = (): void => {
      if (this.entries.get(key) === detect) this.entries.delete(key)
    }
    detect.promise.then(clear, clear)
  }

  /** Hand the detect over to whoever will now wait on it. */
  take(url: string): InflightDetect | null {
    const key = normalizeUrl(url)
    const found = this.entries.get(key) ?? null
    this.entries.delete(key)
    return found
  }
}
