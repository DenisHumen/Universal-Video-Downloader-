import { spawn } from 'child_process'
import { ytdlpBinaryPath, ytdlpSpawnOptions } from './ytdlp'
import { getSettings } from './settings'
import { killTree } from './process'
import { accessArgs, classifyYtdlpError, hasCookies, headerArgs, stalledConnecting } from './options'
import { resolveUniversal, resolveUrl, scrapeStatic, type ResolvedUrl, type StaticScrape } from '../resolvers'
import { withSignal } from '../resolvers/http'
import { unreachableCode } from '../resolvers/neterror'
import { engineKnowsHost, isAbsoluteUrl, looksLikeCollection, normalizeUrl } from '@shared/urls'
import { cleanListingDepth } from '@shared/playlist'
import { reportDetectFailure, type DetectVerdict } from './report'
import { infoKey, infoReusable } from './info-cache'
import { infoCache } from './info-store'
import { browserCookiesFile } from './browser-logins'
import type { DetectTrace } from '@shared/report'
import type {
  AppErrorCode,
  DetectOptions,
  DetectResult,
  DetectStage,
  FormatKind,
  MediaInfo,
  PlaylistEntry,
  StreamingInfo,
  VideoFormat
} from '@shared/types'

export interface RawFormat {
  format_id: string
  ext?: string
  vcodec?: string
  acodec?: string
  width?: number
  height?: number
  fps?: number
  tbr?: number
  vbr?: number
  abr?: number
  filesize?: number
  filesize_approx?: number
  format_note?: string
  resolution?: string
  dynamic_range?: string
  protocol?: string
  language?: string | null
  language_preference?: number | null
}

interface RawInfo {
  _type?: string
  id?: string
  title?: string
  description?: string
  thumbnail?: string
  thumbnails?: { url: string }[]
  duration?: number
  duration_string?: string
  uploader?: string
  channel?: string
  webpage_url?: string
  original_url?: string
  url?: string
  extractor_key?: string
  extractor?: string
  /** On a flat-playlist entry: the extractor that will handle it. */
  ie_key?: string
  is_live?: boolean
  view_count?: number
  formats?: RawFormat[]
  entries?: RawInfo[]
  playlist_count?: number
  subtitles?: Record<string, unknown>
  automatic_captions?: Record<string, unknown>
}

/** What the engine lists among subtitles that nobody could read as subtitles: a stream's chat, say. */
const NOT_SUBTITLES = /^(live_chat|rechat|danmaku|comments?)$/i

/** The language codes in the engine's subtitle map. Bounded, because the map is the site's data. */
export function subtitleCodes(map: Record<string, unknown> | undefined): string[] {
  return Object.keys(map || {})
    .filter((code) => !NOT_SUBTITLES.test(code))
    .slice(0, 200)
}

export type StageReporter = (stage: DetectStage) => void

/**
 * A resolver threw.
 *
 * When the wording matches something the app knows how to explain, the code
 * travels too and the UI can say it in the user's language. When it doesn't,
 * the resolver's own sentence goes through untouched: it knows more about the
 * site than any rule matching a substring of it ever will.
 */
function errorResult(err: unknown): DetectResult {
  const raw = err instanceof Error ? err.message : String(err)
  const { code, message, cookieHint } = classifyYtdlpError(raw, hasCookies(getSettings(), browserCookiesFile()))
  return { ok: false, error: code ? message : raw, errorCode: code, cookieHint }
}

function canceled(): { ok: false; error: string; errorCode: AppErrorCode } {
  return { ok: false, error: 'Detection canceled.', errorCode: 'canceled' }
}

const VIDEO_EXT = /^(mp4|m4v|webm|mkv|mov|flv|ts|3gp|ogv|avi)$/i
const AUDIO_EXT = /^(mp3|m4a|aac|opus|ogg|oga|flac|wav|weba)$/i

/**
 * What a format carries.
 *
 * A missing codec means "not reported", not "none". Coub's video formats and a
 * plain direct .mp4 come with no codecs at all, and were dropped as unknown -
 * so Coub offered audio only, and a direct link fell through to the hidden
 * browser and lost its title. Video is inferred from the container, an HLS
 * protocol or a frame size; audio only when both codecs are missing, so a
 * format with a known video codec keeps being merged with the best audio.
 */
