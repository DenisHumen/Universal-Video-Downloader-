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
  /*
    Audio, scored below every video container on purpose. A page that has both
    must resolve to the video; a page that has only a podcast, a mix or a
    lecture recording is still something the user asked to download, and used
    to come back as "nothing found".
  */
  { re: /\.(mp3|m4a|flac)(\?|#|$)/i, kind: 'file', score: 56 },
  { re: /\.(aac|ogg|oga|opus|wav)(\?|#|$)/i, kind: 'file', score: 50 },
  { re: /\.ts(\?|#|$)/i, kind: 'file', score: 12 }
]

/**
 * The same ladder, read off the response instead of the URL.
 *
 * Plenty of CDNs serve manifests from extensionless paths — `/hls/12345` with
 * `Content-Type: application/vnd.apple.mpegurl` — and for those the filename
 * says nothing at all. The capture hook has always watched response types for
 * exactly this case; it just had no way to turn one into a score, so every
 * extensionless stream it saw was silently thrown away.
 */
const TYPE_SCORE: { re: RegExp; kind: MediaKind; score: number }[] = [
  { re: /application\/(x-mpegurl|vnd\.apple\.mpegurl)/i, kind: 'hls', score: 100 },
  { re: /application\/dash\+xml/i, kind: 'dash', score: 92 },
  { re: /video\/mp4/i, kind: 'file', score: 82 },
  { re: /video\/webm/i, kind: 'file', score: 74 },
  { re: /video\/quicktime/i, kind: 'file', score: 70 },
  { re: /video\/x-flv/i, kind: 'file', score: 60 },
  { re: /audio\/(mpeg|mp4|aac|ogg|opus|flac|wav|x-m4a)/i, kind: 'file', score: 56 },
  // One HLS segment out of thousands — never the thing to download.
  { re: /video\/mp2t/i, kind: 'file', score: 12 }
]

export function classifyContentType(type: string): { kind: MediaKind; score: number } {
  for (const { re, kind, score } of TYPE_SCORE) {
    if (re.test(type)) return { kind, score }
  }
  return { kind: 'unknown', score: 0 }
}

/** A candidate at or above this is worth offering to the user. */
export const PLAUSIBLE_SCORE = 40

/*
  Every word below used to end in an optional separator, which is no boundary
  at all: `(intro)[/._-]?` matches the `intro` inside `introduction`. The list
  therefore read as prefixes, and `/course/introduction.mp4`, `/logout.mp4`,
  `/posterior-approach.mp4` and `/lecture-samples.mp3` were all scored as junk.
  They need a real boundary now — the next character may not be a letter or a
  digit.
*/

/**
 * Certainly not the video the user asked for. These sink a candidate on
 * purpose: better to find nothing than to hand back an advert.
 */
const DISQUALIFYING: { re: RegExp; penalty: number }[] = [
  { re: /\/(ads?|advert(ising)?|analytics|tracker|pixel|beacon|telemetry)[/._-]/i, penalty: 90 },
  { re: /(doubleclick|googlesyndication|adservice|adsystem|popads|exoclick|trafficjunky)/i, penalty: 90 },
  { re: /\bblob:/i, penalty: 200 },
  // One piece of a stream, never the stream. Mild, because a fragmented-MP4
  // CDN names real media this way too and 35 only demotes an mp4.
  { re: /[/._-](seg(ment)?|chunk|frag(ment)?)s?\d*(?![a-z0-9])/i, penalty: 35 }
]

/**
 * Names an image, not a video. Nothing anyone recorded is called `sprite` or
 * `storyboard`, so these are safe to drop outright.
 *
 * `cover` and `banner` used to be on this list and are not any more. Both are
 * ordinary words in a title — a cover version, a cover band, somebody named
 * Banner — and both name images, which score zero on their extension and never
 * reach this far regardless. The rule cost real videos and bought nothing.
 */
const IMAGERY: { re: RegExp; penalty: number }[] = [
  { re: /[/._-](sprite|thumb(nail)?|poster|storyboard|logo|avatar)s?\d*(?![a-z0-9])/i, penalty: 55 }
]

/**
 * Probably not the main video — but only probably, and being wrong here costs
 * the user the whole download.
 *
 * A page whose only video is a trailer is still a page somebody opened wanting
 * that trailer, and a course's first lesson really is called `intro.mp4`. At 45
 * off an mp4's 82 that lands on 37, under the floor — so the file did not rank
 * low, it disappeared, and the app reported that it had found nothing. These
 * demote as far as the floor and no further.
 */
const SOFT: { re: RegExp; penalty: number }[] = [
  { re: /[/._-](preview|trailer|teaser|sample|promo|intro|outro|bumper)s?(?![a-z0-9])/i, penalty: 45 }
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

/**
 * How likely this URL is to be the video, and what kind it is.
 *
 * `contentType` is the fallback for URLs that carry no extension: the response
 * knows what it is even when the path doesn't.
 */
export function scoreUrl(
  url: string,
  sourceBonus = 0,
  contentType?: string
): { kind: MediaKind; score: number } {
  const fromUrl = classify(url)
  const { kind, score } = fromUrl.score || !contentType ? fromUrl : classifyContentType(contentType)
  if (!score) return { kind, score: 0 }
  let total = score + sourceBonus
  for (const { re, penalty } of DISQUALIFYING) if (re.test(url)) total -= penalty
  for (const { re, penalty } of IMAGERY) if (re.test(url)) total -= penalty
  for (const { re, bonus } of POSITIVE) if (re.test(url)) total += bonus
  // Absurdly long query strings are usually tracking pixels dressed as media.
  if (url.length > 2000) total -= 20

  /*
    Soft signals demote to the floor and stop there, never through it: a guess
    about a filename should cost a candidate its place at the top of the list,
    not its existence. Anything already under the floor stays under it — this
    must not lift an HLS segment into contention.
  */
  let soft = 0
  for (const { re, penalty } of SOFT) if (re.test(url)) soft += penalty
  if (soft) total = Math.max(Math.min(total, PLAUSIBLE_SCORE), total - soft)

  return { kind, score: total }
}

/** True when the URL looks like real, downloadable media rather than noise. */
export function isPlausible(candidate: MediaCandidate): boolean {
  return candidate.score >= PLAUSIBLE_SCORE && /^https?:\/\//i.test(candidate.url)
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
      byUrl.set(
        c.url,
        existing
          ? { ...c, headers: c.headers ?? existing.headers, bytes: c.bytes ?? existing.bytes }
          : c
      )
    } else {
      // The lower-scoring sighting can still be the one that saw the headers or
      // the content-length, and the sort tie-breaks on bytes.
      if (!existing.headers && c.headers) existing.headers = c.headers
      if (existing.bytes == null && c.bytes != null) existing.bytes = c.bytes
    }
  }
  return [...byUrl.values()].sort((a, b) => b.score - a.score || (b.bytes ?? 0) - (a.bytes ?? 0))
}

/** Best plausible candidate, or undefined. */
export function best(candidates: MediaCandidate[]): MediaCandidate | undefined {
  return rank(candidates).find(isPlausible)
}
