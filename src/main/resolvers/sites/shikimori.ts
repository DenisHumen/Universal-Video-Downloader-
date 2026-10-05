import { app } from 'electron'
import { fetchText } from '../http'
import type { ResolvedUrl, SiteResolver } from '../types'
import { searchYani, streamingFromId, type YaniSearchItem } from './yummyani'

/**
 * Shikimori is the tracker most Russian anime fans keep their lists on, and
 * its links get shared more than any player's. It plays nothing itself, so the
 * engine calls a title page "Unsupported URL". The same title is usually on
 * YummyAnime, which the app already downloads from: a Shikimori link opens
 * that title's YummyAnime picker.
 *
 * Only /animes/: manga and ranobe have nothing to play. Some ids carry a
 * letter in front (`/animes/z52991-…`), and the slug after the number is
 * decoration. shikimori.one and .me are the site's older names, still on old
 * links; the API is always asked at .io, which is the one that answers now.
 */
export const SHIKIMORI_ANIME =
  /^https?:\/\/(?:www\.)?shikimori\.(?:one|io|me)\/animes\/[a-z]?(\d+)/i

const API = 'https://shikimori.io/api/animes/'

/** Said in words, because the resolver passes anything shaped like "HTTP 404" over in silence. */
export const NOT_ON_YUMMY =
  "This title isn't available on YummyAnime, where Shikimori links are downloaded from."

export interface ShikimoriAnime {
  id: number
  name?: string | null
  russian?: string | null
  english?: (string | null)[] | null
}

/*
  Shikimori's API rules ask a client to name itself rather than pass for a
  browser. A function, because `app` exists only inside Electron and the tests
  import this module without it.
*/
function userAgent(): string {
  return `UniversalVideoDownloader/${app.getVersion()}`
}

/** The Shikimori id in a title link, or undefined when the link is not one. */
export function shikimoriId(url: string): number | undefined {
  const m = SHIKIMORI_ANIME.exec(url)
  return m ? Number(m[1]) : undefined
}

/**
 * The names to search yani.tv by, in the order worth trying.
 *
 * The romanised name first: searched by the Russian title, Frieren came back
 * with nothing at all. The search answers with five titles at most, so a name
 * that brings up five other seasons first needs a second wording, not a longer
 * list.
 */
export function searchNames(anime: ShikimoriAnime): string[] {
  const out: string[] = []
  for (const name of [anime.name, anime.english?.[0], anime.russian]) {
    const clean = name?.trim()
    if (clean && !out.includes(clean)) out.push(clean)
  }
  return out
}

/**
 * The search hit that is this very title, by the Shikimori id yani.tv files
 * against it, or undefined.
 *
 * Never the closest name. A search for Frieren answers with the series, its
 * second season, a set of chibi specials and a later arc, all under nearly the
 * same title; a near match would quietly open a different season.
 */
export function pickByShikimoriId(items: YaniSearchItem[], id: number): YaniSearchItem | undefined {
  return items.find((it) => Number(it.remote_ids?.shikimori_id) === id)
}

async function resolveAnime(url: string): Promise<ResolvedUrl> {
  const id = shikimoriId(url)
  if (id === undefined) return { url }
  /*
    A Shikimori failure is an HTTP status and falls back like any resolver's;
    only "found the title, but not on YummyAnime" is a real answer.
  */
  const anime = JSON.parse(
    await fetchText(`${API}${id}`, { 'User-Agent': userAgent(), Accept: 'application/json' })
  ) as ShikimoriAnime
  for (const name of searchNames(anime)) {
    const hit = pickByShikimoriId(await searchYani(name), id)
    if (hit) return streamingFromId(String(hit.anime_id), url)
  }
  throw new Error(NOT_ON_YUMMY)
}

export const shikimoriResolvers: SiteResolver[] = [
  { id: 'Shikimori', match: SHIKIMORI_ANIME, resolve: resolveAnime }
]