export function formatKind(f: RawFormat): FormatKind {
  if (f.ext === 'mhtml') return 'unknown' // storyboards
  const vNone = f.vcodec === 'none'
  const aNone = f.acodec === 'none'
  const vKnown = f.vcodec != null && !vNone
  const aKnown = f.acodec != null && !aNone
  const looksVideo =
    VIDEO_EXT.test(f.ext ?? '') || Boolean(f.protocol?.startsWith('m3u8')) || Boolean(f.width || f.height)
  const hasVideo = vKnown || (!vNone && f.vcodec == null && looksVideo)
  const hasAudio =
    aKnown ||
    (!aNone && f.acodec == null && f.vcodec == null && (hasVideo || AUDIO_EXT.test(f.ext ?? '')))
  if (hasVideo && hasAudio) return 'video+audio'
  if (hasVideo) return 'video'
  if (hasAudio) return 'audio'
  return 'unknown'
}

function resolutionLabel(f: RawFormat): string {
  if (f.height) return `${f.height}p${f.fps && f.fps > 30 ? Math.round(f.fps) : ''}`
  if (f.resolution && f.resolution !== 'audio only') return f.resolution
  if (formatKind(f) === 'audio') return 'audio'
  return f.format_note || '—'
}

export function mapFormats(formats: RawFormat[] = []): VideoFormat[] {
  return formats
    .filter((f) => {
      const kind = formatKind(f)
      if (kind === 'unknown') return false
      // Drop storyboards / images.
      if (f.ext === 'mhtml') return false
      return true
    })
    .map((f) => ({
      id: f.format_id,
      ext: f.ext || '—',
      kind: formatKind(f),
      resolution: resolutionLabel(f),
      height: f.height,
      width: f.width,
      fps: f.fps,
      vcodec: f.vcodec && f.vcodec !== 'none' ? f.vcodec : undefined,
      acodec: f.acodec && f.acodec !== 'none' ? f.acodec : undefined,
      abr: f.abr,
      vbr: f.vbr,
      tbr: f.tbr,
      filesize: f.filesize,
      filesizeApprox: f.filesize_approx,
      formatNote: f.format_note,
      dynamicRange: f.dynamic_range,
      language: f.language || undefined,
      languagePreference: f.language_preference ?? undefined
    }))
    .sort((a, b) => {
      const kindRank = (k: FormatKind): number => (k === 'video+audio' ? 2 : k === 'video' ? 1 : 0)
      if ((b.height || 0) !== (a.height || 0)) return (b.height || 0) - (a.height || 0)
      if (kindRank(b.kind) !== kindRank(a.kind)) return kindRank(b.kind) - kindRank(a.kind)
      return (b.tbr || 0) - (a.tbr || 0)
    })
}

function pickThumbnail(info: RawInfo): string | undefined {
  if (info.thumbnail) return info.thumbnail
  if (info.thumbnails && info.thumbnails.length) {
    return info.thumbnails[info.thumbnails.length - 1].url
  }
  return undefined
}

/** A streaming site's picker (translator → episodes → quality) in place of a format list. */
function pickerInfo(
  s: StreamingInfo,
  extractor: string | undefined,
  webpageUrl: string,
  originalUrl: string
): MediaInfo {
  return {
    id: s.id,
    title: s.title,
    thumbnail: s.thumbnail,
    webpageUrl,
    originalUrl,
    extractor: extractor || s.provider,
    isLive: false,
    formats: [],
    streaming: s
  }
}

