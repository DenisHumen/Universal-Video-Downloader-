/**
 * What a download left beside its file, once the file itself is on the share.
 *
 * "Delete the local copy" removed the episode and nothing else: a thumbnail
 * kept when embedding is off, subtitle files, a `.part` from an interrupted
 * attempt and the per-site folder they sat in all stayed behind, so the
 * Downloads folder filled up anyway, just more slowly and more confusingly.
 *
 * Only files that share the episode's exact name are touched. `Show s1e2.jpg`
 * and `Show s1e2.ru.srt` belong to `Show s1e2.mp4`; `Show s1e20.mp4`,
 * `Show s1e2 (1).mp4` and anything else in the folder do not, however similar.
 */

const SIDECAR = [
  /^(?:jpe?g|png|webp)$/i,
  /^(?:[a-z]{2,3}(?:-[a-z0-9]{2,8})?\.)?(?:srt|vtt|ass|ssa|lrc)$/i,
  /^(?:info\.json|description|annotations\.xml)$/i,
  // Leftovers of an interrupted or retried attempt, whatever the format.
  /\.(?:part|ytdl|temp)$/i,
  /^part(?:-frag\d+)?$/i,
]

/** Split "C:\a\b\Show s1e2.mp4" into its folder and file name, either slash. */
export function splitLocalPath(path: string): { dir: string; name: string } {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf(String.fromCharCode(92)))
  return cut < 0 ? { dir: '', name: path } : { dir: path.slice(0, cut), name: path.slice(cut + 1) }
}

/** Names in the media file's folder that the same download left behind. */
export function leftoversOf(mediaName: string, entries: string[]): string[] {
  const dot = mediaName.lastIndexOf('.')
  const stem = dot > 0 ? mediaName.slice(0, dot) : mediaName
  const prefix = stem + '.'
  return entries.filter((entry) => {
    if (entry === mediaName || !entry.startsWith(prefix)) return false
    const rest = entry.slice(prefix.length)
    return SIDECAR.some((re) => re.test(rest))
  })
}

/**
 * Whether an emptied folder may go too: only a folder strictly inside the
 * download directory (a per-site or per-series folder the app made), never the
 * download directory itself or anything outside it.
 */
export function mayRemoveFolder(dir: string, downloadDir: string): boolean {
  const norm = (p: string): string =>
    p.split(String.fromCharCode(92)).join('/').replace(/\/+$/, '').toLowerCase()
  const d = norm(dir)
  const root = norm(downloadDir)
  return Boolean(root) && d !== root && d.startsWith(root + '/')
}
