import { resolveUrl } from '../../resolvers'
import { anilibStreamUrl } from '../../resolvers/sites/aniliberty'
import { rezkaEpisodes, rezkaEpisodeUrl } from '../../resolvers/sites/rezka'
import { NotReleasedError } from '../../resolvers/upcoming'
import { log } from '../log'
import { episodeKey, newEpisodes, type EpisodeRef, type Watch } from '@shared/automation'
import type { StreamingInfo } from '@shared/types'

/**
 * Asking a site what episodes exist, and turning one of them into something the
 * download queue understands.
 *
 * The streaming resolvers already return the whole season/episode structure
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
 *
 * A provider that lists episodes per dub never falls back to the series list,
 * not even for a dub it no longer lists. That fallback was the same mistake by
 * another road: a dub whose player moved read the default dub's episodes,
 * queued every one it had not seen under the dead id, failed them all - and the
 * watch looked healthy, because nothing had thrown. An id that is not in the
 * map has no episodes, and `checkWatch` says so out loud.
 */
export function episodesForTranslator(info: StreamingInfo, translatorId: string): EpisodeRef[] {
  if (info.episodesByTranslator) return flatten(info.episodesByTranslator[translatorId] ?? [])
  return flatten(info.seasons)
}

const DUB_GONE = 'The translation this watch follows is no longer listed on the page.'

/**
 * Make sure `info` knows the episodes of the dub a watch follows.
 *
 * Yummyani answers with every dub's list at once. A rezka page lists only the
 * dub it opens on, and the series list stood in for every other — which is the
 * mistake described above. Measured on one series: 63 episodes in the page's
 * dub, 62 in each of three others. A watch on a slower dub would be told of an
 * episode its dub does not have yet, fail to download it, and mark it handled
 * like any failure, so it would never be fetched once the dub caught up.
 *
 * So a rezka check asks for the chosen dub's own list: one request more, every
 * time. Asking only when the dub differs from the page's would save it, but the
 * resolver moves its default off a Premium dub the page may well open on, so
 * which list the page shows is not something the result can say.
 */
export async function withEpisodesOf(
  info: StreamingInfo,
  translatorId: string
): Promise<StreamingInfo> {
  if (info.provider !== 'rezka' || !info.isSeries || !translatorId) return info
  /*
    Said here because the caller cannot: with no list of its own, a dub that has
    gone would read the series list and be followed as if nothing had changed.
  */
  if (!info.translators.some((t) => t.id === translatorId)) throw new Error(DUB_GONE)
  const seasons = await rezkaEpisodes(info.host, info.id, translatorId)
  return {
    ...info,
    episodesByTranslator: { ...info.episodesByTranslator, [translatorId]: seasons }
  }
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
        provider: err.provider ?? 'yummyani',
        translators: [],
        defaultTranslator: '',
        qualities: err.qualities ?? ['360p', '480p', '720p'],
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
  /**
   * The dub the watch should follow from now on: the one a waiting watch takes
   * once something is out, or the new id of a followed dub the site moved.
   */
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
  const page = resolved.streaming
  if (!page) {
    throw new Error('The page no longer looks like a series.')
  }
  const info = watch.pending ? page : await withEpisodesOf(page, watch.translatorId)

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

  let translatorId = watch.translatorId
  let adopt: CheckResult['adopt']
  /*
    A translator that has gone away is worth saying out loud rather than
    silently falling back to the default one, which would start downloading a
    different dub than the user chose. The watch gets the error, backs off and
    shows a red dot, and nothing is queued.

    Unless it has only moved. A yummyani dub's id is its player's address, so
    the same dub on a new player arrives under a new id with the old name. Exactly
    one dub by that name is taken to be it; none, or several - one dub can run
    on several players - is the error.
  */
  const listed =
    info.translators.some((t) => t.id === translatorId) ||
    Boolean(info.episodesByTranslator?.[translatorId])
  if (!listed) {
    const same = watch.translatorName
      ? info.translators.filter((t) => t.name === watch.translatorName)
      : []
    if (same.length !== 1) {
      throw new Error(DUB_GONE)
    }
    translatorId = same[0].id
    adopt = { translatorId, translatorName: same[0].name }
  }

  const available = episodesForTranslator(info, translatorId)
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
    translatorName: info.translators.find((t) => t.id === translatorId)?.name,
    adopt
  }
}

/**
 * The internal URL that downloads one episode.
 *
 * The providers do not agree on shape, and none should be assumed. For
 * yummyani and a pasted Kodik player the translator id *is* a season — it
 * decodes to a player URL for one season, or for a YummyAnime dub on Aksor to
 * the title and dub — so the episode number stands alone. An AniLiberty
 * release has one season and one dub, whose id is the release's alias.
 * Rezka names the season separately.
 */
export function downloadUrlFor(watch: Watch, ref: EpisodeRef): string {
  const quality = encodeURIComponent(watch.quality || 'best')
  if (watch.provider === 'yummyani') {
    return `uvd-yummy://${watch.translatorId}/${ref.episode}/${quality}`
  }
  if (watch.provider === 'kodik') {
    return `uvd-kodik://${watch.translatorId}/${ref.episode}/${quality}`
  }
  if (watch.provider === 'aniliberty') {
    return anilibStreamUrl(watch.translatorId, ref.episode, watch.quality || 'best')
  }
  if (watch.provider === 'rezka') {
    /*
      `uvd-rezka://<host>/<id>/<translatorId>/<season>/<episode>/<quality>`,
      with the host and title id read from the page address the watch keeps.
      This used to splice that whole address in where the host and id belong,
      and leave the translator out, while rezka was unreachable and no rezka
      watch could be made: the first episode one found would have been queued
      as a link nothing could resolve.
    */
    return rezkaEpisodeUrl(watch.url, watch.translatorId, ref.season, ref.episode, watch.quality)
  }
  throw new Error(`No way to download an episode from ${watch.provider}.`)
}
