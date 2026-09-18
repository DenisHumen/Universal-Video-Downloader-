/**
 * Watching a series and doing something with each new episode.
 *
 * Shared because both sides need the same shape: main runs the pipeline, the
 * renderer draws it, and the settings screen previews what a rename template
 * will produce before anything is downloaded.
 */

export type StepKind = 'download' | 'rename' | 'upload' | 'notify'
export type StepState = 'pending' | 'running' | 'done' | 'failed' | 'skipped'
export type RunState = 'running' | 'done' | 'failed'

/** One find-and-replace applied to the title before it reaches a template. */
export interface Replacement {
  from: string
  to: string
}

export interface DownloadStep {
  id: string
  kind: 'download'
  enabled: boolean
}

export interface RenameStep {
  id: string
  kind: 'rename'
  enabled: boolean
  /** e.g. `{title} - S{season2}E{episode2}` — the extension is kept as it is. */
  template: string
  replacements: Replacement[]
}

export interface UploadStep {
  id: string
  kind: 'upload'
  enabled: boolean
  /** Which `SmbTarget` in settings. */
  targetId: string
  /** Directory inside the share. Takes the same tokens as a rename template. */
  remotePath: string
  createDirs: boolean
  deleteLocalAfter: boolean
}

export interface NotifyStep {
  id: string
  kind: 'notify'
  enabled: boolean
}

export type PipelineStep = DownloadStep | RenameStep | UploadStep | NotifyStep

/**
 * A remote share. Lives in settings rather than in a watch, because one server
 * serves many series. The password is not here — it is in the encrypted secret
 * store, keyed by this id.
 */
export interface SmbTarget {
  id: string
  name: string
  host: string
  share: string
  /**
   * The folder inside the share that everything is filed under.
   *
   * A share name alone is rarely where anyone actually wants their files. The
   * location people have in mind is the whole path they would type into an
   * address bar, and this is the part of it past the share name. Empty means
   * the root of the share.
   */
  path: string
  domain: string
  username: string
}

/** One episode, as a watch knows it. */
export interface EpisodeRef {
  season: number
  episode: number
}

/**
 * A series being watched.
 *
 * `seen` holds season/episode pairs rather than a highest-episode number: sites
 * insert episodes retroactively, renumber, and gain a translation late whose
 * own episode list starts again at 1. A high-water mark misses all three.
 */
export interface Watch {
  id: string
  /** The page the user pasted. */
  url: string
  title: string
  thumbnail?: string
  provider: string
  /** Which dub, and at what quality. Fixed per watch. */
  translatorId: string
  translatorName?: string
  quality: string
  enabled: boolean
  intervalMinutes: number
  /** Absolute wall-clock time, so a sleeping machine does not lose its place. */
  nextCheckAt: number
  lastCheckedAt?: number
  lastError?: string
  /** Consecutive failures, for backoff. Reset on success. */
  failures: number
  seen: EpisodeRef[]
  steps: PipelineStep[]
  createdAt: number
  /**
   * Added before anything was released.
   *
   * There is no dub to choose yet, so none is stored: the first check that
   * finds episodes adopts the fullest dub on offer and clears this, after which
   * the watch is an ordinary one.
   */
  pending?: boolean
  /** When the site expects the release, in milliseconds. Absent when it does not say. */
  releaseAt?: number
}

export interface RunStep {
  kind: StepKind
  state: StepState
  message?: string
  startedAt?: number
  finishedAt?: number
}

