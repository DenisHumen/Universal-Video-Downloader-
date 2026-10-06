import { b64urlDecode, b64urlEncode, hostOf } from '../http'
import { unreachableCode } from '../neterror'
import { kodikOnPage, resolveKodikPlayer } from '../sites/kodik'
import type { ResolveOptions, ResolvedUrl } from '../types'
import { best, type MediaCandidate } from './candidates'
import { scrapeStatic, type StaticScrape } from './static'
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
 * resolver. Nothing here is site-specific, with one exception: a Kodik player
 * embedded in the page is handed to the Kodik resolver, because so many Russian
 * anime and film sites embed it and neither strategy can read it.
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
  /**
   * The caller needs a stream, as re-resolving a queued item does. An episode
   * picker for a series player found in the page is no answer there, so that
   * page goes on to the browser as it always did.
   */
  needStream?: boolean
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

/**
 * A stream for the page, or null when neither strategy found one.
 *
 * Rejects - with the reason, in words that name the host - when the page could
 * not be reached at all: no address for the name, no route, nobody answering.
 * The browser pass would have loaded the same address over the same network
 * and failed the same way, only after its whole timeout; an unreachable host
 * used to take about two minutes to report, most of it spent here. A
 * certificate error or an HTTP status is not that: the site is there, and a
 * real browser may still get through, so those carry on to the browser pass.
 */
export async function resolveUniversal(
  pageUrl: string,
  options: UniversalOptions = {}
): Promise<ResolvedUrl | null> {
  const { allowBrowser = true, onStage, browserTimeoutMs, signal, needStream } = options

  onStage?.('scraping')
  let scraped: StaticScrape | null = null
  try {
    scraped = await scrapeStatic(pageUrl)
  } catch (err) {
    if (unreachableCode(err)) throw err
  }
  const staticBest = scraped ? best(scraped.candidates) : undefined

  // A manifest found in the markup is as trustworthy as one seen on the wire.
  if (staticBest && staticBest.score >= 90) {
    return toResolved(pageUrl, staticBest, scraped!)
  }

  /*
    A Kodik player in the page comes back as the Kodik resolver's picker, or as
    its stream for a caller that needs one; either way it is queued by the
    player's own address, so a restart asks Kodik again rather than scraping
    this page. Anything Kodik will not answer - a /uv/ player, a page that
    changed shape - falls through to the browser, as before.
  */
  if (scraped?.player && !signal?.aborted) {
    const viaPlayer = await resolveKodikPlayer(scraped.player).catch(() => null)
    const onPage = viaPlayer && kodikOnPage(viaPlayer, scraped, needStream)
    if (onPage) return onPage
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
export async function resolveSniffUrl(
  uvdUrl: string,
  options: ResolveOptions = {}
): Promise<ResolvedUrl> {
  const pageUrl = pageUrlFromSniffUrl(uvdUrl)
  const resolved = await resolveUniversal(pageUrl, { ...options, needStream: true })
  if (!resolved) {
    throw new Error('Could not find a video stream on this page any more.')
  }
  return { ...resolved, downloadUrl: uvdUrl }
}
