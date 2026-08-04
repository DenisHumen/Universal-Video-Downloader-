/**
 * URL heuristics shared by the detector and the UI. Deliberately dependency
 * free so they can be unit-tested without pulling in Electron.
 */

/**
 * Whether a link points at a playlist / channel / set worth expanding into a
 * pickable list rather than treating as one video.
 */
export function looksLikeCollection(url: string): boolean {
  // A link to one specific video that merely happens to sit inside a playlist
  // (youtube.com/watch?v=…&list=…) is a single video — expanding it into the
  // whole playlist would be the opposite of what the user asked for.
  if (/[?&]v=[\w-]+/i.test(url)) return false
  return /[?&]list=|\/playlist|\/playlists?\/|\/channel\/|\/@[\w.-]+\/?$|\/user\/|\/c\/|\/sets\/|\/album\//i.test(
    url
  )
}
