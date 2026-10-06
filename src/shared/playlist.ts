import type { PlaylistPlace } from './types'

/*
  The names a playlist entry is given: its number and its folder.

  Shared because two sides need the same answer. main puts them on the `-o`
  it hands the engine (see main's playlist.ts), and the settings screen shows
  an example file name under the filename template, which has to show what
  main will actually write - not a second guess at it that could drift.
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