/** One episode's trip through a watch's pipeline. */
export interface Run {
  id: string
  watchId: string
  season: number
  episode: number
  /** The series title at the time, so history stays readable if it is renamed. */
  title: string
  state: RunState
  steps: RunStep[]
  /** The queue item this run is driving, while the download step is running. */
  downloadId?: string
  filepath?: string
  remotePath?: string
  startedAt: number
  finishedAt?: number
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/** What a template can be filled in with. */
export interface TemplateValues {
  title: string
  season: number
  episode: number
  quality?: string
  ext?: string
}

/** Every token a template understands, for the UI to offer. */
export const TEMPLATE_TOKENS = [
  'title',
  'season',
  'episode',
  'season2',
  'episode2',
  'quality',
  'ext',
  'year',
  'date'
] as const

/**
 * Apply the user's find-and-replace rules to a title.
 *
 * This is what turns a Russian title into whatever the user files their series
 * under: the sites this watches return titles like `Табакошка`, and someone
 * organising a library in English wants `Tabakoshka`. Plain string replacement,
 * every occurrence, in the order the rules are listed — not regular
 * expressions, because these are written by someone naming a TV show, and a
 * stray `(` should not be an error message.
 */
export function applyReplacements(title: string, replacements: Replacement[]): string {
  let out = title
  for (const { from, to } of replacements) {
    if (!from) continue
    out = out.split(from).join(to)
  }
  return out
}

const pad2 = (n: number): string => String(Math.trunc(Math.abs(n))).padStart(2, '0')

/**
 * Fill a template in.
 *
 * Unknown tokens are left exactly as they are rather than replaced with
 * nothing: a typo should look like a typo in the resulting filename, not
 * silently produce `Show - S01E.mkv` and leave the user wondering.
 *
 * `now` is a parameter so this stays pure and its tests do not depend on the
 * clock.
 */
export function fillTemplate(
  template: string,
  values: TemplateValues,
  now: Date = new Date()
): string {
  const table: Record<string, string> = {
    title: values.title,
    season: String(values.season),
    episode: String(values.episode),
    season2: pad2(values.season),
    episode2: pad2(values.episode),
    quality: values.quality ?? '',
    ext: values.ext ?? '',
    year: String(now.getFullYear()),
    date: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
  }
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in table ? table[name] : whole
  )
}

/**
 * Characters no filesystem we support will accept in a name, plus the ones SMB
 * refuses. Applied after the template is filled, because the title is the part
 * that can contain anything.
 */
export function safeSegment(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 180)
}

/** Build the filename for one episode, ready to use. */
export function renameFor(
  step: RenameStep,
  values: TemplateValues,
  now?: Date
): string {
  const title = applyReplacements(values.title, step.replacements)
  const stem = safeSegment(fillTemplate(step.template, { ...values, title }, now))
  const ext = values.ext ? `.${values.ext.replace(/^\./, '')}` : ''
  return `${stem || 'episode'}${ext}`
}

/**
 * Build the remote directory for one episode. Slashes are kept — that is the
 * point of the field — but each segment is cleaned separately so a title
 * containing a slash cannot invent a directory level.
 */
export function remoteDirFor(
  template: string,
  values: TemplateValues,
  replacements: Replacement[] = [],
  now?: Date
): string {
  /*
    The title is cleaned before it goes into the template, not after the
    result is split. Cleaning afterwards is too late: a title containing a
    slash has already become a directory boundary by then, so a series
    called `a/b` would quietly create a level of its own inside the share.
  */
  const title = safeSegment(applyReplacements(values.title, replacements))
  return fillTemplate(template, { ...values, title }, now)
    .split(/[\\/]+/)
    .map((segment) => safeSegment(segment))
    .filter(Boolean)
    .join('/')
}

/** Stable key for "have I handled this episode already". */
export function episodeKey(ref: EpisodeRef): string {
  return `s${ref.season}e${ref.episode}`
}

/** Episodes present now that the watch has not handled yet, in order. */
export function newEpisodes(seen: EpisodeRef[], available: EpisodeRef[]): EpisodeRef[] {
  const handled = new Set(seen.map(episodeKey))
  return available
    .filter((ref) => !handled.has(episodeKey(ref)))
    .sort((a, b) => a.season - b.season || a.episode - b.episode)
}

// ---------------------------------------------------------------------------
// Stored shape
// ---------------------------------------------------------------------------

/** Runs kept per watch. A year of a weekly series is fifty; this is plenty. */
export const MAX_RUNS = 60

export interface StoredWatches {
  watches: Watch[]
  runs: Record<string, Run[]>
}

