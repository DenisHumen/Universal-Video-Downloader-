import { isMediaName, samePath } from './naming'

/*
  What the window may ask the system to open.

  `shell.openPath` runs whatever handles the file, and an .exe's handler is the
  .exe. The path comes from the renderer, so anything that ever got a path into a
  row, or a page that got hold of the bridge, could start a program with one click
  or with none. It has to be something the app already knows about: a file on the
  queue or in the Library, or a folder downloads are configured to go to. A row
  written by an older build can still hold a path the engine's output was made to
  name, so being known is not enough for a file that is then run.
*/

export interface KnownPaths {
  /** Files on the queue and in the Library, the log, a recording's kept piece. */
  files: readonly string[]
  /** The download folder, and the folders rows were sent to. */
  folders: readonly string[]
}

/** A conversion can end as a GIF, which the engine itself never does. */
function isPlayable(path: string): boolean {
  return isMediaName(path) || /\.gif$/i.test(path)
}

function among(path: string, list: readonly string[]): boolean {
  return list.some((known) => Boolean(known) && samePath(known, path))
}

export function mayOpen(path: unknown, known: KnownPaths): boolean {
  if (typeof path !== 'string' || !path) return false
  return among(path, known.folders) || (among(path, known.files) && isPlayable(path))
}

export function mayShow(path: unknown, known: KnownPaths): boolean {
  if (typeof path !== 'string' || !path) return false
  return among(path, known.folders) || among(path, known.files)
}
