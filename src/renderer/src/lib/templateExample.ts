import { numberedName, playlistFolderName } from '@shared/playlist'

/*
  What the filename template will actually produce, shown under the field.

  A template is the kind of thing nobody gets right first time, and the only
  way to find out was to download something and go and look. It matters more
  now that playlist entries are numbered and filed by the app: the number goes
  in front of the file name, the folder goes around it, and a template that
  already sorts into folders of its own changes where both land. The example
  shows a single video and the same video picked from a playlist, so that is
  on screen before anything is downloaded.

  The rendering follows the engine's own rules for the fields a made-up video
  has (checked against yt-dlp with this sample loaded as its info JSON).
  Anything it cannot preview faithfully - a field the sample lacks and the
  template offers no fallback for, maths, traversal, an unusual date format -
  is left exactly as typed rather than guessed at.
*/

/** main's default, used when the field is empty. */
const DEFAULT_TEMPLATE = '%(title)s [%(id)s].%(ext)s'

/** A made-up video, under the engine's own field names. */
const SAMPLE: Record<string, string | number> = {
  id: 'aqz-KE-bpKQ',
  display_id: 'aqz-KE-bpKQ',
  title: 'Big Buck Bunny',
  fulltitle: 'Big Buck Bunny',
  ext: 'mp4',
  uploader: 'Blender',
  channel: 'Blender',
  uploader_id: '@BlenderOfficial',
  upload_date: '20141110',
  duration: 635,
  // In a file name the engine writes a duration with dashes, not colons.
  duration_string: '10-35',
  width: 1920,
  height: 1080,
  resolution: '1920x1080',
  fps: 30,
  format_id: '137+140',
  extractor: 'youtube',
  extractor_key: 'Youtube',
  webpage_url_domain: 'youtube.com',
  // Every download is a run of the engine of its own, so its counter never gets past one.
  autonumber: '00001'
}

const SAMPLE_PLAYLIST = { title: 'Open Movies', index: 7, count: 40 }

/*
  Each playlist entry runs with `--no-playlist`, so the engine has no list to
  read these from and prints its placeholder. Shown as such: a template built
  on `%(playlist_index)s` gets "NA" in every name, and the example should say
  so before the files do.
*/
const NOT_IN_A_LIST = /^(playlist(_\w+)?|n_entries)$/

const FIELD = /%\(([^)]*)\)([-#0+ ]*)(\d*)(?:\.(\d+))?[hlL]?([diouxXeEfFgGcrsaBjhlqDSU])/y

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

/** `>%Y-%m-%d` on a date field, for the directives the example can be sure of. */
function strftime(raw: string | number, format: string): string | undefined {
  if (/%[^YymdHMSbB%]/.test(format)) return undefined
  const ymd = /^(\d{4})(\d{2})(\d{2})$/.exec(String(raw))
  const date = ymd
    ? new Date(Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])))
    : typeof raw === 'number'
      ? new Date(raw * 1000)
      : undefined
  if (!date) return undefined
  const two = (n: number): string => String(n).padStart(2, '0')
  const parts: Record<string, string> = {
    Y: String(date.getUTCFullYear()),
    y: two(date.getUTCFullYear() % 100),
    m: two(date.getUTCMonth() + 1),
    d: two(date.getUTCDate()),
    H: two(date.getUTCHours()),
    M: two(date.getUTCMinutes()),
    S: two(date.getUTCSeconds()),
    B: MONTHS[date.getUTCMonth()],
    b: MONTHS[date.getUTCMonth()].slice(0, 3),
    '%': '%'
  }
  return format.replace(/%(.)/g, (_, d: string) => parts[d])
}

/**
 * A field's value, or undefined when the example cannot know it.
 *
 * The key is `name>date,alternative&replacement|default`, as the engine reads
 * it: the first alternative with a value wins, the replacement stands in for a
 * value that was found, and the default (else "NA") for one that was not. A
 * field the sample does not have counts as missing when the template says
 * what to use instead, and as unknowable when it does not.
 */
function lookup(key: string, fields: Record<string, string | number>): string | undefined {
  const bar = key.indexOf('|')
  const fallback = bar >= 0 ? key.slice(bar + 1) : undefined
  let rest = bar >= 0 ? key.slice(0, bar) : key
  const amp = rest.indexOf('&')
  const replacement = amp >= 0 ? rest.slice(amp + 1) : undefined
  if (amp >= 0) rest = rest.slice(0, amp)

  let value: string | undefined
  let unknown = false
  for (const alternative of rest.split(',')) {
    const gt = alternative.indexOf('>')
    const name = gt >= 0 ? alternative.slice(0, gt) : alternative
    const format = gt >= 0 ? alternative.slice(gt + 1) : undefined
    if (NOT_IN_A_LIST.test(name)) continue
    if (!Object.prototype.hasOwnProperty.call(fields, name)) {
      unknown = true
      continue
    }
    value = format === undefined ? String(fields[name]) : strftime(fields[name], format)
    if (value === undefined) return undefined
    break
  }
  if (value === undefined) return unknown && fallback === undefined ? undefined : (fallback ?? 'NA')
  return replacement === undefined ? value : replacement.split('{}').join(value)
}

