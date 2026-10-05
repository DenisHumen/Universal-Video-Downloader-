import { join } from 'path'
import type { PlaylistPlace } from '@shared/types'

/*
  How an entry picked from a playlist or channel is named and filed.

  Each entry runs as its own download with `--no-playlist`, so the engine has
  no idea it belongs to a list: `%(playlist_index)s` in a template prints "NA".
  A course, a season or a whole channel therefore landed in the download root
  in whatever order the files finished, mixed in with everything else, and
  nothing in the names said which part came first. The number, the folder and
  the track tag all come from here instead. Kept apart from downloader.ts, and
  free of Electron, so the naming can be tested.
*/

/** `07 - `, padded to as many digits as the list is long, so a file manager sorts it in order. */
export function playlistNumber(index: number, count: number): string {
  return `${String(index).padStart(String(Math.max(count, index)).length, '0')} - `
}

/**
 * Where the file name starts in an output template: just past its last
 * folder separator.
 *
 * Only a separator outside a `%(…)` field counts. A template may sort into
 * folders of its own (`%(uploader)s/%(title)s.%(ext)s`), but a slash inside a
 * field is part of a format - `%(upload_date>%Y/%m/%d)s` - and the engine puts
 * the value in the name, not in folders. `%%` is a literal percent sign and
 * opens nothing.
 */
function fileNameStart(template: string): number {
  let start = 0
  let depth = 0
  for (let i = 0; i < template.length; i++) {
    const c = template[i]
    if (depth === 0) {
      if (c === '%' && template[i + 1] === '%') i++
      else if (c === '%' && template[i + 1] === '(') {
        depth = 1
        i++
      } else if (c === '/' || c === '\\') start = i + 1
    } else if (c === '(') depth++
    else if (c === ')') depth--
  }
  return start
}

/**
 * An output template or baked file stem, with the entry's number in front of
 * the file name.
 *
 * In front of the file name, not of the whole template: numbering
 * `%(uploader)s/%(title)s` at its start would number the uploader's folder,
 * and every entry would get a folder of its own.
 */
export function numberedName(name: string, playlist?: PlaylistPlace): string {
  if (!playlist?.numbered) return name
  const at = fileNameStart(name)
  return name.slice(0, at) + playlistNumber(playlist.index, playlist.count) + name.slice(at)
}

/**
 * A playlist title made safe to be a folder.
 *
 * Stricter than a file stem. The folder is part of the `-o` template, so `%`
 * has to go as well as everything Windows refuses; and it is a whole path
 * segment, so a trailing dot or space matters - Windows strips those as it
 * creates the folder, and the path the app then looks under would not exist.
 * Control characters too: titles come off pages we did not write, and a NUL
 * in an argument makes `spawn` throw.
 */
export function playlistFolderName(title: string): string {
  const name = title
    .replace(/[%/\\:*?"<>|\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    .replace(/[. ]+$/, '')
  return name || 'playlist'
}

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
