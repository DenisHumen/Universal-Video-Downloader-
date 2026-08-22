import type { StreamingInfo } from '@shared/types'

export interface ResolvedEntry {
  url: string
  title: string
  thumbnail?: string
}

/**
 * The outcome of turning a user-supplied link into something the download
 * engine can actually fetch.
 */
export interface ResolvedUrl {
  /** URL to hand to the engine — a stream URL for resolved sites, else the input. */
  url: string
  referer?: string
  /** Extra HTTP headers the stream needs (cookies, origin, user-agent…). */
  headers?: Record<string, string>
  title?: string
  thumbnail?: string
  duration?: number
  extractor?: string
  isPlaylist?: boolean
  playlistTitle?: string
  entries?: ResolvedEntry[]
  /** Rich streaming info for sites that need translator/episode/quality selection. */
  streaming?: StreamingInfo
  /**
   * The URL the download queue should remember. Stream links from scrapers and
   * the universal sniffer expire, so the queue stores an internal `uvd-*://`
   * URL that re-resolves to a fresh stream on every (re)start.
   */
  downloadUrl?: string
}

/**
 * What the caller controls when a queued item is re-resolved.
 *
 * Both of these were simply missing. Re-resolution runs on every start and
 * every retry, and it opened the headless browser whether or not the user had
 * turned that fallback off in Settings, and kept it open after they cancelled.
 */
export interface ResolveOptions {
  /** The user's "try the built-in browser" setting. */
  allowBrowser?: boolean
  /** Cancels the browser pass; the hidden window is torn down at once. */
  signal?: AbortSignal
}

/** A hand-written resolver for one site (or family of mirror domains). */
export interface SiteResolver {
  /** Stable id, also used as the extractor label when the site doesn't set one. */
  id: string
  match: RegExp
  resolve: (url: string) => Promise<ResolvedUrl>
}