export async function detect(
  input: string,
  onStage: StageReporter = () => undefined,
  signal?: AbortSignal,
  options: DetectOptions = {}
): Promise<DetectResult> {
  const settings = getSettings()
  /*
    Canonicalise first, and use only the canonical form from here on.

    Every share button on the web hands out a different shape for the same
    video — `youtu.be/ID?si=…`, `/shorts/ID`, a TikTok link with six analytics
    parameters stapled to it. `wasRewritten` below compares the resolver's
    output against this string to decide whether a custom resolver actually
    changed anything, so normalising afterwards would make every one of those
    links look rewritten and skip both the playlist expansion and the universal
    fallback.
  */
  const url = normalizeUrl(input)
  // Anything else would reach the engine's URL slot; see `isAbsoluteUrl`.
  if (!isAbsoluteUrl(url)) {
    return { ok: false, error: 'This is not a link the app can open.', errorCode: 'notALink' }
  }
  /*
    What this run tried, for the error report if it ends in one. Filled in only
    from what the steps below learn anyway: a report describes the attempt that
    failed, it never re-runs anything to describe itself.
  */
  const trace: DetectTrace = {}

  onStage('resolving')
  let resolved: ResolvedUrl
  try {
    resolved = await resolveUrl(url, { signal })
  } catch (err) {
    if (signal?.aborted) return canceled()
    trace.resolverThrew = true
    const raw = err instanceof Error ? err.message : String(err)
    return reportDetectFailure({ ...errorResult(err), raw }, url, trace)
  }
  /*
    A cancel during the resolve stage - seconds long on resolver-backed sites -
    used to change nothing. The probe below attaches its abort listener to a
    signal that has already fired, and a listener added after the fact never
    runs: the engine went on probing for up to two minutes after the user had
    given up on it.
  */
  if (signal?.aborted) return canceled()
  trace.resolver = resolved.extractor

  // A streaming site (translator/episode/quality selection) — present its picker.
  if (resolved.streaming) {
    return { ok: true, info: pickerInfo(resolved.streaming, resolved.extractor, url, url) }
  }

  // A custom resolver found a playlist/listing — present its entries directly.
  if (resolved.isPlaylist) {
    const entries = resolved.entries || []
    if (!entries.length) {
      return reportDetectFailure(
        { ok: false, error: 'No videos found on this page.', errorCode: 'emptyPage' },
        url,
        trace
      )
    }
    return {
      ok: true,
      info: {
        id: 'playlist',
        title: resolved.playlistTitle || 'Playlist',
        webpageUrl: url,
        originalUrl: url,
        extractor: resolved.extractor || 'generic',
        isLive: false,
        formats: [],
        isPlaylist: true,
        playlistCount: entries.length,
        entries
      }
    }
  }

  const wasRewritten = resolved.url !== url.trim()
  if (wasRewritten) trace.resolvedUrl = resolved.url

  // Collections (playlists, channels, sets) expand into a pickable list.
  if (!wasRewritten && looksLikeCollection(url)) {
    onStage('engine')
    const depth = cleanListingDepth(options.playlistEnd)
    const collection = await probeCollection(url, signal, depth)
    if (collection) return { ok: true, info: collection }
    // A canceled listing also comes back as null; don't carry on to the next stage.
    if (signal?.aborted) return canceled()
    // "Load More" asked for this list. The card is still showing it; a single-video probe answers nothing.
    if (depth) return { ok: false, error: 'Could not list more of this playlist.' }
  }

  onStage(wasRewritten ? 'probing' : 'engine')
  const head = wasRewritten || options.prefetch ? null : headStartScrape(url, signal)
  const probe = await probeWithEngine(resolved, signal)
  // The engine answered; the scrape it raced is not needed.
  if (probe.ok && probe.info) head?.abort()
  /*
    Kept for the download that usually follows; see info-cache.ts. Only for a
    link no resolver rewrote: the download re-resolves the page and compares,
    and a rewritten one is fetched with headers this JSON knows nothing of.
  */
  if (probe.ok && probe.json && !wasRewritten && infoReusable(url)) {
    infoCache.put(infoKey(url, settings), probe.json)
  }
  if (probe.ok && probe.info) {
    const info = probe.info
    info.webpageUrl = url
    info.originalUrl = url
    if (resolved.title) info.title = resolved.title
    if (resolved.thumbnail) info.thumbnail = resolved.thumbnail
    if (resolved.extractor) info.extractor = resolved.extractor
    if (resolved.downloadUrl) info.downloadUrl = resolved.downloadUrl
    onStage('done')
    return { ok: true, info }
  }

  // The engine gave up. Fall back to universal detection: scrape the page, and
  // if that isn't enough, open it in a hidden browser and watch for the stream.
  // Never for a prefetch: see DetectOptions. Home detects again if the probe alone was not enough.
  if (!wasRewritten && !options.prefetch && !signal?.aborted && universalCanHelp(probe, { url, browserAllowed: settings.universalFallback })) {
    const tried = { browserAllowed: settings.universalFallback, stages: [] as string[] }
    trace.universal = tried
    let universal: ResolvedUrl | null = null
    try {
      universal = await resolveUniversal(url, {
        scraped: head?.scrape,
        allowBrowser: settings.universalFallback,
        onStage: (stage) => {
          tried.stages.push(stage)
          onStage(stage)
        },
        signal
      })
    } catch (err) {
      /*
        The app's own request could not reach the host either. That is the
        answer, in words that name the host - unless the engine already has a
        better one: to be told "sign in" or "not in your region" it had to
        reach the site, and that diagnosis stands.
      */
      const code = unreachableCode(err)
      const engineHasBetter =
        probe.errorCode !== undefined && probe.errorCode !== 'network' && probe.errorCode !== 'timeout'
      if (code && !engineHasBetter && !signal?.aborted) {
        onStage('done')
        return { ok: false, error: err instanceof Error ? err.message : String(err), errorCode: code }
      }
    }

    /*
      A picker for a player embedded in the page (Kodik). A series' follow
      button goes by webpageUrl, and a watcher re-reads that with resolveUrl
      alone, never this scrape - so for a series it is the player's own
      address, the one link that leads back to the episodes by itself.
    */
    if (universal?.streaming) {
      const s = universal.streaming
      onStage('done')
      return {
        ok: true,
        info: pickerInfo(s, universal.extractor, s.isSeries ? universal.url : url, url)
      }
    }

    if (universal) {
      onStage('probing')
      const second = await probeWithEngine(universal, signal)
      if (second.ok && second.info) {
        const info = second.info
        info.webpageUrl = url
        info.originalUrl = url
        info.extractor = 'Universal'
        info.viaUniversal = true
        info.downloadUrl = universal.downloadUrl
        if (universal.title) info.title = universal.title
        if (universal.thumbnail) info.thumbnail = universal.thumbnail
        if (universal.duration && !info.duration) info.duration = universal.duration
        onStage('done')
        return { ok: true, info }
      }
      // Even without engine metadata the stream itself is downloadable.
      onStage('done')
      return { ok: true, info: syntheticInfo(url, universal) }
    }
  }

  head?.abort()
  onStage('done')
  return reportDetectFailure(probe, url, trace)
}

