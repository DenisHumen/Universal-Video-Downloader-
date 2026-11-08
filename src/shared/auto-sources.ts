import { looksLikeCollection, normalizeUrl } from './urls'

/**
 * Automatic downloads: which copied links may start one by themselves.
 *
 * A download nobody pressed a button for has to be sure of what it is doing, so
 * being on a known site is not enough: copying youtube.com, a channel or a
 * search page must do nothing. Every source says what a link to one video looks
 * like, by host and path.
 *
 * Sites the app has a picker for (HDrezka, YummyAnime, AniLiberty) are not here
 * on purpose. They need a voiceover and an episode chosen, which is a decision
 * only the user can make; a watched series is how those download by themselves.
 */

export interface AutoSource {
  /** Stored in settings: never rename one, or the user's switch for it is lost. */
  id: string
  /** The site's own name, the same in every language. */
  name: string
  /** Hosts, each matching its subdomains too. */
  hosts: string[]
  /** Whether a path (with its query) on those hosts is one video. */
  isVideo: (pathAndQuery: string, host: string) => boolean
}

const path = (re: RegExp) => (p: string): boolean => re.test(p)

export const AUTO_SOURCES: readonly AutoSource[] = [
  {
    id: 'youtube',
    name: 'YouTube',
    hosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'],
    isVideo: (p, host) =>
      host === 'youtu.be'
        ? /^\/[\w-]{6,}/.test(p)
        : /^\/watch\?(?:.*&)?v=[\w-]+/.test(p) || /^\/(?:shorts|live|embed)\/[\w-]+/.test(p)
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    hosts: ['tiktok.com'],
    isVideo: (p, host) => /^\/@[^/]+\/video\/\d+/.test(p) || /^\/t\/\w+/.test(p) || (/^(vm|vt)\./.test(host) && /^\/\w+/.test(p))
  },
  {
    id: 'instagram',
    name: 'Instagram',
    hosts: ['instagram.com'],
    isVideo: path(/^\/(?:[\w.]+\/)?(?:reel|reels|p|tv)\/[\w-]+/)
  },
  {
    id: 'facebook',
    name: 'Facebook',
    hosts: ['facebook.com', 'fb.watch'],
    isVideo: (p, host) =>
      host === 'fb.watch' ? /^\/[\w-]+/.test(p) : /^\/watch\/?\?(?:.*&)?v=\d+/.test(p) || /\/(?:videos|reel)\/[\w.-]+/.test(p) || /^\/share\/[vr]\//.test(p)
  },
  { id: 'x', name: 'X (Twitter)', hosts: ['x.com', 'twitter.com'], isVideo: path(/^\/[^/]+\/status\/\d+/) },
  {
    id: 'reddit',
    name: 'Reddit',
    hosts: ['reddit.com', 'redd.it'],
    isVideo: (p, host) => (host === 'redd.it' ? /^\/\w+/.test(p) : /^\/r\/[^/]+\/(?:comments|s)\/\w+/.test(p))
  },
  {
    id: 'twitch',
    name: 'Twitch',
    hosts: ['twitch.tv'],
    isVideo: (p, host) => host.startsWith('clips.') ? /^\/[\w-]+/.test(p) : /^\/videos\/\d+/.test(p) || /^\/[^/]+\/(?:clip|video)\/[\w-]+/.test(p)
  },
  { id: 'vimeo', name: 'Vimeo', hosts: ['vimeo.com'], isVideo: path(/^\/(?:channels\/[^/]+\/|groups\/[^/]+\/videos\/)?\d+/) },
  {
    id: 'dailymotion',
    name: 'Dailymotion',
    hosts: ['dailymotion.com', 'dai.ly'],
    isVideo: (p, host) => (host === 'dai.ly' ? /^\/\w+/.test(p) : /^\/video\/\w+/.test(p))
  },
  {
    id: 'vk',
    name: 'VK',
    hosts: ['vk.com', 'vk.ru', 'vkvideo.ru'],
    isVideo: path(/^\/(?:video|clip)-?\d+_\d+|[?&]z=(?:video|clip)-?\d+_\d+/)
  },
  { id: 'ok', name: 'Одноклассники', hosts: ['ok.ru'], isVideo: path(/^\/(?:video|live)\/\d+/) },
  { id: 'rutube', name: 'Rutube', hosts: ['rutube.ru'], isVideo: path(/^\/(?:video|shorts)\/(?:private\/)?[\da-f]{16,}/i) },
  { id: 'bilibili', name: 'Bilibili', hosts: ['bilibili.com'], isVideo: path(/^\/video\/(?:BV|av)\w+/i) },
  { id: 'niconico', name: 'Niconico', hosts: ['nicovideo.jp'], isVideo: path(/^\/watch\/\w+/) },
  {
    id: 'kick',
    name: 'Kick',
    hosts: ['kick.com'],
    isVideo: path(/^\/(?:video\/[\w-]+|[^/]+\/(?:videos|clips)\/[\w-]+)/)
  },
  { id: 'rumble', name: 'Rumble', hosts: ['rumble.com'], isVideo: path(/^\/v[\w-]+(?:\.html)?/) },
  { id: 'streamable', name: 'Streamable', hosts: ['streamable.com'], isVideo: path(/^\/\w+\/?$/) },
  { id: 'coub', name: 'Coub', hosts: ['coub.com'], isVideo: path(/^\/view\/\w+/) },
  { id: 'soundcloud', name: 'SoundCloud', hosts: ['soundcloud.com'], isVideo: path(/^\/[^/]+\/(?!sets\/|tracks\/?$|likes\/?$|albums\/?$|reposts\/?$|popular-tracks\/?$)[^/?]+/) }
]

