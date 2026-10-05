import { spawn } from 'child_process'
import { ytdlpBinaryPath, ytdlpSpawnOptions } from './ytdlp'
import { getSettings } from './settings'
import { killTree } from './process'
import { accessArgs, classifyYtdlpError, hasCookies, headerArgs, stalledConnecting } from './options'
import { resolveUniversal, resolveUrl, type ResolvedUrl } from '../resolvers'
import { unreachableCode } from '../resolvers/neterror'
import { isAbsoluteUrl, looksLikeCollection, normalizeUrl } from '@shared/urls'
import type {
  AppErrorCode,
  DetectResult,
  DetectStage,
  FormatKind,
  MediaInfo,
  PlaylistEntry,
  VideoFormat
} from '@shared/types'

interface RawFormat {
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
  is_live?: boolean
  view_count?: number
  formats?: RawFormat[]
  entries?: RawInfo[]
  playlist_count?: number
  subtitles?: Record<string, unknown>
}

export type StageReporter = (stage: DetectStage) => void

/**
 * A resolver threw.
 *
 * When the wording matches something the app knows how to explain, the code
 * travels too and the UI can say it in the user's language. When it doesn't —
 * "this translation requires Premium", say — the resolver's own sentence goes
 * through untouched: it knows more about the site than any rule matching a
 * substring of it ever will.
 */
function errorResult(err: unknown): DetectResult {
  const raw = err instanceof Error ? err.message : String(err)
  const { code, message, cookieHint } = classifyYtdlpError(raw, hasCookies(getSettings()))
  return { ok: false, error: code ? message : raw, errorCode: code, cookieHint }
}

function canceled(): { ok: false; error: string; errorCode: AppErrorCode } {
  return { ok: false, error: 'Detection canceled.', errorCode: 'canceled' }
}

function formatKind(f: RawFormat): FormatKind {
  const hasVideo = f.vcodec && f.vcodec !== 'none'
  const hasAudio = f.acodec && f.acodec !== 'none'
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

function mapFormats(formats: RawFormat[] = []): VideoFormat[] {
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
      dynamicRange: f.dynamic_range
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

export async function detect(
  input: string,
  onStage: StageReporter = () => undefined,
  signal?: AbortSignal
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

  onStage('resolving')
  let resolved: ResolvedUrl
  try {
    resolved = await resolveUrl(url, { signal })
  } catch (err) {
    if (signal?.aborted) return canceled()
    return errorResult(err)
  }
  /*
    A cancel during the resolve stage - seconds long on resolver-backed sites -
    used to change nothing. The probe below attaches its abort listener to a
    signal that has already fired, and a listener added after the fact never
    runs: the engine went on probing for up to two minutes after the user had
    given up on it.
  */
  if (signal?.aborted) return canceled()

  // A streaming site (translator/episode/quality selection) — present its picker.
  if (resolved.streaming) {
    const s = resolved.streaming
    const info: MediaInfo = {
      id: s.id,
      title: s.title,
      thumbnail: s.thumbnail,
      webpageUrl: url,
      originalUrl: url,
      extractor: resolved.extractor || s.provider,
      isLive: false,
      formats: [],
      streaming: s
    }
    return { ok: true, info }
  }

  // A custom resolver found a playlist/listing — present its entries directly.
  if (resolved.isPlaylist) {
    const entries = resolved.entries || []
    if (!entries.length) {
      return { ok: false, error: 'No videos found on this page.', errorCode: 'emptyPage' }
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

  // Collections (playlists, channels, sets) expand into a pickable list.
  if (!wasRewritten && looksLikeCollection(url)) {
    onStage('engine')
    const collection = await probeCollection(url, signal)
    if (collection) return { ok: true, info: collection }
    // A canceled listing also comes back as null; don't carry on to the next stage.
    if (signal?.aborted) return canceled()
  }

  onStage(wasRewritten ? 'probing' : 'engine')
  const probe = await probeWithEngine(resolved, signal)
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
  if (!wasRewritten && !signal?.aborted) {
    let universal: ResolvedUrl | null = null
    try {
      universal = await resolveUniversal(url, {
        allowBrowser: settings.universalFallback,
        onStage: (stage) => onStage(stage),
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

  onStage('done')
  return probe
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
  | { ok: true; raw: RawInfo }
  | { ok: false; error: string; errorCode?: AppErrorCode; cookieHint?: boolean }

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
    child.on('error', (err) => done({ ok: false, error: err.message }))
    child.on('close', (code) => {
      if (code !== 0 || !stdout.trim()) {
        const reason = stderr.trim() || 'Could not detect any media at this URL.'
        const { code: errorCode, message, cookieHint } = classifyYtdlpError(reason, hasCookies(settings))
        done({ ok: false, error: message, errorCode, cookieHint })
        return
      }
      try {
        done({ ok: true, raw: JSON.parse(stdout) as RawInfo })
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
  return raw.flatMap((e) => {
    const url = e.webpage_url || e.url
    if (!url || !isAbsoluteUrl(url)) return []
    return [{ url, title: e.title || 'Untitled', thumbnail: pickThumbnail(e) }]
  })
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
async function probeCollection(url: string, signal?: AbortSignal): Promise<MediaInfo | null> {
  const settings = getSettings()
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
    String(settings.playlistLimit),
    ...accessArgs(settings),
    '--',
    url
  ]
  // Listing a big channel is cheap but not instant — give it room.
  const result = await spawnJson(args, signal, 120_000)
  if (!result.ok) return null
  const raw = result.raw
  if (raw._type !== 'playlist' || !raw.entries || raw.entries.length < 2) return null

  const entries = playlistEntries(raw.entries)
  if (entries.length < 2) return null

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
    entries
  }
}

async function probeWithEngine(resolved: ResolvedUrl, signal?: AbortSignal): Promise<DetectResult> {
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
    ...accessArgs(settings),
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
      cookieHint: result.cookieHint
    }
  }

  const raw = result.raw
  const isPlaylist = raw._type === 'playlist'
  const primary = isPlaylist && raw.entries && raw.entries.length ? raw.entries[0] : raw
  const formats = mapFormats(primary.formats)
  if (!formats.length) {
    return {
      ok: false,
      error: 'No downloadable formats were found at this link.',
      errorCode: 'noFormats'
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
    subtitleLanguages: Object.keys(primary.subtitles || {}).slice(0, 24),
    isPlaylist,
    playlistCount: isPlaylist ? raw.playlist_count || raw.entries?.length : undefined
  }
  return { ok: true, info }
}
