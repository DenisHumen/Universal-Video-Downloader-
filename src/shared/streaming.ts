import type { StreamingInfo } from './types'

export type StreamProvider = StreamingInfo['provider']

/** What the episode picker calls each provider. */
export const PROVIDER_NAMES: Record<StreamProvider, string> = {
  rezka: 'HDrezka',
  yummyani: 'YummyAnime',
  kodik: 'Kodik'
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
 * dub of one season, so the episode number is all that is added to it.
 */
export function streamUrl(
  s: Pick<StreamingInfo, 'provider' | 'host' | 'id'>,
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
  }
}
