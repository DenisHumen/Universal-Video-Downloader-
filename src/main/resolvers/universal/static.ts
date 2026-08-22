import { absoluteUrl, cleanHtml, fetchText, hostOf, originOf, pick, UA } from '../http'
import { rank, scoreUrl, type MediaCandidate } from './candidates'

/**
 * A site-agnostic extractor that reads a page's HTML and pulls out every media
 * URL it can find — structured metadata first (JSON-LD, OpenGraph, <video>),
 * then player configs, then a raw sweep of the markup. It also follows player
 * iframes one level deep, which is how most embedded players are reached.
 *
 * This is the fast path of the universal resolver: no browser, no JS execution.
 */

export interface StaticScrape {
  candidates: MediaCandidate[]
  title?: string
  thumbnail?: string
  duration?: number
}

/** Iframes that are never a video player. */
const IFRAME_DENY =
  /(doubleclick|googlesyndication|google\.com\/recaptcha|googletagmanager|facebook\.com|twitter\.com|disqus|adservice|exoclick|trafficjunky|popads|vk\.com\/widget)/i

/** Un-escape the JSON/JS escaping that hides URLs from a naive regex. */
function unescapeMarkup(html: string): string {
  return html
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/')
    .replace(/&#x2F;/gi, '/')
    .replace(/&amp;/g, '&')
}

/*
  Bare media URLs sitting in a script blob or an attribute none of the patterns
  above knows about.

  The audio extensions were missing here while the browser sniffer matched them
  and the scorer ranked them deliberately — so a page whose only media is a
  podcast, a mix or a lecture recording, written as a plain URL rather than an
  <audio> tag, slipped past the cheap pass and had to wait for the hidden
  browser, or came back as nothing at all when that fallback is switched off.
*/
const MEDIA_RE =
  /https?:\/\/[^\s"'`<>\\)(]+?\.(?:m3u8|mpd|mp4|m4v|webm|mov|flv|mp3|m4a|flac|aac|ogg|oga|opus|wav)(?:\?[^\s"'`<>\\)(]*)?/gi

function add(
  out: MediaCandidate[],
  raw: string | undefined,
  base: string,
  source: string,
  bonus: number
): void {
  if (!raw) return
  const url = absoluteUrl(raw, base)
  if (!url || !/^https?:/i.test(url)) return
  const { kind, score } = scoreUrl(url, bonus)
  if (!score) return
  out.push({
    url,
    kind,
    score,
    source,
    headers: { Referer: base, 'User-Agent': UA, ...(originOf(base) ? { Origin: originOf(base)! } : {}) }
  })
}

// ---- structured metadata ----

interface JsonLdNode {
  '@type'?: string | string[]
  contentUrl?: string
  embedUrl?: string
  name?: string
  headline?: string
  thumbnailUrl?: string | string[]
  duration?: string
  video?: JsonLdNode | JsonLdNode[]
  '@graph'?: JsonLdNode[]
  itemListElement?: { item?: JsonLdNode }[]
}

/** ISO-8601 duration (PT1H2M3S) → seconds. */
function isoDuration(value?: string): number | undefined {
  if (!value) return undefined
  const m = value.match(/^P(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/i)
  if (!m) return undefined
  const [, h, min, s] = m
  const total = Number(h || 0) * 3600 + Number(min || 0) * 60 + Number(s || 0)
  return Number.isFinite(total) && total > 0 ? total : undefined
}

function walkJsonLd(node: JsonLdNode | JsonLdNode[] | undefined, visit: (n: JsonLdNode) => void): void {
  if (!node) return
  if (Array.isArray(node)) {
    for (const n of node) walkJsonLd(n, visit)
    return
  }
  visit(node)
  walkJsonLd(node['@graph'], visit)
  walkJsonLd(node.video, visit)
  for (const el of node.itemListElement || []) walkJsonLd(el.item, visit)
}

function readJsonLd(html: string, base: string, out: MediaCandidate[], meta: StaticScrape): void {
  for (const m of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    let parsed: JsonLdNode | JsonLdNode[]
    try {
      parsed = JSON.parse(m[1].trim()) as JsonLdNode
    } catch {
      continue
    }
    walkJsonLd(parsed, (node) => {
      const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type'] ?? '']
      if (!types.some((t) => /VideoObject|Movie|Clip|Episode/i.test(String(t)))) return
      add(out, node.contentUrl, base, 'json-ld', 34)
      meta.title = meta.title || node.name || node.headline
      const thumb = Array.isArray(node.thumbnailUrl) ? node.thumbnailUrl[0] : node.thumbnailUrl
      meta.thumbnail = meta.thumbnail || (thumb ? absoluteUrl(thumb, base) : undefined)
      meta.duration = meta.duration || isoDuration(node.duration)
    })
  }
}

function readOpenGraph(html: string, base: string, out: MediaCandidate[], meta: StaticScrape): void {
  const attr = (prop: string): string | undefined =>
    pick(
      new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'),
      html
    ) ??
    pick(
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'),
      html
    )

  add(out, attr('og:video:secure_url'), base, 'og:video', 28)
  add(out, attr('og:video:url'), base, 'og:video', 28)
  add(out, attr('og:video'), base, 'og:video', 28)
  add(out, attr('twitter:player:stream'), base, 'twitter:player', 26)
  meta.title = meta.title || attr('og:title') || attr('twitter:title')
  meta.thumbnail = meta.thumbnail || absoluteUrl(attr('og:image') || attr('twitter:image') || '', base)
  const dur = Number(attr('og:video:duration') || attr('video:duration') || '')
  if (!meta.duration && Number.isFinite(dur) && dur > 0) meta.duration = dur
}

/**
 * schema.org as microdata rather than JSON-LD.
 *
 * The same `VideoObject` the structured-metadata reader looks for, expressed
 * the older way — `<meta itemprop="contentURL" content="…">`. Plenty of sites
 * that predate JSON-LD still describe their video exactly like this, and the
 * scraper walked straight past every one of them.
 */
function readMicrodata(html: string, base: string, out: MediaCandidate[], meta: StaticScrape): void {
  const ITEMPROP = /(contentUrl|contentURL|embedUrl|embedURL)/
  for (const m of html.matchAll(/<(?:meta|link)\b[^>]*>/gi)) {
    const tag = m[0]
    const prop = pick(/itemprop=["']([^"']+)["']/i, tag)
    if (!prop || !ITEMPROP.test(prop)) continue
    // Attribute order is not guaranteed, so read the value independently.
    add(out, pick(/(?:content|href)=["']([^"']+)["']/i, tag), base, 'microdata', 30)
  }
  if (!meta.thumbnail) {
    for (const m of html.matchAll(/<(?:meta|link)\b[^>]*>/gi)) {
      const tag = m[0]
      if (!/itemprop=["']thumbnailUrl["']/i.test(tag)) continue
      const thumb = pick(/(?:content|href)=["']([^"']+)["']/i, tag)
      if (thumb) {
        meta.thumbnail = absoluteUrl(thumb, base)
        break
      }
    }
  }
}

/**
 * Media URLs parked on `data-*` attributes.
 *
 * A lazy player keeps its real source there until something asks it to start,
 * which on a page nobody is looking at never happens. The headless pass learned
 * to read these; the static pass — the one that runs first, and for free — did
 * not, so a site that would have worked without a browser needed one.
 */
const DATA_ATTR =
  /\bdata-(?:src|video|video-src|file|hls|dash|mp4|m3u8|url|stream|source|player)\s*=\s*["']([^"']{8,})["']/gi

function readDataAttributes(html: string, base: string, out: MediaCandidate[]): void {
  for (const m of html.matchAll(DATA_ATTR)) add(out, m[1], base, 'data-attr', 16)
}

function readVideoTags(html: string, base: string, out: MediaCandidate[], meta: StaticScrape): void {
  // `<audio>` too: an audio-only page is still something the user asked for.
  for (const tag of html.matchAll(/<(?:video|audio)\b([^>]*)>([\s\S]*?)<\/(?:video|audio)>/gi)) {
    add(out, pick(/\bsrc=["']([^"']+)["']/i, tag[1]), base, 'video[src]', 30)
    const poster = pick(/\bposter=["']([^"']+)["']/i, tag[1])
    if (poster && !meta.thumbnail) meta.thumbnail = absoluteUrl(poster, base)
    for (const src of tag[2].matchAll(/<source\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
      add(out, src[1], base, 'source[src]', 30)
    }
  }
  // Self-closing <video src="…" /> without a closing tag.
  for (const tag of html.matchAll(/<(?:video|audio)\b([^>]*?)\/?>/gi)) {
    add(out, pick(/\bsrc=["']([^"']+)["']/i, tag[1]), base, 'video[src]', 30)
  }
}

/** JW Player / Video.js / Plyr / Clappr style configuration objects. */
function readPlayerConfigs(html: string, base: string, out: MediaCandidate[]): void {
  const keys = ['file', 'src', 'source', 'hls', 'url', 'videoUrl', 'video_url', 'playlistUrl', 'manifest']
  for (const key of keys) {
    const re = new RegExp(`["']?${key}["']?\\s*[:=]\\s*["']([^"']{8,})["']`, 'gi')
    for (const m of html.matchAll(re)) add(out, m[1], base, `config:${key}`, 18)
  }
}

function readRaw(html: string, base: string, out: MediaCandidate[]): void {
  for (const m of html.matchAll(MEDIA_RE)) add(out, m[0], base, 'raw', 0)
}

function readIframes(html: string, base: string): string[] {
  const urls: string[] = []
  for (const m of html.matchAll(/<iframe\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    const url = absoluteUrl(m[1], base)
    if (!url || IFRAME_DENY.test(url)) continue
    if (!/^https?:/i.test(url)) continue
    urls.push(url)
  }
  // Lazy-loaded players keep the real src in data-src.
  for (const m of html.matchAll(/<iframe\b[^>]*\bdata-src=["']([^"']+)["']/gi)) {
    const url = absoluteUrl(m[1], base)
    if (url && !IFRAME_DENY.test(url) && /^https?:/i.test(url)) urls.push(url)
  }
  return [...new Set(urls)]
}

function pageTitle(html: string): string | undefined {
  const raw = pick(/<title[^>]*>([\s\S]*?)<\/title>/i, html)
  if (!raw) return undefined
  const cleaned = cleanHtml(raw)
  return cleaned ? cleaned.split(/\s+[|·—–-]\s+/)[0].trim() || cleaned : undefined
}

/**
 * Everything this module knows how to find in a page, with no network in it.
 *
 * Separated from the fetch so it can be tested against real markup: which
 * shapes the scraper recognises is the single thing that decides whether a site
 * works without opening a browser, and it was previously only reachable through
 * a live HTTP request.
 */
export function extractFromHtml(html: string, base: string): StaticScrape {
  const meta: StaticScrape = { candidates: [] }
  const out = meta.candidates
  const text = unescapeMarkup(html)

  readJsonLd(text, base, out, meta)
  readMicrodata(text, base, out, meta)
  readOpenGraph(text, base, out, meta)
  readVideoTags(text, base, out, meta)
  readPlayerConfigs(text, base, out)
  readDataAttributes(text, base, out)
  readRaw(text, base, out)
  meta.title = meta.title || pageTitle(html)

  meta.candidates = rank(out)
  return meta
}

/** Fetches a page. Injectable so the header threading below can be tested. */
export type Fetcher = (url: string, headers: Record<string, string>) => Promise<string>

const defaultFetcher: Fetcher = (url, headers) => fetchText(url, headers, { timeout: 15_000 })

/**
 * The Referer to send when fetching `url`.
 *
 * An embedded player is fetched with the page that embedded it, because that
 * is what a browser sends and what the player checks. This used to send the
 * iframe's own host for every request, including the nested ones — so a player
 * on its own domain, embedded in the site the user is actually on, saw a
 * Referer pointing at itself. That is precisely the shape a hotlink check
 * rejects, and the reply is a 403 or an error page with no video in it: the
 * scrape found nothing and the app said the page had no video on it.
 */
export function refererFor(url: string, parent?: string): string {
  return parent ?? `https://${hostOf(url)}/`
}

async function scrapeOne(
  url: string,
  depth: number,
  parent?: string,
  fetcher: Fetcher = defaultFetcher
): Promise<StaticScrape> {
  let html: string
  try {
    html = await fetcher(url, { Referer: refererFor(url, parent) })
  } catch {
    return { candidates: [] }
  }
  const text = unescapeMarkup(html)
  const meta = extractFromHtml(html, url)
  const out = meta.candidates

  // Nothing convincing here — try the embedded players.
  if (depth > 0 && !out.some((c) => c.score >= 80)) {
    const frames = readIframes(text, url).slice(0, 3)
    for (const frame of frames) {
      const nested = await scrapeOne(frame, depth - 1, url, fetcher)
      out.push(...nested.candidates)
      meta.title = meta.title || nested.title
      meta.thumbnail = meta.thumbnail || nested.thumbnail
      meta.duration = meta.duration || nested.duration
      if (out.some((c) => c.score >= 90)) break
    }
  }

  meta.candidates = rank(out)
  return meta
}

/** Scrape a page (and one level of player iframes) for downloadable media. */
export function scrapeStatic(url: string, fetcher?: Fetcher): Promise<StaticScrape> {
  return scrapeOne(url, 1, undefined, fetcher)
}