/**
 * A page scrape started alongside the engine probe, for a host the engine has
 * no extractor of its own for.
 *
 * There the probe is the generic extractor, and when it fails - most of the
 * time, on the sites that get this far - the universal pass started only
 * afterwards and fetched the page from scratch: two slow steps one after the
 * other where nothing made the second wait for the first. The scrape is a
 * single page fetch (and up to three player iframes), so starting it early
 * costs little; whichever side is not needed is aborted, with its own
 * controller so the detect's signal is left alone.
 */
function headStartScrape(
  url: string,
  signal: AbortSignal | undefined
): { scrape: Promise<StaticScrape>; abort: () => void } | null {
  if (signal?.aborted || !/^https?:\/\//i.test(url) || engineKnowsHost(url)) return null
  const controller = new AbortController()
  const forward = (): void => controller.abort()
  signal?.addEventListener('abort', forward, { once: true })
  const scrape = withSignal(controller.signal, () => scrapeStatic(url))
  // Settled either way, so the listener goes and a rejection nobody awaits is not unhandled.
  scrape.then(
    () => signal?.removeEventListener('abort', forward),
    () => signal?.removeEventListener('abort', forward)
  )
  return { scrape, abort: () => controller.abort() }
}

/**
 * Failures that are the site's answer about this video, not the engine's
 * inability to read the page. Scraping the page again can't sign the user in,
 * move them to another country or make a premiere start any sooner.
 */
const DEFINITIVE: ReadonlySet<AppErrorCode> = new Set<AppErrorCode>([
  'unavailable',
  'ageRestricted',
  'rateLimited',
  'signIn',
  'botCheck',
  'cookiesLocked',
  'geo',
  'drm',
  'upcoming',
  'adultHidden'
])

/** Whether the failure is YouTube's, by the engine's extractor name or by the link's host. */
function isYoutube(probe: { output?: string; error?: string }, url?: string): boolean {
  if (/ERROR: \[youtube[\w:]*\]/i.test(probe.output ?? probe.error ?? '')) return true
  try {
    return url ? /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(new URL(url).hostname) : false
  } catch {
    return false
  }
}

/** An engine error that comes from a named site extractor, and says why. */
const NAMED_EXTRACTOR = /ERROR: \[([\w:.-]+)\]/
/** …unless the why is that the extractor itself no longer understands the page. */
const EXTRACTOR_BROKE = /Unable to extract|Unsupported URL|Failed to parse|No video formats found/i

/**
 * Whether the universal pass - a page scrape, then a hidden browser - is worth
 * running after the engine's probe failed.
 *
 * It ran after every failure, so a private or region-locked YouTube video
 * spent another 15-45 s scraping a page that had already said no, and then
 * reported the scrape's vaguer result. It stays for what it is for: a link
 * the engine has no extractor for (`Unsupported URL`, `[generic]`), and an
 * extractor broken by a site redesign, where the stream is still on the page.
 */
export function universalCanHelp(
  probe: { errorCode?: AppErrorCode; output?: string; error?: string },
  context: { url?: string; browserAllowed?: boolean } = {}
): boolean {
  /*
    Behind a login or an age gate the hidden browser is a different visitor
    from the engine: it carries the in-app browser's session, so a site the
    user has signed in to there shows it the video the engine was refused.
    Not YouTube, whose gate the browser meets just the same, and only while
    the browser pass is allowed to run at all.
  */
  if (
    (probe.errorCode === 'signIn' || probe.errorCode === 'ageRestricted') &&
    context.browserAllowed &&
    !isYoutube(probe, context.url)
  ) {
    return true
  }
  if (probe.errorCode && DEFINITIVE.has(probe.errorCode)) return false
  // Unreachable is checked by the pass itself, which can name the host it couldn't reach.
  if (probe.errorCode === 'network' || probe.errorCode === 'timeout') return true
  const said = probe.output ?? probe.error ?? ''
  const named = NAMED_EXTRACTOR.exec(said)?.[1]
  if (named && named.toLowerCase() !== 'generic' && !EXTRACTOR_BROKE.test(said)) return false
  return true
}

/** A minimal MediaInfo for a stream we found but the engine couldn't describe. */
function syntheticInfo(pageUrl: string, resolved: ResolvedUrl): MediaInfo {
  const isHls = /\.m3u8(\?|#|$)/i.test(resolved.url)
  const ext = isHls ? 'mp4' : (resolved.url.split('?')[0].split('.').pop() || 'mp4').slice(0, 4)
  return {
    id: 'universal',
    title: resolved.title || 'Video',
    thumbnail: resolved.thumbnail,
    duration: resolved.duration,
    webpageUrl: pageUrl,
    originalUrl: pageUrl,
    extractor: 'Universal',
    isLive: false,
    viaUniversal: true,
    downloadUrl: resolved.downloadUrl,
    formats: [
      {
        id: 'auto',
        ext,
        kind: 'video+audio',
        resolution: isHls ? 'auto' : 'source'
      }
    ]
  }
}

type JsonProbe =
  /** `text` is the engine's JSON as printed, for `--load-info-json`. */
  | { ok: true; raw: RawInfo; text: string }
  /** `output` is what the engine printed, kept for the error report. */
  | { ok: false; error: string; errorCode?: AppErrorCode; cookieHint?: boolean; output?: string }

function spawnJson(args: string[], signal: AbortSignal | undefined, timeoutMs: number): Promise<JsonProbe> {
  return new Promise((resolve) => {
    /*
      Before spawning, because an abort that has already happened will never
      fire the listener below. Every route here can arrive after a cancel: the
      resolve stage, a canceled collection listing, the universal pass.
    */
    if (signal?.aborted) {
      resolve(canceled())
      return
    }
    const settings = getSettings()
    const child = spawn(ytdlpBinaryPath(), args, ytdlpSpawnOptions())
    let stdout = ''
    let stderr = ''
    let settled = false
    const done = (value: JsonProbe): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // The signal can outlive this probe by a long way; don't keep the child reachable from it.
      signal?.removeEventListener('abort', onAbort)
      resolve(value)
    }

    const timer = setTimeout(() => {
      killTree(child)
      done(
        stalledConnecting(stderr)
          ? {
              ok: false,
              error: 'Could not connect to the site. Check your connection or proxy and try again.',
              errorCode: 'network'
            }
          : {
              ok: false,
              error: 'Detection timed out. The site may be unsupported or unreachable.',
              errorCode: 'timeout'
            }
      )
    }, timeoutMs)

    const onAbort = (): void => {
      killTree(child)
      done(canceled())
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    // As text, decoded across chunk boundaries; the engine writes UTF-8 (`--encoding`).
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d: string) => (stdout += d))
    child.stderr.on('data', (d: string) => (stderr += d))
    child.on('error', (err) => done({ ok: false, error: err.message, output: err.message }))
    child.on('close', (code) => {
      if (code !== 0 || !stdout.trim()) {
        const reason = stderr.trim() || 'Could not detect any media at this URL.'
        const { code: errorCode, message, cookieHint } = classifyYtdlpError(reason, hasCookies(settings, browserCookiesFile()))
        done({ ok: false, error: message, errorCode, cookieHint, output: stderr || undefined })
        return
      }
      try {
        done({ ok: true, raw: JSON.parse(stdout) as RawInfo, text: stdout })
      } catch (err) {
        done({ ok: false, error: err instanceof Error ? err.message : 'Failed to parse media info.' })
      }
    })
  })
}

