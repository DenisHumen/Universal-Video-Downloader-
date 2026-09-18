import { resolveUrl } from '../../resolvers'
import { NotReleasedError } from '../../resolvers/upcoming'
import { log } from '../log'
import { episodeKey, newEpisodes, type EpisodeRef, type Watch } from '@shared/automation'
import type { StreamingInfo } from '@shared/types'

/**
 * Asking a site what episodes exist, and turning one of them into something the
 * download queue understands.
 *
 * Both built-in resolvers already return the whole season/episode structure
 * from one entry point, so a watcher needs no scraping of its own — only the
 * discipline about *which* list to read.
 */

/** What the "add a watch" screen needs to offer a choice. */
export interface SeriesDescription {
  url: string
  title: string
  thumbnail?: string
  provider: string
  translators: { id: string; name: string; premium?: boolean }[]
  defaultTranslator: string
  qualities: string[]
  /** Episodes for each translator, which is what a watch actually compares. */
  episodesFor: (translatorId: string) => EpisodeRef[]
  /** Set when nothing is out yet: there are no dubs to offer, only a date. */
  upcoming?: { releaseAt?: number }
}

function flatten(seasons: { season: number; episodes: number[] }[]): EpisodeRef[] {
  const out: EpisodeRef[] = []
  for (const s of seasons ?? []) {
    for (const episode of s.episodes ?? []) out.push({ season: s.season, episode })
  }
  return out
}

/**
 * The episodes a particular dub actually has.
 *
 * Not the series-level list, and this is the single most important line in the
 * feature. Measured on a live series: the default dub had eight episodes while
 * others on the same show had five, four, three and two. A watch set to a short
 * dub, compared against the series list, would be told six episodes were new
 * and would then fail six times downloading episodes that do not exist for the
 * translation it was asked for.
 */
export function episodesForTranslator(info: StreamingInfo, translatorId: string): EpisodeRef[] {
  const per = info.episodesByTranslator?.[translatorId]
  return flatten(per ?? info.seasons)
}

/** Look at a page and describe what could be watched there. */
export async function describeSeries(url: string): Promise<SeriesDescription> {
  let resolved
  try {
    resolved = await resolveUrl(url)
  } catch (err) {
    /*
      Not out yet is a perfectly good thing to follow - arguably the best one,
      since it is the release nobody wants to keep checking for by hand. There
      are no dubs to list, so none is offered; the watch picks one when there is
      something to pick from.
    */
    if (err instanceof NotReleasedError) {
      return {
        url,
        title: err.title,
        thumbnail: err.thumbnail,
        provider: 'yummyani',
        translators: [],
        defaultTranslator: '',
        qualities: ['360p', '480p', '720p'],
        episodesFor: () => [],
        upcoming: { releaseAt: err.releaseAt }
      }
    }
    throw err
  }
  const info = resolved.streaming
  if (!info) {
    throw new Error('That page is not a series this app can follow.')
  }
  if (!info.isSeries) {
    throw new Error('That is a single video, not a series — there is nothing to wait for.')
  }
  return {
    url,
    title: info.title,
    thumbnail: info.thumbnail,
    provider: info.provider,
    translators: info.translators.map((t) => ({ id: t.id, name: t.name, premium: t.premium })),
    defaultTranslator: info.defaultTranslator,
    qualities: info.qualities,
    episodesFor: (translatorId: string) => episodesForTranslator(info, translatorId)
  }
}

export interface CheckResult {
  /** Episodes present now that this watch has not handled. */
  fresh: EpisodeRef[]
  /** Everything the chosen dub currently has, for updating `seen`. */
  available: EpisodeRef[]
  title: string
  thumbnail?: string
  translatorName?: string
  /** Still not out. `releaseAt` is the site's current guess, which moves. */
  notOut?: { releaseAt?: number }
  /** A watch that was waiting has something to follow now: the dub it should take. */
  adopt?: { translatorId: string; translatorName?: string }
}