/** Whether a stored object is still a watch we can work with. */
function usable(raw: unknown): raw is Watch {
  const w = raw as Partial<Watch> | null
  return Boolean(
    w &&
      typeof w.id === 'string' &&
      typeof w.url === 'string' &&
      typeof w.provider === 'string' &&
      Array.isArray(w.steps)
  )
}

/**
 * Fill in what an older file did not have, and drop only what cannot be
 * repaired.
 *
 * This runs against every user's file on the first launch after an update,
 * which is exactly when nobody is watching. A watch is something built by
 * hand - a series, a dub, a naming template, a remote path - so losing the
 * whole list because one entry gained a field would be a genuinely bad
 * afternoon. Bad entries are dropped one at a time; the rest survives.
 */
/** Where an upload files its episodes when nobody has said otherwise. */
export const DEFAULT_REMOTE_PATH = '{title}'

/**
 * The default this replaced.
 *
 * It filed every episode inside a `season 1` folder, which is a level of
 * nesting nobody asked for and most series never need - one folder per title,
 * with the episodes in it, is what people actually want to browse. Chains saved
 * with the old default are moved onto the new one; a path somebody typed
 * themselves is theirs and is left exactly as written.
 */
const LEGACY_REMOTE_PATH = '{title}/season {season}'

function withoutTheSeasonFolder(step: PipelineStep): PipelineStep {
  if (step.kind !== 'upload' || step.remotePath !== LEGACY_REMOTE_PATH) return step
  return { ...step, remotePath: DEFAULT_REMOTE_PATH }
}

export function migrateWatches(raw: unknown): StoredWatches {
  const source = (raw ?? {}) as Partial<StoredWatches>
  const watches: Watch[] = []

  for (const candidate of Array.isArray(source.watches) ? source.watches : []) {
    if (!usable(candidate)) continue
    watches.push({
      ...candidate,
      title: candidate.title || candidate.url,
      quality: candidate.quality || 'best',
      translatorId: candidate.translatorId ?? '',
      enabled: candidate.enabled !== false,
      failures: Number.isFinite(candidate.failures) ? candidate.failures : 0,
      // A number that is not a positive count of minutes is a corrupt file,
      // not a request for the fastest allowed rate: fall back rather than clamp.
      intervalMinutes:
        Number(candidate.intervalMinutes) > 0
          ? Math.max(15, Number(candidate.intervalMinutes))
          : 360,
      nextCheckAt: Number(candidate.nextCheckAt) || 0,
      seen: Array.isArray(candidate.seen) ? candidate.seen : [],
      steps: candidate.steps
        .filter((step) => step && typeof step.kind === 'string')
        .map(withoutTheSeasonFolder),
      createdAt: Number(candidate.createdAt) || 0
    })
  }

  const runs: Record<string, Run[]> = {}
  const live = new Set(watches.map((w) => w.id))
  for (const [watchId, list] of Object.entries(source.runs ?? {})) {
    // Runs whose watch is gone are history nobody can reach.
    if (!live.has(watchId) || !Array.isArray(list)) continue
    runs[watchId] = list.slice(-MAX_RUNS)
  }

  return { watches, runs }
}

// ---------------------------------------------------------------------------
// Where a share lives
// ---------------------------------------------------------------------------

export interface SmbLocation {
  host: string
  share: string
  /** Anything after the share name, which is a folder inside it. */
  folder: string
}

/**
 * Split the thing people actually write into the three parts SMB needs.
 *
 * Nobody thinks of a network location as a server plus a share plus a path.
 * They think of it as one string, the way it appears in the address bar, and
 * they will paste that string into whichever box looks most like it. The first
 * version of the form asked for the parts separately and got a whole path typed
 * into the share box - which the server rejects with "no share by that name",
 * because a share name really is only the first segment and everything after it
 * is a folder.
 *
 * Accepts every spelling of the same location: UNC, forward slashes, an smb://
 * URL, or a bare host/share, with any number of separators anywhere.
 */
export function parseSmbPath(input: string): SmbLocation {
  const backslash = String.fromCharCode(92)
  let text = String(input || '').trim().split(backslash).join('/')
  text = text.replace(/^smb:/i, '')
  while (text.startsWith('/')) text = text.slice(1)
  const parts = text.split('/').filter(Boolean)
  return {
    host: parts[0] ?? '',
    share: parts[1] ?? '',
    folder: parts.slice(2).join('/')
  }
}

