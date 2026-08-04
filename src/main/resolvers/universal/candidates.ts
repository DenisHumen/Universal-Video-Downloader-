/**
 * Scoring and de-duplication of media URLs found on a page. Shared by the
 * static HTML extractor and the headless browser sniffer so both rank
 * candidates the same way.
 */

export type MediaKind = 'hls' | 'dash' | 'file' | 'unknown'

export interface MediaCandidate {
  url: string
  kind: MediaKind
  /** Higher is better. */
  score: number
  /** Headers the stream needs (Referer/Origin/Cookie/User-Agent). */
  headers?: Record<string, string>
  /** Where the candidate came from — used for tie-breaking and debugging. */
  source: string
  /** Bytes, when the response advertised a content-length. */
  bytes?: number
}

const EXT_SCORE: { re: RegExp; kind: MediaKind; score: number }[] = [
  { re: /\.m3u8(\?|#|$)/i, kind: 'hls', score: 100 },
  { re: /\.mpd(\?|#|$)/i, kind: 'dash', score: 92 },
  { re: /\.mp4(\?|#|$)/i, kind: 'file', score: 82 },
  { re: /\.m4v(\?|#|$)/i, kind: 'file', score: 76 },
  { re: /\.webm(\?|#|$)/i, kind: 'file', score: 74 },
  { re: /\.mov(\?|#|$)/i, kind: 'file', score: 70 },
  { re: /\.flv(\?|#|$)/i, kind: 'file', score: 60 },
  { re: /\.ts(\?|#|$)/i, kind: 'file', score: 12 }
]

/** Junk that regularly shows up next to the real stream. */
const NEGATIVE: { re: RegExp; penalty: number }[] = [
  { re: /\/(ads?|advert(ising)?|analytics|tracker|pixel|beacon|telemetry)[/._-]/i, penalty: 90 },
  { re: /(doubleclick|googlesyndication|adservice|adsystem|popads|exoclick|trafficjunky)/i, penalty: 90 },
  { re: /[/._-](preview|trailer|teaser|sample|promo|intro|outro|bumper)[/._-]?/i, penalty: 45 },
  { re: /[/._-](sprite|thumb(nail)?s?|poster|storyboard|cover|logo|banner|avatar)[/._-]?/i, penalty: 55 },
  { re: /[/._-](seg(ment)?|chunk|frag(ment)?)\d*[/._-]?/i, penalty: 35 },
  { re: /\bblob:/i, penalty: 200 }
]

/** Signals that this is the real thing. */
const POSITIVE: { re: RegExp; bonus: number }[] = [
  { re: /(master|index|playlist|manifest)\.m3u8/i, bonus: 14 },
  { re: /\/(hls|dash|stream|video|media)\//i, bonus: 6 },
  { re: /\b(1080|1440|2160|720)p?\b/i, bonus: 4 }
]

export function classify(url: string): { kind: MediaKind; score: number } {
  for (const { re, kind, score } of EXT_SCORE) {
    if (re.test(url)) return { kind, score }
  }
  return { kind: 'unknown', score: 0 }
}

export function scoreUrl(url: string, sourceBonus = 0): { kind: MediaKind; score: number } {
  const { kind, score } = classify(url)
  if (!score) return { kind, score: 0 }
  let total = score + sourceBonus
  for (const { re, penalty } of NEGATIVE) if (re.test(url)) total -= penalty
  for (const { re, bonus } of POSITIVE) if (re.test(url)) total += bonus
  // Absurdly long query strings are usually tracking pixels dressed as media.
  if (url.length > 2000) total -= 20
  return { kind, score: total }
}

/** True when the URL looks like real, downloadable media rather than noise. */
export function isPlausible(candidate: MediaCandidate): boolean {
  return candidate.score >= 40 && /^https?:\/\//i.test(candidate.url)
}

/**
 * Merge candidates, keeping the best score per URL, then sort best-first.
 * Near-duplicate HLS variants of the same master collapse to the master.
 */
export function rank(candidates: MediaCandidate[]): MediaCandidate[] {
  const byUrl = new Map<string, MediaCandidate>()
  for (const c of candidates) {
    const existing = byUrl.get(c.url)
    if (!existing || c.score > existing.score) {
      byUrl.set(c.url, existing ? { ...c, headers: c.headers ?? existing.headers } : c)
    } else if (!existing.headers && c.headers) {
      existing.headers = c.headers
    }
  }
  return [...byUrl.values()].sort((a, b) => b.score - a.score || (b.bytes ?? 0) - (a.bytes ?? 0))
}

/** Best plausible candidate, or undefined. */
export function best(candidates: MediaCandidate[]): MediaCandidate | undefined {
  return rank(candidates).find(isPlausible)
}
