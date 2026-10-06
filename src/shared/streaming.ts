import type { StreamingInfo } from './types'

export type StreamProvider = StreamingInfo['provider']

/** What the episode picker calls each provider. */
export const PROVIDER_NAMES: Record<StreamProvider, string> = {
  rezka: 'HDrezka',
  yummyani: 'YummyAnime',
  kodik: 'Kodik',
  aniliberty: 'AniLiberty'
}

/**
 * The queue address that downloads one episode, or the film when no episode is
 * given, in the shape that provider's resolver reads.
 *
 * The picker used to choose between two shapes with a ternary wherever it built
 * one, so a third provider fell through to whichever side was "else" and queued
 * rezka addresses for something that is not rezka. A provider added to the
 * union has to be given a case here before anything compiles.
 *
 * For YummyAnime and Kodik the translator id is a player's own address, one
 * dub of one season - or, for a YummyAnime dub on Aksor, the title and dub -
 * so the episode number is all that is added to it. AniLiberty's is the
 * release's alias, for the same reason.
 *
 * A film on AniLiberty is one episode whose number need not be one, so with no
 * episode given its address takes the number the picker was given.
 */
export function streamUrl(
  s: Pick<StreamingInfo, 'provider' | 'host' | 'id'> & Partial<Pick<StreamingInfo, 'seasons'>>,
  translatorId: string,
  quality: string,
  at?: { season: number; episode: number }
): string {
  switch (s.provider) {
    case 'rezka':
      return at
        ? `uvd-rezka://${s.host}/${s.id}/${translatorId}/${at.season}/${at.episode}/${quality}`
        : `uvd-rezka://${s.host}/${s.id}/${translatorId}/movie/0/${quality}`
    case 'yummyani':
      return `uvd-yummy://${translatorId}/${at?.episode ?? 1}/${quality}`
    case 'kodik':
      return `uvd-kodik://${translatorId}/${at?.episode ?? 1}/${quality}`
    case 'aniliberty':
      return `uvd-anilib://${translatorId}/${at?.episode ?? s.seasons?.[0]?.episodes[0] ?? 1}/${quality}`
  }
}
