import { normalizeUrl } from '@shared/urls'
import type { DetectPreview } from '@shared/types'

/*
  The pure half of oembed.ts: which sites are asked, and how their answer is
  read. Kept apart from the fetch so it can be tested without Electron.

  An allowlist, not oEmbed discovery. Discovery means fetching the page to
  find its <link rel="alternate">, which is the slow request this exists to
  get ahead of - and it would send every pasted link, including private
  ones, to whatever endpoint the page names. These five publish a fixed
  endpoint, answer in well under a second, and are pasted far more than
  anything else.
*/
const PROVIDERS: { host: RegExp; endpoint: (url: string) => string }[] = [
  {
    host: /(^|\.)youtube\.com$/,
    endpoint: (url) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`
  },
  {
    host: /(^|\.)vimeo\.com$/,
    endpoint: (url) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`
  },
  {
    host: /(^|\.)dailymotion\.com$/,
    endpoint: (url) =>
      `https://www.dailymotion.com/services/oembed?format=json&url=${encodeURIComponent(url)}`
  },
  {
    host: /(^|\.)soundcloud\.com$/,
    endpoint: (url) => `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`
  },
  {
    host: /(^|\.)tiktok\.com$/,
    endpoint: (url) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`
  }
]

/** The oEmbed address to ask about this link, or null when its site is not on the list. */
export function oembedEndpoint(input: string): string | null {
  const link = normalizeUrl(input)
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  // YouTube Music answers with the song's video, which is not what is about to be detected.
  if (/^music\./.test(url.hostname)) return null
  const provider = PROVIDERS.find((p) => p.host.test(url.hostname))
  return provider ? provider.endpoint(link) : null
}

/** A short string from the answer, or nothing: it is the site's JSON, and it reaches the window. */
function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
  return trimmed ? trimmed.slice(0, max) : undefined
}

/** What the card can show from an oEmbed answer, or null when it holds nothing usable. */
export function readOembed(json: unknown): Omit<DetectPreview, 'url' | 'requestId'> | null {
  if (!json || typeof json !== 'object') return null
  const o = json as Record<string, unknown>
  const title = text(o.title, 300)
  const author = text(o.author_name, 120)
  const rawThumb = text(o.thumbnail_url, 2000)
  // Only an https image: the renderer's CSP allows nothing else from outside.
  const thumbnail = rawThumb && /^https:\/\//i.test(rawThumb) ? rawThumb : undefined
  if (!title && !thumbnail) return null
  return { title, author, thumbnail }
}
