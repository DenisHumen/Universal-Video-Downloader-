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
    /*
      A channel's front page is a shelf of tabs, not a list of videos. The
      engine's flat listing of it came back as nested tab playlists, the
      collection probe found nothing it could pick from, and the full probe
      then extracted the whole channel - 75 s and more before the universal
      fallback took over. Its Videos tab is what a person pasting a channel
      means, and the engine lists that in a couple of seconds.
    */
    const channel = path.match(
      /^\/(@[\w.%-]+|channel\/UC[\w-]+|c\/[\w.%-]+|user\/[\w.%-]+)\/?(?:featured\/?)?$/
    )
    if (channel && !/^music\./.test(host)) path = `/${channel[1]}/videos`
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
  }

  // ---- YummyAnime -------------------------------------------------------
  /*
    yummy-anime.ru and yani.tv are the site's old addresses, and both still
    redirect a title page to yummyani.me. Old bookmarks and share links carry
    them, and nothing recognised them: no picker, just the slow generic path,
    and the duplicate check saw two titles where there was one. The path guard
    is what keeps api.yani.tv, the site's own API, out of this.
  */
  else if (
    /^(?:[\w-]+\.)*(?:yummy-anime\.ru|yani\.tv)$/.test(host) &&
    /^\/catalog\/item\//.test(path)
  ) {
    host = 'yummyani.me'
  }

  // ---- Telegram ---------------------------------------------------------
  /*
    The engine knows a post only as t.me/<channel>/<post>. telegram.me is
    "Unsupported URL" to it, and the /s/ preview of the same post is read as a
    generic page: a playlist of the same file twice, with no title or length.
    `?single` stays, because it is what asks for one file of an album, and the
    engine reads it with or without a value. A channel's /s/ feed has no post
    to point at, and /c/ links are private channels; both are left as they are.
  */
  else if (/^(?:www\.)?(?:telegram\.(?:me|dog)|t\.me)$/.test(host)) {
    host = 't.me'
    const post = path.match(/^\/s\/(\w+)\/(\d+)\/?$/)
    if (post) path = `/${post[1]}/${post[2]}`
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

/**
 * Whether a string is a `scheme://` address, and so safe to hand the engine as
 * the thing to download.
 *
 * Anything else in that slot was read as something else. A value starting with
 * `-` is an option as far as yt-dlp is concerned - `--version` queued as a
 * download printed the version and "completed" - and yt-dlp has options that
 * read files and run commands. Such values reach the queue from more places
 * than the address box: playlist entries are copied out of the site's own JSON,
 * and a `uvd-direct://` payload is decoded from a string anyone can write.
 *
 * Deliberately not an http(s) whitelist: rtmp, rtsp and mms links are real
 * inputs the engine handles, and the app's own `uvd-*://` links pass as well.
 */
export function isAbsoluteUrl(input: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(input)
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

/*
  Hosts the engine has a dedicated extractor for and that people paste every
  day. Not the engine's whole list - that is well over a thousand sites and
  changes with every release - only the ones where fetching the page for a
  scrape in parallel with the probe would be wasted traffic: the extractor
  answers, and when it doesn't, the page has nothing a scrape could find.
*/
const ENGINE_HOSTS =
  /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|vimeo\.com|tiktok\.com|instagram\.com|facebook\.com|fb\.watch|twitter\.com|x\.com|reddit\.com|redd\.it|twitch\.tv|dailymotion\.com|dai\.ly|soundcloud\.com|bandcamp\.com|vk\.com|vk\.ru|vkvideo\.ru|ok\.ru|rutube\.ru|bilibili\.com|nicovideo\.jp|t\.me|kick\.com|rumble\.com|streamable\.com|imgur\.com|pinterest\.com|tumblr\.com|coub\.com|mixcloud\.com|archive\.org|ted\.com|bbc\.co\.uk|9gag\.com|threads\.net|bsky\.app)$/i

/**
 * Whether the link is on a host the engine is known to handle by name.
 * Anything else is read by its generic extractor, which can take as long to
 * give up as it takes the page scrape to find the video.
 */
export function engineKnowsHost(url: string): boolean {
  try {
    return ENGINE_HOSTS.test(new URL(normalizeUrl(url)).hostname)
  } catch {
    return false
  }
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
