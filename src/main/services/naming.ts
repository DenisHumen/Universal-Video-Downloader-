import { hasTrim, type DownloadItem, type TrimRange } from '@shared/types'

/*
  One request, one file name.

  The engine names a download from its filename template and nothing else, and
  `--continue` makes it treat a file that already has that name as the job
  done. So every request that agreed on the template agreed on the file: a clip
  and then the whole video ("has already been downloaded", exit 0 - the user
  asked for two hours and got the 2-second clip), clip A and then clip B, two
  streams captured from one page under the page's title, the same video at
  best and at 720p. Each row said completed. Two of them running at once
  appended to the same `.part`.

  Everything here is pure so the rules can be tested; downloader.ts reads the
  folder and the queue and hands them in.
*/

/**
 * A moment as it can appear in a file name: `0m05s`, `1h02m05s`, `0m05.5s`.
 *
 * No colons, which Windows refuses, and tenths only when the cut has them - a
 * range the trim editor set to the frame should not produce a name nobody can
 * read.
 */
export function sectionTime(seconds: number): string {
  const tenths = Math.round(Math.max(0, seconds) * 10)
  const whole = Math.floor(tenths / 10)
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = `${String(whole % 60).padStart(2, '0')}${tenths % 10 ? `.${tenths % 10}` : ''}s`
  return h ? `${h}h${String(m).padStart(2, '0')}m${s}` : `${m}m${s}`
}

/**
 * What a trimmed download adds to its name: ` [0m05s-0m09s]`, or
 * ` [0m05s-end]` when it runs to the end. Empty for the whole video.
 *
 * Built here rather than with the engine's `%(section_start)s` and
 * `%(section_end)s`, because an open end renders as `NA` whenever the extractor
 * does not know the length - and "5-NA" is not something to put in front of a
 * person.
 */
export function sectionSuffix(range?: TrimRange): string {
  if (!range || !hasTrim(range)) return ''
  const end = range.end == null ? 'end' : sectionTime(range.end)
  return ` [${sectionTime(range.start ?? 0)}-${end}]`
}

const EXT_FIELD = /\.%\(ext\)s$/

/**
 * The user's filename template with `suffix` on the end of the name: before a
 * trailing `.%(ext)s`, so the extension stays an extension, or simply after
 * everything when the template has none. Folders in the template are left as
 * they are.
 */
export function withNameSuffix(template: string, suffix: string): string {
  if (!suffix) return template
  return EXT_FIELD.test(template)
    ? template.replace(EXT_FIELD, () => `${suffix}.%(ext)s`)
    : template + suffix
}

function copyName(stem: string, n: number): string {
  return `${stem} (${n})`
}

/**
 * Whether anything in the folder is a file of this stem - `stem.mp4`,
 * `stem.mp4.part`, `stem.f137.mp4`, `stem.en.srt`. Case-insensitively, because
 * on Windows `Clip.mp4` and `clip.mp4` are one file.
 */
function hasFileNamed(names: readonly string[], stem: string): boolean {
  const prefix = stem.toLowerCase() + '.'
  return names.some((name) => name.toLowerCase().startsWith(prefix))
}

export interface StemChoice {
  /** The name the entry should have: its title, plus its section suffix. */
  wanted: string
  /** What an earlier run of this same entry chose, if it ran before. */
  current?: string
  /**
   * The bare title, when this entry already ran under a version that named
   * files without a suffix or a number and its partial files are still there.
   */
  legacy?: string
  /** Lower-cased stems that other entries still in flight have chosen in this folder. */
  held: ReadonlySet<string>
  /** Lower-cased names of the files other entries finished into, in this folder. */
  finished: ReadonlySet<string>
  /** What is in the folder now. */
  names: readonly string[]
}

/**
 * The stem a custom-resolved stream is saved under.
 *
 * Those are named after the title the app scraped, and every stream captured
 * from one page gets the page's title - so it has to be told apart from other
 * entries in flight, which have not written their files yet, and from what is
 * already in the folder: ` (2)`, ` (3)` and so on.
 *
 * Chosen once and then kept. A pause or a resume runs the engine again, and
 * `--continue` only finds its partial if the name is the same; picking afresh
 * would find that partial "taken" and start from zero under ` (2)`. The one
 * reason to give it up is that someone else now owns it - another entry in
 * flight chose it, or finished into it, while this one sat in error.
 */