/** `%05d`, `%.20s` and the like, as Python's `%` formats them. */
function applyFormat(value: string, flags: string, width: string, precision: string | undefined, type: string): string {
  let text = value
  const n = Number(value)
  if ('diu'.includes(type) && value !== '' && Number.isFinite(n)) {
    text = String(Math.trunc(n))
    if (flags.includes('0') && !flags.includes('-') && width) text = text.padStart(Number(width), '0')
  } else if (type === 's' && precision !== undefined) {
    text = text.slice(0, Number(precision))
  }
  if (width && text.length < Number(width)) {
    text = flags.includes('-') ? text.padEnd(Number(width)) : text.padStart(Number(width))
  }
  return text
}

/**
 * A value made fit for a file name the way the engine does it. By default the
 * characters a file name cannot hold become their full-width look-alikes - a
 * slash from a date format turns into `⧸` and stays in the name rather than
 * making a folder. With restricted names, spaces and anything outside plain
 * ASCII become underscores.
 */
function sanitizeValue(value: string, restrict: boolean): string {
  if (!value) return value
  if (!restrict) {
    return value.replace(/[\\/"*:<>?|]/g, (c) =>
      c === '/' ? '⧸' : c === '\\' ? '⧹' : String.fromCharCode(c.charCodeAt(0) + 0xfee0)
    )
  }
  const text = value
    .replace(/[?"]/g, '')
    .replace(/:/g, '_-')
    .replace(/[\s!&'()[\]{}$;`^,#\\/|*<>]|[^\u0000-\u007f]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
  return text || '_'
}

/** The template with the sample's fields filled in, still as one string with its own separators. */
export function renderTemplate(
  template: string,
  fields: Record<string, string | number>,
  restrict: boolean
): string {
  let out = ''
  let i = 0
  while (i < template.length) {
    if (template.startsWith('%%', i)) {
      out += '%'
      i += 2
      continue
    }
    FIELD.lastIndex = i
    const m = template[i] === '%' ? FIELD.exec(template) : null
    if (!m) {
      out += template[i]
      i++
      continue
    }
    const [whole, key, flags, width, precision, type] = m
    const value = lookup(key, fields)
    // A text value is made safe first and padded after, as the engine does: the padding stays spaces.
    if (value === undefined) out += whole
    else out += applyFormat('csra'.includes(type) ? sanitizeValue(value, restrict) : value, flags, width, precision, type)
    i += whole.length
  }
  return out
}

/**
 * Split into folders and joined with the platform's separator. On Windows the
 * engine also swaps what the system refuses in the template's own text for
 * `#`, and a part ending in a dot or a space; elsewhere a backslash is just a
 * character and only `/` makes a folder.
 */
function toPath(rendered: string, sep: string): string {
  if (sep !== '\\') return rendered
  return rendered
    .split(/[\\/]+/)
    .map((part) => part.replace(/[<>:"|?*]|[\s.]$/g, '#'))
    .join(sep)
}

export interface TemplateExample {
  /** A single video. */
  video: string
  /** The same video picked from a playlist; absent when that changes nothing. */
  playlist?: string
}

/** The settings that change what a template produces. */
export interface TemplateExampleOptions {
  restrictFilenames: boolean
  /** A folder per site in front of everything. */
  siteFolders: boolean
  /** The playlist card's choices, as remembered in settings. */
  playlistFolder: boolean
  playlistNumbering: boolean
  /** The separator to show paths with: the platform's. */
  sep: string
}

/** The example names for a template, under the settings that change them. */
export function templateExample(template: string, options: TemplateExampleOptions): TemplateExample {
  const { sep } = options
  const name = (t: string): string => toPath(renderTemplate(t, SAMPLE, options.restrictFilenames), sep)
  const site = options.siteFolders ? [String(SAMPLE.extractor_key)] : []
  const tmpl = template || DEFAULT_TEMPLATE

  const video = [...site, name(tmpl)].join(sep)
  if (!options.playlistFolder && !options.playlistNumbering) return { video }

  const place = { ...SAMPLE_PLAYLIST, folder: options.playlistFolder, numbered: options.playlistNumbering }
  const folder = place.folder ? [playlistFolderName(place.title)] : []
  return { video, playlist: [...site, ...folder, name(numberedName(tmpl, place))].join(sep) }
}
