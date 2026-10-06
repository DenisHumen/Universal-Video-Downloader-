import { fetchText, pick } from '../http'

/**
 * Aksor: YummyAnime's own player, and for some titles the only one the app can
 * download from. It often carries 1080p where Kodik stops at 720p.
 *
 * The player page is an empty shell whose script asks `/api/video/<hash>` on
 * the same host for the episode. That answer is plain JSON naming one DASH
 * manifest per height - no token, no signature, no Referer it insists on - and
 * the engine reads the manifest as it is. So the whole of downloading an Aksor
 * episode is one GET for the manifest address.
 */

export const AKSOR_REFERER = 'https://player.aksor.tv/'

/** The episode a player address plays: `https://player.aksor.tv/video/<hash>`. */
export function aksorHash(iframeUrl: string): string | undefined {
  return pick(/^(?:https?:)?\/\/player\.aksor\.tv\/video\/([a-z0-9]+)(?:[/?#]|$)/i, iframeUrl.trim())
}

/*
  The keys are names, not numbers. parseInt reads q2k and q4k as 2 and 4, which
  would put a 4K manifest at the bottom of the list and pick it for a 360p
  request - so the heights are spelt out, and only a key that is a plain
  number of lines is read as one.
*/
const HEIGHTS = new Map<string, number>([
  ['q4k', 2160],
  ['q2k', 1440],
  ['q1080', 1080],
  ['q720', 720],
  ['q480', 480],
  ['q360', 360]
])

function heightOf(key: string): number | undefined {
  const known = HEIGHTS.get(key)
  if (known) return known
  const m = /^q(\d{3,4})p?$/i.exec(key)
  return m ? Number(m[1]) : undefined
}

export interface AksorTier {
  height: number
  /** The episode's DASH manifest at that height. */
  url: string
}

/**
 * The heights an episode really comes in, lowest first.
 *
 * The answer lists every height it knows of and sets the ones the episode does
 * not have to null - in practice usually all but one. Those are not offers.
 * Manifest addresses are made from studio names and can carry a space ("JAM
 * CLUB"), so each is written out as a proper URL before anything is handed it.
 */
export function aksorTiers(qualities: Record<string, unknown> | null | undefined): AksorTier[] {
  const tiers: AksorTier[] = []
  for (const [key, value] of Object.entries(qualities ?? {})) {
    if (typeof value !== 'string' || !value.trim()) continue
    const height = heightOf(key)
    if (!height) continue
    try {
      tiers.push({ height, url: new URL(value.trim()).href })
    } catch {
      /* not an address, so not something to download */
    }
  }
  return tiers.sort((a, b) => a.height - b.height)
}

/**
 * The height requested or the nearest below it; failing that the lowest, the
 * closest thing to what was asked for - the rule Kodik's streams follow too.
 */
export function pickAksorTier(tiers: AksorTier[], requested: string): AksorTier | undefined {
  const want =
    requested === 'best' || requested === 'audio' ? Infinity : parseInt(requested, 10) || Infinity
  return tiers.filter((t) => t.height <= want).pop() ?? tiers[0]
}

/** Ask the player which heights one episode comes in. */
export async function aksorEpisode(hash: string, timeout?: number): Promise<AksorTier[]> {
  const raw = await fetchText(
    `https://player.aksor.tv/api/video/${encodeURIComponent(hash)}`,
    { Referer: AKSOR_REFERER, Accept: 'application/json' },
    { timeout }
  )
  return aksorTiers((JSON.parse(raw) as { qualities?: Record<string, unknown> }).qualities)
}
