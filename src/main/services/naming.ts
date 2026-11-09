import { isAbsolute, relative, resolve, sep } from 'path'
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

/*
  The language of what actually came down, as the engine fills it in: ` [de]`, or
  nothing when the formats name none.

  Not the language that was asked for. The selector falls back to the plain
  choice when the site no longer offers that one, so a name written from the
  request called an English file German. The engine knows what it picked by the
  time it names the file, whether it was a pair or one format.
*/
const LANGUAGE_FIELD = '%(language& [{}]|)s'

/**
 * What sets this entry's file apart from the same video's other files, in its
 * name: the section it covers and the audio track it carries. The engine's name
 * for a video knows neither, and "already downloaded" would then hand a German
 * track's request the English file. For the template: it holds an engine field.
 */
export function variantSuffix(item: Pick<DownloadItem, 'range' | 'audioLanguage' | 'mode'>): string {
  return sectionSuffix(item.range) + (item.audioLanguage ? LANGUAGE_FIELD : '') + (item.mode === 'audio' ? AUDIO_NAME : '')
}

/** The id as the default template writes it. */
const ID_FIELD = ' [%(id)s]'

/**
 * Whether the engine's id for this link would only repeat the title.
 *
 * For a plain file on a site it knows nothing about, both are the file's own
 * name, and the default template made that `big [big].mp4`. Decided from what
 * the row knows: its title, or, for a link queued without a detect, that the
 * address ends in a media file.
 */
export function idRepeatsTitle(item: Pick<DownloadItem, 'url' | 'title'>): boolean {
  let file: string
  try {
    const { protocol, pathname } = new URL(item.url)
    if (!/^https?:$/.test(protocol)) return false
    file = decodeURIComponent(pathname.split('/').pop() ?? '')
  } catch {
    return false
  }
  const title = item.title?.trim()
  if (title && !/^https?:\/\//i.test(title)) return file.replace(/\.[^.]+$/, '') === title
  return /\.(mp4|m4v|webm|mkv|mov|mp3|m4a|ogg|opus|flac|wav)$/i.test(file)
}

/** The filename template for this row: the same, less an id that says nothing. */
export function templateFor(template: string, item: Pick<DownloadItem, 'url' | 'title'>): string {
  return idRepeatsTitle(item) ? template.replace(ID_FIELD, '') : template
}

/**
 * A video alone on its page.
 *
 * The engine names it "Page title (1)", id `page-1`: its numbering for a page of
 * several, applied to a page of one. A page of several comes back as a playlist
 * under another extractor's name, so this one means a single video.
 */
export function isLoneEmbed(extractor: string | undefined): boolean {
  return /^html5mediaembed$/i.test(extractor ?? '')
}

/** The title, without the number the engine gives a video alone on its page. */
export function withoutEmbedNumber(title: string, extractor: string | undefined): string {
  return isLoneEmbed(extractor) ? title.replace(/ \(1\)$/, '') : title
}

const EXT_FIELD = /\.%\(ext\)s$/

/**
 * An audio download never shares a name with the video of the same link.
 *
 * The engine fetches the stream under the template's name, extracts the sound,
 * and deletes what it fetched. On a site with one combined format that name is
 * the video's: it found the finished `Title [id].mp4` "already downloaded",
 * extracted from it, and deleted it. Getting the sound out of a video you had
 * cost you the video. Checked on the real engine.
 */
export const AUDIO_NAME = ' (audio)'

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
export function freeCopySuffix(stem: string, names: readonly string[], restricted = false): string {
  // Look for the name it will really have, or a third copy lands on the second's file.
  const asWritten = (name: string): string => (restricted ? restrictedSpaces(name) : name)
  let n = 2
  while (hasFileNamed(names, asWritten(copyName(stem, n)))) n++
  return ` (${n})`
}

/**
 * With restricted names on, the engine's switch only reaches the fields; the spaces
 * in the template itself are ours. Those inside `%(...)s` are left alone.
 */
export function restrictedSpaces(name: string): string {
  return name.replace(/ (?![^(]*\))/g, '_')
}

/**
 * The name a download from before ` (audio)` existed had, from one that has it.
 * Undefined for any other name. A format's number comes off too: `T (audio).f251`.
 */
export function stemBeforeAudioName(stem: string): string | undefined {
  const bare = stem.replace(/\.f[\w-]+$/, '')
  const before = bare.replace(/[ _]\(audio\)$/, '')
  return before === bare ? undefined : before
}

/**
 * A finished audio file from before ` (audio)` existed, which is what this entry
 * asks for. The engine now looks for the new name, so it would never find it and
 * would fetch the same thing again.
 */
export function finishedBeforeAudioName(item: DownloadItem, all: readonly DownloadItem[]): string | undefined {
  if (item.mode !== 'audio' || item.outputStem || item.copySuffix || hasTrim(item.range)) return undefined
  const found = all.find(
    (other) =>
      other.id !== item.id &&
      other.state === 'completed' &&
      Boolean(other.filepath) &&
      isMediaName(other.filepath as string) &&
      !/[ _]\(audio\)(?: \(\d+\))?\.[^.]+$/.test(other.filepath as string) &&
      sameRequest(other, item)
  )
  return found?.filepath
}

/**
 * What a finished download may be called: real video and audio containers. The
 * engine saves whatever extension a site names, and it allows `.svg`, `.xml`,
 * `.m3u`, `.asx`, `.swf`, `.ico`, `.bin`, `.json` as well as these, and on older
 * builds `.url`, `.desktop` and `.webloc`.
 */
const MEDIA_EXTENSION =
  /^(mp4|m4v|mkv|webm|mov|flv|f4v|ts|m2ts|mts|avi|wmv|asf|mpg|mpeg|3gp|3g2|ogv|vob|m4a|m4b|mp3|mp2|opus|flac|wav|ogg|oga|aac|mka|weba|wma|aif|aiff|caf|ac3|eac3|dts)$/i

export function isMediaName(path: string): boolean {
  return MEDIA_EXTENSION.test(path.split('.').pop() ?? '')
}

/** A subtitle file beside the video: not what a download is for, but not ours to delete. */
export function isSidecarName(path: string): boolean {
  return /\.(vtt|srt|ass|ssa|lrc|ttml|dfxp|sbv|srv[123]|json3)$/i.test(path)
}

/**
 * Whether a path the engine printed is a file inside the folder this run writes
 * to. Works from the strings alone: asking the disk about a `\\host\share` path
 * is already a connection to that host.
 */
export function isInsideFolder(path: string, folder: string): boolean {
  if (/[\u0000-\u001f]/.test(path) || !isAbsolute(path)) return false
  // A later colon is an NTFS stream: `x.exe:y.mp4` is not the .mp4 it says it is.
  if (sep === '\\' && path.lastIndexOf(':') > 1) return false
  const rel = relative(resolve(folder).normalize('NFC'), resolve(path).normalize('NFC'))
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
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
    a.audioLanguage === b.audioLanguage &&
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
const RUNNING: readonly DownloadItem['state'][] = ['detecting', 'waiting', 'downloading', 'processing']

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
  // Not the language: that only tells two names apart if both languages are still on offer.
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
