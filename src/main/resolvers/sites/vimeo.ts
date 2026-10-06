import type { ResolvedUrl, SiteResolver } from '../types'

/**
 * One Vimeo video by its page address: `vimeo.com/<id>`, with the hash an
 * unlisted link carries either as a second path segment or as `?h=`, and
 * whatever else the share button added (`?share=copy`).
 *
 * Showcases, channels, groups and user pages do not start with a number, so
 * they stay the engine's business; it lists them, and a channel's own video
 * address already works.
 */
export const VIMEO_VIDEO =
  /^https?:\/\/(?:www\.)?vimeo\.com\/(\d+)(?:\/([0-9a-f]{6,}))?\/?(?:\?[^#]*)?$/i

/**
 * The embedded player's address for a vimeo.com video link, or undefined when
 * the link is not one.
 *
 * The engine reads vimeo.com pages through Vimeo's web client, which now
 * refuses anyone not logged in, public videos included: every one failed as
 * "the web client only works when logged-in", and the user was told the video
 * needed them to sign in. The embedded player still serves the same video
 * anonymously — the engine's own player.vimeo.com path, titles, formats and
 * all. An unlisted video needs its hash there as well, and only as `?h=`.
 */
export function vimeoPlayerUrl(url: string): string | undefined {
  const m = VIMEO_VIDEO.exec(url)
  if (!m) return undefined
  const hash = m[2] || new URL(url).searchParams.get('h')
  const query = hash && /^[0-9a-f]+$/i.test(hash) ? `?h=${hash}` : ''
  return `https://player.vimeo.com/video/${m[1]}${query}`
}

/*
  No `extractor`: the resolver's id stands in, and it is the engine's own name
  for the site, so a queued video is labelled exactly as before.

  Cookies are not a reason to skip this. A cookie file or browser set for some
  other site is no evidence of a Vimeo session, and without one the web client
  refuses public videos too; the cookies still travel with the player request.
*/
async function resolveVideo(url: string): Promise<ResolvedUrl> {
  const player = vimeoPlayerUrl(url)
  return player ? { url: player, referer: 'https://vimeo.com/' } : { url }
}

export const vimeoResolvers: SiteResolver[] = [
  { id: 'Vimeo', match: VIMEO_VIDEO, resolve: resolveVideo }
]
