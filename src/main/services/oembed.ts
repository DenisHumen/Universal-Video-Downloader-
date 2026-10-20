import { net } from 'electron'
import type { DetectPreview } from '@shared/types'
import { oembedEndpoint, readOembed } from './oembed-rules'

/** Past this the engine is probably close to answering itself; a late preview is noise. */
const TIMEOUT_MS = 2_000

/**
 * The title, uploader and poster of a link, from its site's oEmbed endpoint.
 *
 * Asked in parallel with the detect, never instead of it: the card can show
 * what is coming within a few hundred milliseconds while the engine spends
 * its several seconds on formats. Anything that goes wrong - a site not on
 * the list, a private video, a slow answer, a cancel - is simply no preview.
 */
export async function fetchOembed(
  url: string,
  signal?: AbortSignal
): Promise<Omit<DetectPreview, 'url' | 'requestId'> | null> {
  const endpoint = oembedEndpoint(url)
  if (!endpoint || signal?.aborted) return null
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const both = signal ? AbortSignal.any([signal, timeout]) : timeout
  try {
    const response = await net.fetch(endpoint, {
      signal: both,
      headers: { Accept: 'application/json' }
    })
    if (!response.ok) return null
    return readOembed(await response.json())
  } catch {
    return null
  }
}