/** The known site a link is on, whatever kind of page it is. */
export function knownSiteFor(url: string): AutoSource | null {
  let parsed: URL
  try {
    parsed = new URL(normalizeUrl(url))
  } catch {
    return null
  }
  if (!/^https?:$/.test(parsed.protocol)) return null
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  return AUTO_SOURCES.find((s) => s.hosts.some((h) => host === h || host.endsWith(`.${h}`))) ?? null
}

/** The source a link is a single video on, or null: an unknown site, or that site's home page, channel or search. */
export function autoSourceFor(url: string): AutoSource | null {
  let parsed: URL
  try {
    parsed = new URL(normalizeUrl(url))
  } catch {
    return null
  }
  if (!/^https?:$/.test(parsed.protocol)) return null
  if (looksLikeCollection(url)) return null
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  const pathAndQuery = parsed.pathname + parsed.search
  for (const source of AUTO_SOURCES) {
    if (!source.hosts.some((h) => host === h || host.endsWith(`.${h}`))) continue
    return source.isVideo(pathAndQuery, host) ? source : null
  }
  return null
}

export type CopiedLinkAction =
  /** Start it without asking. */
  | 'download'
  /** Show the clipboard strip, which only suggests. */
  | 'offer'
  | 'ignore'

export interface CopiedLinkContext {
  autoDownload: boolean
  /** Sources switched off. Off rather than on, so a source added later starts enabled. */
  autoDownloadOff: string[]
  clipboardWatch: boolean
  /** Links already in the queue or finished, in canonical form. */
  known: ReadonlySet<string>
}

/**
 * What to do with a link just copied.
 *
 * A link already handled is ignored rather than offered: copying a finished
 * video's link again, to send it to someone, must not fetch it a second time.
 */
export function copiedLinkAction(url: string, ctx: CopiedLinkContext): CopiedLinkAction {
  if (ctx.autoDownload) {
    const source = autoSourceFor(url)
    if (source && !ctx.autoDownloadOff.includes(source.id)) {
      return ctx.known.has(normalizeUrl(url)) ? 'ignore' : 'download'
    }
  }
  return ctx.clipboardWatch ? 'offer' : 'ignore'
}
