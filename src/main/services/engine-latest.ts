import { net } from 'electron'
import { engineIsOlder, type EngineFreshness } from '@shared/engine-version'
import { getVersion } from './ytdlp'
import { withProxyAuth } from './proxy-auth'
import { log } from './log'

/**
 * Whether a newer stable engine than this one is out.
 *
 * For "Update and Retry", which only makes sense when there is something newer to
 * update to: a site that has changed gets fixed in the engine first, and the
 * scheduled refresh can be up to a day behind that. Read from where the releases
 * page redirects to, which is a single request, with no API key and no rate limit
 * worth the name, and which only ever names a stable release.
 */

const LATEST_PAGE = 'https://github.com/yt-dlp/yt-dlp/releases/latest'

/** How long an answer stands. A row that fails again need not ask again, and neither need the twenty rows beside it. */
const KEEP_MS = 60 * 60 * 1000
/** A failure to ask is forgotten sooner: it is probably this machine's network, which comes back. */
const KEEP_FAILURE_MS = 5 * 60 * 1000

/** The release a redirect to the latest one names. */
export function tagFromUrl(url: string): string | undefined {
  return /\/releases\/tag\/([\w.-]+)/.exec(url)?.[1]
}

function askLatest(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const request = withProxyAuth(net.request({ url: LATEST_PAGE, redirect: 'manual' }), LATEST_PAGE)
    const done = (tag?: string): void => {
      clearTimeout(timer)
      resolve(tag)
    }
    const timer = setTimeout(() => {
      request.abort()
      done()
    }, 15_000)
    request.on('redirect', (_status, _method, url) => {
      request.abort()
      done(tagFromUrl(url))
    })
    request.on('response', () => done())
    request.on('error', () => done())
    request.end()
  })
}

let kept: { latest?: string; until: number } | undefined

/** Forget the answer, for the moment an update has changed it. */
export function forgetLatest(): void {
  kept = undefined
}

/**
 * The verdict. "Not older" is also what it says when either side is unknown: the
 * offer is only worth making when it can be kept.
 */
export async function engineFreshness(
  ask: () => Promise<string | undefined> = askLatest,
  current: () => Promise<string | undefined> = getVersion,
  now = Date.now()
): Promise<EngineFreshness> {
  if (!kept || now >= kept.until) {
    const latest = await ask().catch(() => undefined)
    if (!latest) log.info('engine', 'Could not tell which engine release is the latest')
    kept = { latest, until: now + (latest ? KEEP_MS : KEEP_FAILURE_MS) }
  }
  const version = await current().catch(() => undefined)
  return { current: version, latest: kept.latest, older: engineIsOlder(version, kept.latest) }
}