/** Write a location back out the way the user is used to seeing it. */
export function formatSmbPath(location: SmbLocation): string {
  const backslash = String.fromCharCode(92)
  const parts = [location.host, location.share, ...location.folder.split('/')].filter(Boolean)
  return parts.length ? backslash + backslash + parts.join(backslash) : ''
}

/**
 * Repair a target whose share carries a path.
 *
 * Before the path box existed, the form asked for the share on its own, and
 * what it kept receiving was the whole path - which the server rejects outright,
 * because a share name is only ever the first segment. Fixing the form was not
 * enough: those targets are already sitting in people's settings, and a stored
 * share of "shared/torrents/downloads" goes on failing with the same message
 * however good the box that replaced it is.
 *
 * So the split is applied on every settings read and write, and again before
 * connecting. A target repaired once stays repaired, and one that somehow
 * escapes repair still connects.
 */
/**
 * Was this name written by the old default, rather than chosen?
 *
 * Compared by meaning rather than character by character: the label was
 * generated at whatever moment the share was saved, so a stray leading or
 * trailing separator added later leaves the two spelled differently while still
 * plainly being the same thing. An exact comparison misses every real case.
 */
function looksGenerated(name: string, host: string, share: string): boolean {
  const backslash = String.fromCharCode(92)
  const squash = (value: string): string =>
    value.split(backslash).join('/').split('/').filter(Boolean).join('/').toLowerCase()
  return squash(name) === squash(`${host}/${share}`)
}

export function normaliseSmbTarget<T extends SmbTarget>(target: T): T {
  const backslash = String.fromCharCode(92)
  let host = (target.host || '').trim()
  const share = (target.share || '').split(backslash).join('/')
  const parts = [share, target.path || '']
    .join('/')
    .split(backslash)
    .join('/')
    .split('/')
    .filter(Boolean)

  if (parts.length > 1 && parts[0].toLowerCase() === host.toLowerCase()) {
    // A whole UNC path typed into the share box names the server twice.
    parts.shift()
  } else if (!host && share.startsWith('//') && parts.length > 1) {
    // ...or names it only there, if the server box was left empty.
    host = parts.shift() as string
  }

  const repaired = { ...target, host, share: parts[0] ?? '', path: parts.slice(1).join('/') }

  /*
    An older version labelled a share `server/share` by default, which for these
    targets reads as the mangled value it is repairing. Relabel only when the
    name is exactly that generated form - a name somebody chose is theirs, and
    rewriting it would be a worse fault than an ugly default.
  */
  if (looksGenerated(target.name, target.host, target.share)) {
    repaired.name = formatSmbPath({
      host: repaired.host,
      share: repaired.share,
      folder: repaired.path
    })
  }

  return repaired
}

// ---------------------------------------------------------------------------
// Waiting for something that is not out yet
// ---------------------------------------------------------------------------

const DAY_MINUTES = 24 * 60

/**
 * How long to leave it before looking again at a title that is not out.
 *
 * Weeks away, asking every few hours is noise - but the date on an announcement
 * moves, in both directions, so it is looked at once a day to keep the countdown
 * honest. Inside the last day, and for as long as the date has passed without
 * anything appearing, it is checked at the watch's own pace: release dates are
 * approximate, and "due yesterday" is exactly when checking often pays off. With
 * no date at all there is nothing to count down to, so it is the daily look.
 */
export function upcomingDelayMinutes(
  releaseAt: number | undefined,
  intervalMinutes: number,
  now: number
): number {
  if (!releaseAt) return DAY_MINUTES
  const minutesLeft = (releaseAt - now) / 60_000
  if (minutesLeft > DAY_MINUTES) return DAY_MINUTES
  return Math.max(15, intervalMinutes)
}

/** Whole days until a release, rounded up - "in 3 d" until the last day begins. */
export function daysUntil(releaseAt: number, now: number): number {
  return Math.max(0, Math.ceil((releaseAt - now) / 86_400_000))
}
