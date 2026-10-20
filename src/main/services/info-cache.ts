import { createHash, randomBytes } from 'crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AppSettings } from '@shared/types'
import { normalizeUrl } from '@shared/urls'

/*
  The detect's answer, handed to the download that follows it.

  Detecting a video runs the engine's whole extraction (`-J`), and pressing
  download then ran all of it again - for YouTube about 1.3 s of extraction
  plus another engine start before the first byte. The probe's JSON is what
  `--load-info-json` takes in place of a URL, so a download started soon
  after its detect skips straight to fetching.

  Soon, because the stream addresses inside it are signed and expire: fifteen
  minutes, comfortably inside YouTube's few hours and short enough that most
  sites' tokens still hold. A run that finds them expired anyway gets one
  ordinary retry; see `isStaleInfoError`.
*/

export const INFO_TTL_MS = 15 * 60_000
const SUFFIX = '.info.json'

/**
 * What the cache is keyed by: the canonical link, and every setting that
 * changes what the site shows the engine. Cookies decide which formats - or
 * whether any - a signed-in viewer gets, and a proxy can put the request in
 * another country. Format choices are not in it: the JSON lists every format,
 * and the download picks from it with `-f` either way.
 */
export function infoKey(
  url: string,
  settings: Pick<AppSettings, 'cookiesFile' | 'cookiesFromBrowser' | 'proxy'>
): string {
  const access = createHash('sha256')
    .update(JSON.stringify([settings.cookiesFile, settings.cookiesFromBrowser, settings.proxy]))
    .digest('hex')
    .slice(0, 16)
  return `${normalizeUrl(url)}#${access}`
}

/**
 * A failure that may be the reused JSON's fault rather than the video's: its
 * stream addresses expired (403, 410, "expired"), or the engine could not read
 * the file. Such a run is retried once as a normal one.
 */
export function isStaleInfoError(output: string): boolean {
  return /HTTP Error 40[34]|HTTP Error 410|\b(expired|signature)\b|load-info-json|info\.json|JSONDecodeError|Expecting value/i.test(
    output
  )
}

interface Entry {
  file: string
  at: number
}

export class InfoCache {
  private readonly entries = new Map<string, Entry>()

  constructor(
    private readonly dir: () => string,
    private readonly ttl = INFO_TTL_MS,
    private readonly now: () => number = Date.now
  ) {}

  /** Keep a probe's raw JSON for `key`, replacing any older one. */
  put(key: string, json: string): void {
    this.sweep()
    this.drop(key)
    try {
      const dir = this.dir()
      mkdirSync(dir, { recursive: true })
      const file = join(dir, `${randomBytes(8).toString('hex')}${SUFFIX}`)
      writeFileSync(file, json, 'utf-8')
      this.entries.set(key, { file, at: this.now() })
    } catch {
      /* a cache that cannot write is just a miss */
    }
  }

  /**
   * The file for `key` if it is still fresh, handed over: the entry is gone
   * from the cache, and the file is the caller's to `release` once the run
   * that reads it is over. One use only - a retry, a resume or a second
   * download of the same link extracts afresh.
   */
  take(key: string): string | null {
    this.sweep()
    const entry = this.entries.get(key)
    if (!entry) return null
    this.entries.delete(key)
    return existsSync(entry.file) ? entry.file : null
  }

  /** Delete a file `take` handed out. */
  release(file: string): void {
    rmSync(file, { force: true })
  }

  /** Forget everything past its time. */
  sweep(): void {
    const cutoff = this.now() - this.ttl
    for (const [key, entry] of this.entries) {
      if (entry.at < cutoff) this.drop(key)
    }
  }

  /** At launch: whatever a previous session left behind is stale by definition. */
  clearDir(): void {
    this.entries.clear()
    let names: string[]
    try {
      names = readdirSync(this.dir())
    } catch {
      return
    }
    for (const name of names) {
      if (name.endsWith(SUFFIX)) rmSync(join(this.dir(), name), { force: true })
    }
  }

  get size(): number {
    return this.entries.size
  }

  private drop(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    this.entries.delete(key)
    rmSync(entry.file, { force: true })
  }
}
