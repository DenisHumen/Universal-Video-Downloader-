import { accessArgs } from '../options'
import { holdJarCopy } from '../browser-logins'
import { flattenEntries, pickThumbnail, PROBE_SOCKET_TIMEOUT, spawnJson, type JsonProbe, type RawInfo } from '../detector'
import { getSettings } from '../settings'
import { engineUnavailable } from '../ytdlp'
import { log } from '../log'
import { isAbsoluteUrl, normalizeUrl } from '@shared/urls'
import {
  asRef,
  CHANNEL_WINDOW,
  keepsNewestLast,
  siftUploads,
  type ListedUpload
} from '@shared/channel'
import type { EpisodeRef, Watch } from '@shared/automation'

/**
 * Asking the engine what a channel or a playlist lists.
 *
 * Flat, and only the near end: a listing asks the site for a page of titles
 * rather than opening each video, which is what makes looking every few hours
 * affordable, on a channel of thousands of videos as on one of ten.
 */

/** What a look at a list found. */
export interface Listing {
  /** What to call it: the channel's name, or the playlist's. `{channel}` and the Library's group go by this. */
  name: string
  thumbnail?: string
  /** How long the whole list is, when the site says. */
  count?: number
  /** One list per tab of the page, in the site's order. */
  lists: ListedUpload[][]
}

/*
  What the engine calls something that is not over. `post_live` is a stream that
  has ended and not yet become a video: fetched now, it would fail or be cut short.
*/
const NOT_OVER = /^(is_live|is_upcoming|post_live)$/

/** The moment an entry was published, when a listing says. Most flat listings do not. */
function publishedAt(e: RawInfo): number | undefined {
  if (e.timestamp) return e.timestamp * 1000
  const day = /^(\d{4})(\d{2})(\d{2})$/.exec(e.upload_date ?? '')
  return day ? Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : undefined
}

/**
 * One listing entry, or nothing if it cannot be followed.
 *
 * The id is what a watch remembers. A feed's entries come with none, and their
 * address stands in for it, without the note the engine smuggles into the
 * fragment for itself - which is also not something to hand back to it later.
 */
