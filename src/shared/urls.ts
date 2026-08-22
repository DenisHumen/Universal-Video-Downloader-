/**
 * URL heuristics shared by the detector and the UI. Deliberately dependency
 * free so they can be unit-tested without pulling in Electron.
 */

/**
 * Query parameters that never identify the video, only who sent you to it.
 *
 * They matter more than they look: two links to the same video with different
 * `?si=` values are two different strings, so the queue's duplicate check let
 * the same download start twice, and a shared link re-pasted an hour later
 * looked like something new.
 */
const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'fbclid',
  'gclid',
  'igshid',
  'igsh',
  'si',
  'feature',
  'spm',
  'spm_id_from',
  'share_id',
  'share_app_id',
  'share_link_id',
  'is_from_webapp',
  'sender_device',
  'sender_web_id',
  'web_id',
  'ref_src',
  'ref_url',
  '_r',
  '_t',
  '__twitter_impression',
  'pp',
  'ab_channel'
])

/** Hosts whose `m.`/`mobile.` variants are the same site with a worse player. */
const MOBILE_PREFIXES = /^(m|mobile|www\.m)\./i

/** Junk a link picks up when it is pasted out of running text. */
function trimPunctuation(input: string): string {
  return input
    .replace(/^[<("'\s]+/, '')
    .replace(/[>)"'\s]+$/, '')
    .replace(/[.,;:!?]+$/, '')
}

/**
 * Canonicalise a link so the same video always produces the same string.
 *
 * Three separate things depend on this. The duplicate check in the queue
 * compares URLs literally. The "is this a playlist?" test reads the path. And
 * a handful of sites hand out share links (`youtu.be`, `youtube.com/shorts`,
 * `instagram.com/reels`) whose canonical form the engine handles better than
 * the shape the share button produced.
 *
 * Anything that isn't an http(s) URL — the internal `uvd-*://` schemes above
 * all — passes straight through untouched.
 */
export function normalizeUrl(input: string): string {
  const trimmed = trimPunctuation(String(input ?? '').trim())
  if (!trimmed) return trimmed
  if (!/^https?:\/\//i.test(trimmed)) {
    // A bare `youtube.com/watch?v=…` is still a link a person can paste.
    if (/^www\.[^\s/]+\.[a-z]{2,}/i.test(trimmed) || /^[\w-]+(\.[\w-]+)+\/\S/.test(trimmed)) {
      return normalizeUrl(`https://${trimmed}`)
    }
    return trimmed
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return trimmed
  }

  let host = url.hostname.toLowerCase().replace(/\.$/, '')
  let path = url.pathname
  const params = url.searchParams

  for (const key of [...params.keys()]) {
    if (TRACKING_PARAMS.has(key)) params.delete(key)
  }

  // ---- YouTube ----------------------------------------------------------
  if (/(^|\.)youtu\.be$/.test(host)) {
    const id = path.replace(/^\//, '').split('/')[0]
    if (id) {
      host = 'www.youtube.com'
      path = '/watch'
      params.set('v', id)
    }
  } else if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
    // `music.` is a different extractor with different formats — leave it be.
    if (!/^music\./.test(host)) host = 'www.youtube.com'
    const short = path.match(/^\/(shorts|live|embed|v)\/([\w-]{6,})/)
    if (short) {
      path = '/watch'
      params.set('v', short[2])
    }
    // `t=90` is "start playing here", never part of the file we fetch.
    params.delete('t')
    params.delete('start_radio')
    params.delete('index')
    params.delete('pp')
  }

  // ---- TikTok -----------------------------------------------------------
  else if (/(^|\.)tiktok\.com$/.test(host)) {
    // Short share hosts (vm./vt.) redirect to the real page — leave them alone.
    if (!/^(vm|vt)\./.test(host)) host = 'www.tiktok.com'
    // Everything TikTok puts in the query string is analytics.
    for (const key of [...params.keys()]) params.delete(key)
    path = path.replace(/\/photo\//, '/video/')
  }

  // ---- Instagram --------------------------------------------------------
  else if (/(^|\.)instagram\.com$/.test(host)) {
    host = 'www.instagram.com'
    path = path.replace(/^\/reels\//, '/reel/')
    for (const key of [...params.keys()]) params.delete(key)
  }

  // ---- X / Twitter ------------------------------------------------------
  else if (/(^|\.)(twitter|x)\.com$/.test(host)) {
    host = host.replace(MOBILE_PREFIXES, '')
    if (!/^www\./.test(host)) host = `www.${host}`
    // `/i/status/123` and `/user/status/123` are the same post.
    for (const key of [...params.keys()]) params.delete(key)
  }

  // ---- Reddit / VK / OK / Twitch / Facebook -----------------------------
  else if (/(^|\.)reddit\.com$/.test(host)) {
    host = 'www.reddit.com'
  } else if (/(^|\.)vk\.(com|ru)$/.test(host)) {
    host = host.replace(MOBILE_PREFIXES, '')
  } else if (/(^|\.)(ok\.ru|odnoklassniki\.ru)$/.test(host)) {
    host = host.replace(MOBILE_PREFIXES, '')
  } else if (/(^|\.)twitch\.tv$/.test(host)) {
    host = host.replace(MOBILE_PREFIXES, 'www.')
  } else if (/(^|\.)(facebook\.com|fb\.watch)$/.test(host)) {
    host = host.replace(MOBILE_PREFIXES, 'www.')
  } else {
    // Everything else: only drop the mobile prefix, which is safe because the
    // desktop host is what every one of these sites canonicalises to itself.
    host = host.replace(/^m\.(?=[\w-]+\.[\w-]{2,})/i, '')
  }

  url.hostname = host
  url.pathname = path
  /*
    A fragment is usually an anchor or a start time — `#t=42`, `#comments` —
    and dropping it is what makes two links to the same video compare equal.
    But a single-page site can route on it, and there `#/watch/123` *is* the
    address: stripping it would turn a link to a video into a link to the
    site's front page. Anything that looks like a route stays.
  */
  if (!/^#!?\//.test(url.hash)) url.hash = ''
  url.search = params.toString() ? `?${params.toString()}` : ''

  // A trailing slash on a path that carries an id is noise, not structure.
  let out = url.toString()
  if (!url.search && /\/[\w-]{2,}\/$/.test(url.pathname)) out = out.replace(/\/$/, '')
  return out
}

/** Path shapes that name one specific video, whatever else is in the URL. */
const SINGLE_ITEM =
  /\/(watch|video|videos|shorts|reel|reels|clip|clips|status|episode|embed|movie|film)\/|\/watch$|[?&]v=[\w-]+/i

/**
 * Whether a link points at a playlist / channel / set worth expanding into a
 * pickable list rather than treating as one video.
 */
export function looksLikeCollection(url: string): boolean {
  const normalized = normalizeUrl(url)

  /*
    A link straight to a media file is never a collection, whatever it is
    called. The canonical name for an HLS manifest is `playlist.m3u8`, and
    `/playlist` matched anywhere in the path — so pasting a stream URL spent a
    whole flat-playlist probe against the engine, with its own two-minute
    ceiling, before the real work could start.
  */
  if (/\.(m3u8|mpd|mp4|m4v|webm|mov|flv|mkv|mp3|m4a|aac|ogg|opus|flac|wav|ts)(\?|#|$)/i.test(normalized)) {
    return false
  }

  // A link to one specific video that merely happens to sit inside a playlist
  // (youtube.com/watch?v=…&list=…) is a single video — expanding it into the
  // whole playlist would be the opposite of what the user asked for.
  if (/[?&]v=[\w-]+/i.test(normalized)) return false
  if (SINGLE_ITEM.test(normalized) && !/[?&]list=/i.test(normalized)) return false

  // `/playlists?` needs to end a path segment: bare `/playlist` also matched
  // `playlist.m3u8`, `playlist_720.m3u8` and every other CDN variant of it.
  return /[?&]list=|\/playlists?(?:[/?#]|$)|\/channel\/|\/@[\w.-]+\/?$|\/user\/[\w.-]+\/?$|\/(c|channels)\/[\w.-]+\/?$|\/sets\/|\/album\/|\/videos\/?$|\/streams\/?$/i.test(
    normalized
  )
}

/**
 * Sites that keep their videos behind a login or an age gate often enough that
 * "add cookies" is the first thing worth suggesting when one of them fails.
 */
const COOKIE_HUNGRY =
  /(^|\.)(instagram\.com|facebook\.com|fb\.watch|twitter\.com|x\.com|patreon\.com|udemy\.com|coursera\.org|linkedin\.com|nicovideo\.jp|bilibili\.com|weibo\.com|pornhub\.com|xvideos\.com|xhamster\.com|onlyfans\.com|crunchyroll\.com)$/i

export function needsCookiesOften(url: string): boolean {
  try {
    return COOKIE_HUNGRY.test(new URL(normalizeUrl(url)).hostname)
  } catch {
    return false
  }
}
