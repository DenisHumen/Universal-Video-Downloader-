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
      steps: candidate.steps.filter((step) => step && typeof step.kind === 'string'),
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
