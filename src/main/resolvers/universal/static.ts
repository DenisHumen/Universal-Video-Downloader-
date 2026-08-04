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

const MEDIA_RE = /https?:\/\/[^\s"'`<>\\)(]+?\.(?:m3u8|mpd|mp4|m4v|webm|mov|flv)(?:\?[^\s"'`<>\\)(]*)?/gi

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

function readVideoTags(html: string, base: string, out: MediaCandidate[], meta: StaticScrape): void {
  for (const tag of html.matchAll(/<video\b([^>]*)>([\s\S]*?)<\/video>/gi)) {
    add(out, pick(/\bsrc=["']([^"']+)["']/i, tag[1]), base, 'video[src]', 30)
    const poster = pick(/\bposter=["']([^"']+)["']/i, tag[1])
    if (poster && !meta.thumbnail) meta.thumbnail = absoluteUrl(poster, base)
    for (const src of tag[2].matchAll(/<source\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
      add(out, src[1], base, 'source[src]', 30)
    }
  }
  // Self-closing <video src="…" /> without a closing tag.
  for (const tag of html.matchAll(/<video\b([^>]*?)\/?>/gi)) {
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

async function scrapeOne(url: string, depth: number): Promise<StaticScrape> {
  const meta: StaticScrape = { candidates: [] }
  let html: string
  try {
    html = await fetchText(url, { Referer: `https://${hostOf(url)}/` }, { timeout: 15_000 })
  } catch {
    return meta
  }
  const text = unescapeMarkup(html)
  const out = meta.candidates

  readJsonLd(text, url, out, meta)
  readOpenGraph(text, url, out, meta)
  readVideoTags(text, url, out, meta)
  readPlayerConfigs(text, url, out)
  readRaw(text, url, out)
  meta.title = meta.title || pageTitle(html)

  // Nothing convincing here — try the embedded players.
  if (depth > 0 && !out.some((c) => c.score >= 80)) {
    const frames = readIframes(text, url).slice(0, 3)
    for (const frame of frames) {
      const nested = await scrapeOne(frame, depth - 1)
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
export function scrapeStatic(url: string): Promise<StaticScrape> {
  return scrapeOne(url, 1)
}