export function listedUpload(e: RawInfo): ListedUpload | undefined {
  const address = (e.webpage_url || e.url || '').replace(/#__youtubedl_smuggle=.*$/, '')
  if (!address || !isAbsoluteUrl(address)) return undefined
  return {
    id: e.id || address,
    url: address,
    title: e.title || 'Untitled',
    ...(e.is_live || NOT_OVER.test(e.live_status ?? '') ? { live: true } : {}),
    ...(publishedAt(e) ? { at: publishedAt(e) } : {})
  }
}

/** A page's lists: each tab of a channel apart, so each keeps its own newest. */
function tabsOf(entries: RawInfo[], depth = 0): RawInfo[][] {
  const nested = entries.filter((e) => e._type === 'playlist' && Array.isArray(e.entries))
  if (!nested.length || depth >= 3) return [flattenEntries(entries)]
  const flat = entries.filter((e) => !nested.includes(e))
  return [
    ...nested.flatMap((tab) => tabsOf(tab.entries ?? [], depth + 1)),
    ...(flat.length ? [flat] : [])
  ]
}

/** A channel's page goes by the channel, not by "<name> - Videos". A playlist has a name of its own. */
export function listName(raw: RawInfo, url: string): string {
  const isChannel = Boolean(raw.channel_id) && raw.id === raw.channel_id
  return (isChannel && raw.channel) || raw.title || raw.channel || raw.uploader || url
}

async function readList(url: string, slice: string[]): Promise<Extract<JsonProbe, { ok: true }>> {
  const settings = getSettings()
  const trouble = await engineUnavailable()
  if (trouble) throw new Error(trouble.error)
  const jar = holdJarCopy(settings)
  const args = [
    '-J',
    '--flat-playlist',
    '--no-warnings',
    '--no-progress',
    '--ignore-config',
    '--encoding',
    'utf-8',
    ...PROBE_SOCKET_TIMEOUT,
    ...slice,
    ...accessArgs(settings, jar.file),
    '--',
    url
  ]
  const result = await spawnJson(args, undefined, 120_000).finally(jar.release)
  if (!result.ok) {
    /*
      The engine's classified sentence, so a bot check or a sign-in wall lands on
      the watch saying what it is: the watcher counts it as a failed check, backs
      off, and a person who opens the screen can read why.
    */
    throw new Error(result.error)
  }
  return result
}

function toListing(raw: RawInfo, url: string): Listing {
  return {
    name: listName(raw, url),
    thumbnail: pickThumbnail(raw),
    count: raw.playlist_count || undefined,
    lists: tabsOf(raw.entries ?? []).map((tab) =>
      tab.flatMap((e) => {
        const upload = listedUpload(e)
        return upload ? [upload] : []
      })
    )
  }
}

const NEAR_END = ['--playlist-end', String(CHANNEL_WINDOW)]
const FAR_END = ['--playlist-items', `-${CHANNEL_WINDOW}:`]

/**
 * The window of a list where its new uploads turn up.
 *
 * The near end says how long the list is, and for most lists is all there is to
 * read. A playlist that keeps its newest last and is longer than the window has
 * its new ones past the far end of that, so the far end is read too - which means
 * paging through the whole list, so only when `lastCount` says it has grown.
 */
export async function listUploads(
  url: string,
  newestLast: boolean | undefined,
  lastCount?: number
): Promise<Listing & { unchanged?: boolean }> {
  const { raw } = await readList(url, NEAR_END)
  if (raw._type !== 'playlist' || !raw.entries) {
    throw new Error('That is a single video, not a series, channel or playlist — there is nothing to wait for.')
  }
  const near = toListing(raw, url)
  if (!newestLast) return near
  const seenWhole = near.count !== undefined && near.count <= CHANNEL_WINDOW
  if (seenWhole) return near
  if (near.count !== undefined && near.count === lastCount) return { ...near, lists: [], unchanged: true }
  return farEnd(url, near)
}

/** The other end of a list whose near end has been read, which is the better source for its name and length. */
async function farEnd(url: string, near: Listing): Promise<Listing> {
  const { raw } = await readList(url, FAR_END)
  return { ...toListing(raw, url), name: near.name, thumbnail: near.thumbnail, count: near.count }
}

/** What the add dialog offers for a list. */
export interface ChannelOffer {
  /** Everything on the window, finished uploads only, in the list's order. */
  entries: EpisodeRef[]
  /** Live or scheduled right now: not there yet, and coming. */
  waiting: EpisodeRef[]
  newestLast: boolean
  count?: number
}

export interface ChannelDescription extends ChannelOffer {
  name: string
  thumbnail?: string
}

const NOT_A_LIST = 'That page is not a series, channel or playlist this app can follow.'

/**
 * Look at a link as a list to follow.
 *
 * Anything but a list is refused here, in words that say which: a page the
 * engine cannot read as anything is one thing, a page with one video on it
 * another, and a list with nothing on it a third. The last is refused because a
 * listing that comes back empty may just be the site's bad minute, and a watch
 * made from it would have no idea what was already there.
 */
export async function describeChannel(url: string): Promise<ChannelDescription> {
  const target = normalizeUrl(url)
  if (!isAbsoluteUrl(target)) throw new Error('This is not a link the app can open.')
  const first = await listUploads(target, undefined).catch((err) => {
    const why = err instanceof Error ? err.message : String(err)
    throw new Error(/could not find a downloadable video|could not detect any media/i.test(why) ? NOT_A_LIST : why)
  })
  const all = first.lists.flat()
  if (!all.length) throw new Error('No videos found on this page.')
  const newestLast = keepsNewestLast(target, first.lists.length === 1 ? all : [])
  // Only now is it known that this list's new end is the far one.
  const listing =
    newestLast && first.count !== undefined && first.count > CHANNEL_WINDOW ? await farEnd(target, first) : first
  const entries = listing.lists.flat()
  return {
    name: listing.name,
    thumbnail: listing.thumbnail,
    count: first.count,
    newestLast,
    entries: entries.filter((e) => !e.live).map(asRef),
    waiting: entries.filter((e) => e.live).map(asRef)
  }
}

/** What one check of a channel came to, ready for the watcher to write down. */
export interface ChannelCheck {
  name: string
  thumbnail?: string
  fresh: EpisodeRef[]
  available: EpisodeRef[]
  patch: Partial<Watch>
  changed: boolean
}

/** Read a followed list and sort what is on it. */
export async function checkChannel(watch: Watch): Promise<ChannelCheck> {
  const listing = await listUploads(watch.url, watch.newestLast, watch.listCount)
  const sifted = siftUploads(watch, listing.lists)
  if (sifted.fresh.length || sifted.old.length) {
    log.info('watcher', 'Listed a followed channel or playlist', {
      id: watch.id.slice(0, 8),
      series: listing.name,
      fresh: sifted.fresh.length,
      older: sifted.old.length
    })
  }
  if (sifted.changed) {
    log.warn('watcher', 'A followed list changed beyond recognition; nothing on it was queued', {
      id: watch.id.slice(0, 8),
      series: listing.name
    })
  }
  return {
    name: listing.name,
    thumbnail: listing.thumbnail,
    fresh: sifted.fresh,
    available: listing.lists.flat().map(asRef),
    changed: sifted.changed,
    patch: {
      seen: sifted.old.length ? [...watch.seen, ...sifted.old] : watch.seen,
      owed: sifted.owed.length ? sifted.owed : undefined,
      listCount: listing.count
    }
  }
}

/**
 * Whether an upload is still going on, by asking about it alone.
 *
 * A flat listing rarely says - YouTube's does, most sites' do not - and queuing a
 * stream as an ordinary download holds a slot for hours and saves part of it. So
 * one more question about each new upload, right before it would be fetched
 * anyway. If it cannot be answered the download goes ahead, and fails with a
 * better reason than this could give.
 */
export async function stillGoingOn(url: string): Promise<boolean> {
  const settings = getSettings()
  const jar = holdJarCopy(settings)
  const args = [
    '-J',
    '--no-warnings',
    '--no-playlist',
    '--no-progress',
    '--ignore-config',
    '--encoding',
    'utf-8',
    ...PROBE_SOCKET_TIMEOUT,
    ...accessArgs(settings, jar.file),
    '--',
    url
  ]
  const result = await spawnJson(args, undefined, 75_000).finally(jar.release)
  if (!result.ok) return result.errorCode === 'upcoming' || result.errorCode === 'notLive'
  return Boolean(result.raw.is_live) || NOT_OVER.test(result.raw.live_status ?? '')
}