/**
 * The pickable entries of a flat playlist listing.
 *
 * Only the ones with a `scheme://` address. This list is the site's own data,
 * and each URL in it is queued as-is when the user ticks it - an entry whose
 * "URL" was `--config-locations=…` reached the engine as an option.
 */
export function playlistEntries(raw: RawInfo[]): PlaylistEntry[] {
  return flattenEntries(raw).flatMap((e) => {
    const url = e.webpage_url || e.url
    if (!url || !isAbsoluteUrl(url)) return []
    return [
      {
        url,
        title: e.title || 'Untitled',
        thumbnail: pickThumbnail(e),
        /*
          The entry's own extractor, not the list's. A channel or playlist is
          `YoutubeTab`, its videos are `Youtube` - the name a single video
          detects with - so the list's would put playlist downloads in a
          per-site folder of their own, beside the one the same site's videos
          already go to.
        */
        extractor: e.ie_key || e.extractor_key
      }
    ]
  })
}

/**
 * A listing's entries with nested playlists opened up in place.
 *
 * A channel's front page lists as a playlist of its tabs - Videos, Shorts,
 * Live - each a playlist of its own. Read flat, the listing had two or three
 * "entries" and no videos in it, so the picker was skipped and the full probe
 * went on to extract the whole channel. Bounded, because the nesting is the
 * site's data too.
 */
