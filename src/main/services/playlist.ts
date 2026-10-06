import { join } from 'path'
import type { PlaylistPlace } from '@shared/types'
import { playlistFolderName } from '@shared/playlist'

/*
  How an entry picked from a playlist or channel is named and filed.

  Each entry runs as its own download with `--no-playlist`, so the engine has
  no idea it belongs to a list: `%(playlist_index)s` in a template prints "NA".
  A course, a season or a whole channel therefore landed in the download root
  in whatever order the files finished, mixed in with everything else, and
  nothing in the names said which part came first. The number, the folder and
  the track tag all come from here instead - the names themselves from
  shared/playlist.ts, which the settings screen's example uses too. Kept apart
  from downloader.ts, and free of Electron, so the naming can be tested.
*/

/** The folder an entry is saved into: a subfolder named after its playlist, when asked for. */
export function playlistDir(dir: string, playlist?: PlaylistPlace): string {
  return playlist?.folder ? join(dir, playlistFolderName(playlist.title)) : dir
}

/**
 * The entry's position as a track tag, `track=7/40`, so a music player or a
 * media server keeps the order the file names show.
 *
 * Only while metadata is being embedded: the engine's Metadata post-processor
 * is the step these arguments are addressed to, and it runs only then. Its own
 * tags come first on ffmpeg's command line, so this one wins over a track
 * number the site supplied - which for an album playlist is the same number.
 */
export function playlistTagArgs(playlist: PlaylistPlace | undefined, embedMetadata: boolean): string[] {
  if (!playlist || !embedMetadata) return []
  return ['--postprocessor-args', `Metadata+ffmpeg:-metadata track=${playlist.index}/${playlist.count}`]
}

/**
 * The playlist part of a request, as the main process will trust it.
 *
 * It arrives over IPC, and the index ends up in a file name and on ffmpeg's
 * command line, so anything that is not a positive whole number is refused
 * rather than written into either. A count shorter than the index - a list
 * that grew between listing and queueing - is stretched to fit.
 */
export function normalisePlaylist(raw: unknown): PlaylistPlace | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const p = raw as Record<string, unknown>
  const index = Number(p.index)
  if (!Number.isSafeInteger(index) || index < 1) return undefined
  const count = Number(p.count)
  return {
    title: typeof p.title === 'string' ? p.title : '',
    index,
    count: Number.isSafeInteger(count) && count > index ? count : index,
    folder: p.folder === true,
    numbered: p.numbered === true
  }
}
