import { posix, win32 } from 'path'
import { fileURLToPath } from 'url'

/**
 * Where an app window is allowed to go, decided without Electron.
 *
 * The three app windows carry the preload bridge: the queue, the settings
 * file, `shell.openPath`. Whatever document they end up showing gets all of
 * it. The rule used to be "anything on `file://`", which let a local HTML file
 * dropped onto any screen but Home replace the interface and inherit the
 * bridge. The app's own document is one file, so that file is what is allowed.
 */

export interface RendererLocation {
  /** `ELECTRON_RENDERER_URL`: the dev server, in development only. */
  devUrl?: string
  /** The renderer's `index.html` on disk. */
  indexPath: string
  platform: NodeJS.Platform
}

function withoutHash(url: string): string {
  const at = url.indexOf('#')
  return at === -1 ? url : url.slice(0, at)
}

/** Origin, not prefix: `http://localhost:5173` must not also admit port 51730. */
function onDevServer(url: string, devUrl: string): boolean {
  try {
    const dev = new URL(devUrl).origin
    return dev !== 'null' && new URL(url).origin === dev
  } catch {
    return false
  }
}

/**
 * Whether `url` is the app's own renderer document, in any of its shells.
 *
 * The shell lives in the hash (`#/search`, `#/browser`), so the hash is
 * ignored. On disk the comparison is between paths rather than URLs: an
 * install path with a space or a Cyrillic user name is percent-encoded in the
 * URL, and Windows does not care about case.
 */
export function isRendererDocument(url: string, at: RendererLocation): boolean {
  if (at.devUrl) return onDevServer(url, at.devUrl)
  if (!/^file:/i.test(url)) return false
  const windows = at.platform === 'win32'
  let path: string
  try {
    path = fileURLToPath(withoutHash(url), { windows })
  } catch {
    return false
  }
  const paths = windows ? win32 : posix
  const actual = paths.normalize(path)
  const expected = paths.normalize(at.indexPath)
  return windows ? actual.toLowerCase() === expected.toLowerCase() : actual === expected
}

/**
 * - `allow`: the dev server, or the window's own document reloaded.
 * - `external`: a web link, which belongs in a browser rather than in a window
 *   holding the bridge.
 * - `block`: everything else, which above all means any other local file.
 */
export type NavigationVerdict = 'allow' | 'external' | 'block'

/** What to do when the document in an app window tries to go to `target`. */
export function navigationVerdict(
  target: string,
  current: string,
  at: RendererLocation
): NavigationVerdict {
  if (at.devUrl && onDevServer(target, at.devUrl)) return 'allow'
  if (withoutHash(target) === withoutHash(current) && isRendererDocument(target, at)) return 'allow'
  return /^https?:\/\//i.test(target) ? 'external' : 'block'
}