export function flattenEntries(raw: RawInfo[], depth = 0): RawInfo[] {
  return raw.flatMap((e) =>
    e._type === 'playlist' && Array.isArray(e.entries) && depth < 3
      ? flattenEntries(e.entries, depth + 1)
      : [e]
  )
}

/*
  How long one connection attempt may sit silent while detecting. The engine's
  default is 20 s, and it retries: on a host blocked from this network it was
  still connecting when the 75 s probe cap killed it, so the user got "timed
  out, may be unsupported" instead of the engine's own "connection timed out".
  At 10 s a blocked host fails in about 40 s, inside the cap, with its reason.
*/
const PROBE_SOCKET_TIMEOUT = ['--socket-timeout', '10']

/** Expand a playlist/channel URL into its entries without extracting each one. */
async function probeCollection(url: string, signal?: AbortSignal, depth?: number): Promise<MediaInfo | null> {
  const settings = getSettings()
  const limit = depth ?? settings.playlistLimit
  const args = [
    '-J',
    '--flat-playlist',
    '--no-warnings',
    '--no-progress',
    '--ignore-config',
    '--encoding',
    'utf-8',
    ...PROBE_SOCKET_TIMEOUT,
    '--playlist-end',
    String(limit),
    ...accessArgs(settings, browserCookiesFile()),
    '--',
    url
  ]
  // Listing a big channel is cheap but not instant — give it room, and more the deeper it is asked to go.
  const result = await spawnJson(args, signal, Math.min(600_000, Math.max(120_000, limit * 120)))
  if (!result.ok) return null
  const raw = result.raw
  // The count is checked after flattening: a channel with one tab is one entry deep.
  if (raw._type !== 'playlist' || !raw.entries) return null

  const entries = playlistEntries(raw.entries)
  if (entries.length < 2) return null
  // Before the filtering: an entry with no usable address still counted towards the depth.
  const cut = flattenEntries(raw.entries).length >= limit

  return {
    id: raw.id || 'playlist',
    title: raw.title || 'Playlist',
    thumbnail: pickThumbnail(raw),
    webpageUrl: raw.webpage_url || url,
    originalUrl: url,
    extractor: raw.extractor_key || raw.extractor || 'generic',
    isLive: false,
    formats: [],
    isPlaylist: true,
    playlistCount: raw.playlist_count || entries.length,
    entries,
    ...(cut ? { listingCut: limit } : {})
  }
}

