import { b64urlDecode, b64urlEncode, hostOf } from '../http'
import type { ResolvedUrl } from '../types'
import { best, type MediaCandidate } from './candidates'
import { scrapeStatic } from './static'
import { sniffPage } from './sniffer'

/**
 * The universal resolver. Two strategies, cheapest first:
 *
 *  1. **Static scrape** — read the HTML (and one level of player iframes) and
 *     pull media URLs out of JSON-LD, OpenGraph, <video>, player configs.
 *     Milliseconds, works on the majority of "simple" sites.
 *  2. **Headless browser** — load the page in a hidden Chromium window, start
 *     the player and capture the manifest request together with its headers.
 *     Slower, but works on sites that build their stream URL in JavaScript.
 *
 * Only when both come up empty does the app ask the user for a hand-written
 * resolver. Nothing here is site-specific.
 */

export type UniversalStage = 'scraping' | 'browsing'

export interface UniversalOptions {
  /** Allow the (slower) headless browser pass. */
  allowBrowser?: boolean
  /** Progress callback so the UI can say what it's doing. */
  onStage?: (stage: UniversalStage) => void
  /** Hard cap for the browser pass. */
  browserTimeoutMs?: number
  /** Cancels the browser pass; the hidden window is torn down at once. */
  signal?: AbortSignal
}

export const SNIFF_SCHEME = 'uvd-sniff://'

/** The queue URL that re-runs universal resolution on every (re)start. */
export function sniffUrlFor(pageUrl: string): string {
  return SNIFF_SCHEME + b64urlEncode(pageUrl)
}

export function pageUrlFromSniffUrl(uvdUrl: string): string {
  return b64urlDecode(uvdUrl.slice(SNIFF_SCHEME.length))
}

function toResolved(
  pageUrl: string,
  candidate: MediaCandidate,
  meta: { title?: string; thumbnail?: string; duration?: number }
): ResolvedUrl {
  const headers = { ...(candidate.headers ?? {}) }
  // Referer is passed to the engine through its own flag; keep the rest.
  const referer = headers.Referer || `https://${hostOf(pageUrl)}/`
  delete headers.Referer
  return {
    url: candidate.url,
    referer,
    headers: Object.keys(headers).length ? headers : undefined,
    title: meta.title,
    thumbnail: meta.thumbnail,
    duration: meta.duration,
    extractor: 'Universal',
    downloadUrl: sniffUrlFor(pageUrl)
  }
}

export async function resolveUniversal(
  pageUrl: string,
  options: UniversalOptions = {}
): Promise<ResolvedUrl | null> {
  const { allowBrowser = true, onStage, browserTimeoutMs, signal } = options

  onStage?.('scraping')
  const scraped = await scrapeStatic(pageUrl).catch(() => null)
  const staticBest = scraped ? best(scraped.candidates) : undefined

  // A manifest found in the markup is as trustworthy as one seen on the wire.
  if (staticBest && staticBest.score >= 90) {
    return toResolved(pageUrl, staticBest, scraped!)
  }

  if (allowBrowser && !signal?.aborted) {
    onStage?.('browsing')
    const sniffed = await sniffPage(pageUrl, browserTimeoutMs, signal).catch(() => null)
    if (sniffed) {
      const better =
        staticBest && staticBest.score > sniffed.candidate.score ? staticBest : sniffed.candidate
      return toResolved(pageUrl, better, {
        title: sniffed.title || scraped?.title,
        thumbnail: sniffed.thumbnail || scraped?.thumbnail,
        duration: sniffed.duration || scraped?.duration
      })
    }
  }

  if (staticBest) return toResolved(pageUrl, staticBest, scraped!)
  return null
}

/** Re-resolve a queued `uvd-sniff://` item to a fresh stream URL. */
export async function resolveSniffUrl(uvdUrl: string): Promise<ResolvedUrl> {
  const pageUrl = pageUrlFromSniffUrl(uvdUrl)
  const resolved = await resolveUniversal(pageUrl)
  if (!resolved) {
    throw new Error('Could not find a video stream on this page any more.')
  }
  return { ...resolved, downloadUrl: uvdUrl }
}