export function pickOutputStem(choice: StemChoice): string {
  const { wanted, current, legacy, held, finished, names } = choice
  const isHeld = (stem: string): boolean => held.has(stem.toLowerCase())
  if (current) {
    const prefix = current.toLowerCase() + '.'
    const finishedHere = names.some((name) => {
      const lower = name.toLowerCase()
      return finished.has(lower) && lower.startsWith(prefix)
    })
    if (!isHeld(current) && !finishedHere) return current
  } else if (legacy && !isHeld(legacy)) {
    return legacy
  }
  let candidate = wanted
  for (let n = 2; isHeld(candidate) || hasFileNamed(names, candidate); n++) {
    candidate = copyName(wanted, n)
  }
  return candidate
}

/**
 * The ` (n)` that gives a file of this stem a name nothing in the folder has.
 * Starts at 2, the way a file manager numbers a copy.
 */
export function freeCopySuffix(stem: string, names: readonly string[]): string {
  let n = 2
  while (hasFileNamed(names, copyName(stem, n))) n++
  return ` (${n})`
}

/** One path, written either way round and in any case. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase()
  return norm(a) === norm(b)
}

/** Would these two entries ask the engine for the same thing? */
function sameRequest(a: DownloadItem, b: DownloadItem): boolean {
  return (
    (a.sourceUrl || a.url) === (b.sourceUrl || b.url) &&
    a.mode === b.mode &&
    a.quality === b.quality &&
    a.formatId === b.formatId &&
    (a.range?.start ?? 0) === (b.range?.start ?? 0) &&
    a.range?.end === b.range?.end
  )
}

/**
 * The engine said `existing` "has already been downloaded" - is that really
 * this entry's file, or someone else's under the same name?
 *
 * Only the queue can tell. If this entry, or a finished one that asked for
 * exactly the same thing, produced that path, it is the file the user wants
 * and the row can complete on it. Otherwise it is the clip when they wanted
 * the whole video, the 720p when they wanted the best, a different video with
 * the same title - and the answer is to fetch again under a name of its own.
 *
 * Only for entries named by the template (a custom-resolved stream's name was
 * already made unique when it was chosen), only when the request says which
 * section, quality or format it wants - every download the app queues does -
 * and only once: an entry that already took a ` (n)` keeps whatever the second
 * run finds, so this can never loop.
 */
export function shouldTakeOwnName(
  item: DownloadItem,
  existing: string,
  all: readonly DownloadItem[]
): boolean {
  if (item.outputStem || item.copySuffix) return false
  if (!hasTrim(item.range) && !item.quality && !item.formatId) return false
  const ours = all.some(
    (other) =>
      !!other.filepath &&
      samePath(other.filepath, existing) &&
      (other.id === item.id || (other.state === 'completed' && sameRequest(other, item)))
  )
  return !ours
}

/** States in which an entry has an engine running, or a resolve about to start one. */
const RUNNING: readonly DownloadItem['state'][] = ['detecting', 'downloading', 'processing']

const isDownload = (item: DownloadItem): boolean => !item.kind || item.kind === 'download'

/**
 * Whether `item` has to stay queued until another download, running now, is
 * done - because it would write the same file.
 *
 * The template names a file after the video, not after what was asked of it,
 * so the same link at best and at 720p comes out under one name, and nobody
 * can say what that name is until the engine has started. One after the other
 * that is handled: the second finds the first one's file "already downloaded"
 * and `shouldTakeOwnName` sends it after a copy of its own. At the same time,
 * both engines append to `Name.f140.m4a.part` with `--continue` and then race
 * to merge into `Name.mp4`. So the second one waits, and only it: the rest of
 * the queue goes on around it.
 *
 * Recognised by the link, which is all there is before the engine runs. A
 * different section, or a copy number already taken, means a different name
 * and no wait. Two different links to one video are not caught.
 */
export function waitsForNamesake(item: DownloadItem, all: readonly DownloadItem[]): boolean {
  if (!isDownload(item)) return false
  const link = item.sourceUrl || item.url
  const tail = sectionSuffix(item.range) + (item.copySuffix ?? '')
  return all.some(
    (other) =>
      other.id !== item.id &&
      isDownload(other) &&
      RUNNING.includes(other.state) &&
      (other.sourceUrl || other.url) === link &&
      sectionSuffix(other.range) + (other.copySuffix ?? '') === tail
  )
}