async function probeWithEngine(
  resolved: ResolvedUrl,
  signal?: AbortSignal
): Promise<DetectVerdict & { json?: string }> {
  const settings = getSettings()
  const args = [
    '-J',
    '--no-warnings',
    '--no-playlist',
    '--no-progress',
    '--ignore-config',
    '--encoding',
    'utf-8',
    ...PROBE_SOCKET_TIMEOUT,
    ...accessArgs(settings, browserCookiesFile()),
    ...headerArgs(resolved.headers)
  ]
  if (resolved.referer) args.push('--referer', resolved.referer)
  // Behind `--`, so it can only be read as a URL; see buildArgs in downloader.ts.
  args.push('--', resolved.url)

  const result = await spawnJson(args, signal, 75_000)
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      errorCode: result.errorCode,
      cookieHint: result.cookieHint,
      output: result.output
    }
  }

  const raw = result.raw
  const isPlaylist = raw._type === 'playlist'
  const primary = isPlaylist && raw.entries && raw.entries.length ? raw.entries[0] : raw
  const formats = mapFormats(primary.formats)
  if (!formats.length) {
    // The engine did answer, so the interesting part is what it offered instead.
    const offered = (primary.formats ?? []).map((f) => `${f.format_id} ${f.ext ?? '?'} ${f.protocol ?? ''}`)
    return {
      ok: false,
      error: 'No downloadable formats were found at this link.',
      errorCode: 'noFormats',
      extractor: raw.extractor_key || raw.extractor,
      title: raw.title || primary.title,
      output: offered.length
        ? `engine listed ${offered.length} formats, none usable:\n${offered.slice(0, 60).join('\n')}`
        : 'engine listed no formats at all'
    }
  }

  const info: MediaInfo = {
    id: primary.id || raw.id || 'unknown',
    title: raw.title || primary.title || 'Untitled',
    description: primary.description,
    thumbnail: pickThumbnail(primary) || pickThumbnail(raw),
    duration: primary.duration,
    durationString: primary.duration_string,
    uploader: primary.uploader || primary.channel,
    channel: primary.channel,
    webpageUrl: raw.webpage_url || primary.webpage_url || resolved.url,
    originalUrl: raw.original_url || resolved.url,
    extractor: raw.extractor_key || raw.extractor || primary.extractor || 'generic',
    isLive: Boolean(primary.is_live),
    viewCount: primary.view_count,
    formats,
    subtitleLanguages: subtitleCodes(primary.subtitles),
    autoCaptionLanguages: subtitleCodes(primary.automatic_captions),
    isPlaylist,
    playlistCount: isPlaylist ? raw.playlist_count || raw.entries?.length : undefined
  }
  /*
    One video, not live: the only answer a download can be started from as it
    stands. A playlist's JSON describes its first entry, and a live stream's
    manifest is a moving target.
  */
  const reusable = !isPlaylist && !primary.is_live
  return { ok: true, info, json: reusable ? result.text : undefined }
}