/**
 * Ask the site what it has now.
 *
 * A watcher differs from a one-off download in what it does with a bad answer.
 * A person who pastes a link and sees an error tries something else; a watcher
 * running at four in the morning has to decide whether this was "not out yet",
 * "the site is having a bad day" or "this series is over" — and the only wrong
 * move is to treat any of them as a reason to stop looking. So this throws for
 * a genuine failure and returns an empty list for "nothing new", and the caller
 * distinguishes them.
 */
export async function checkWatch(watch: Watch): Promise<CheckResult> {
  let resolved
  try {
    resolved = await resolveUrl(watch.url)
  } catch (err) {
    // "Not yet" is an answer, not a failure: nothing to back off from.
    if (err instanceof NotReleasedError) {
      return {
        fresh: [],
        available: [],
        title: err.title,
        thumbnail: err.thumbnail,
        notOut: { releaseAt: err.releaseAt }
      }
    }
    throw err
  }
  const info = resolved.streaming
  if (!info) {
    throw new Error('The page no longer looks like a series.')
  }

  /*
    A watch added before release has no dub, because there was none to choose.
    Now there is: take the one the resolver opens on, which is the fullest, and
    treat everything it has as new - nothing was out when this watch was made,
    so nothing can already have been seen.
  */
  if (watch.pending) {
    const translatorId = info.defaultTranslator
    const available = episodesForTranslator(info, translatorId)
    const translatorName = info.translators.find((t) => t.id === translatorId)?.name
    log.info('watcher', 'A title this watch was waiting for is out', {
      id: watch.id.slice(0, 8),
      series: info.title,
      episodes: available.length
    })
    return {
      fresh: available,
      available,
      title: info.title,
      thumbnail: info.thumbnail,
      translatorName,
      adopt: { translatorId, translatorName }
    }
  }

  const available = episodesForTranslator(info, watch.translatorId)
  /*
    A translator that has gone away is worth saying out loud rather than
    silently falling back to the default one, which would start downloading a
    different dub than the user chose.
  */
  if (available.length === 0 && !info.episodesByTranslator?.[watch.translatorId]) {
    const known = info.translators.some((t) => t.id === watch.translatorId)
    if (!known) {
      throw new Error('The translation this watch follows is no longer listed on the page.')
    }
  }

  const fresh = newEpisodes(watch.seen, available)
  if (fresh.length) {
    log.info('watcher', `Found ${fresh.length} new episode(s)`, {
      id: watch.id.slice(0, 8),
      series: info.title,
      episodes: fresh.map(episodeKey).join(',')
    })
  }

  return {
    fresh,
    available,
    title: info.title,
    thumbnail: info.thumbnail,
    translatorName: info.translators.find((t) => t.id === watch.translatorId)?.name
  }
}

/**
 * The internal URL that downloads one episode.
 *
 * The two providers do not agree on shape, and neither should be assumed. For
 * yummyani the translator id *is* a season — it decodes to a player URL for one
 * season — so the episode number stands alone. Rezka names the season
 * separately.
 */
export function downloadUrlFor(watch: Watch, ref: EpisodeRef): string {
  const quality = encodeURIComponent(watch.quality || 'best')
  if (watch.provider === 'yummyani') {
    return `uvd-yummy://${watch.translatorId}/${ref.episode}/${quality}`
  }
  if (watch.provider === 'rezka') {
    /*
      `uvd-rezka://<host>/<id>/<translatorId>/<season>/<episode>/<quality>`. The
      host and id are carried in the watch's own URL, which is why a rezka watch
      stores them at creation rather than parsing them here every time.
      Unreachable today: rezka is not serving parseable pages to a plain client,
      so no rezka watch can currently be created.
    */
    const rest = watch.url.replace(/^uvd-rezka:\/\//, '')
    return `uvd-rezka://${rest}/${ref.season}/${ref.episode}/${quality}`
  }
  throw new Error(`No way to download an episode from ${watch.provider}.`)
}
