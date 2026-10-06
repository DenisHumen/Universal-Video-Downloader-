/**
 * Watching a series and doing something with each new episode.
 *
 * Shared because both sides need the same shape: main runs the pipeline, the
 * renderer draws it, and the settings screen previews what a rename template
 * will produce before anything is downloaded.
 */

export type StepKind = 'download' | 'rename' | 'upload' | 'notify'
export type StepState = 'pending' | 'running' | 'done' | 'failed' | 'skipped'
/** `skipped`: somebody cancelled or removed the episode's download in the queue, or stopped the watch. */
export type RunState = 'running' | 'done' | 'failed' | 'skipped'

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
  /**
   * Why the last episode failed somewhere along the chain, and when.
   *
   * Separate from `lastError`, which only a check writes and the next good check
   * clears. A check that finds nothing new does not mean the chain works again,
   * so only an episode that gets all the way through clears this - a retry of
   * the failed one included - and so does the user, by editing the steps,
   * pausing or resuming, or dismissing it.
   */
  lastRunError?: string
  lastRunFailedAt?: number
  /**
   * Failed goes so far at each episode not yet given up on, by `episodeKey`.
   *
   * A failed episode is left out of `seen`, so the next check - at the watch's
   * own pace, never sooner - finds it again and has another go; the
   * `MAX_ATTEMPTS`th failure gives up and marks it handled. No entry means the
   * episode has never failed, or has been settled since.
   */
  attempts?: Record<string, number>
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

/**
 * What one look at a series' page turned up, for the "check now" button.
 *
 * Answered as soon as the page has been read, not once every episode it found
 * has been downloaded and sent on: the button used to spin for as long as the
 * whole backlog took, and then said only "checked" - including when it had
 * checked nothing at all because the watch was already busy.
 */
export type CheckSummary =
  /** Already being checked, or still working through what the last check found. */
  | { busy: true }
  | { error: string }
  | { notOut: true; releaseAt?: number }
  /** `queued` is what went to the queue: nothing while paused, at most a check's worth otherwise. */
  | { fresh: number; queued: number; paused: boolean }

/**
 * What the "try again" button on a failed or skipped episode gets back.
 *
 * Answered as soon as the episode is on its way, like "check now"; the run
 * itself reaches the screen through the usual broadcasts. Busy while the
 * schedule is working on the same watch, so the two cannot fetch one episode
 * side by side. Paused while the watch is, the way "check now" finds but does
 * not fetch: the pause would only cancel the download the moment it was queued.
 */
export type RetryAnswer = { started: true } | { busy: true } | { paused: true } | { error: string }

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

/** The longest a name `safeSegment` lets through, extension aside. */
const NAME_LIMIT = 180

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
    .slice(0, NAME_LIMIT)
}

/** What a new rename step starts with, and what one that fills to nothing falls back to. */
export const DEFAULT_RENAME_TEMPLATE = '{title} - S{season2}E{episode2}'

/** Put after a template that does not name the episode. */
const EPISODE_SUFFIX = ' - S{season2}E{episode2}'

/*
  Exact tokens only. `{Episode}` is not one - the template leaves it in the
  name as text - so a looser match would wave through a template that still
  gives every episode the same name.
*/
const EPISODE_TOKEN = /\{episode2?\}/
const SEASON_TOKEN = /\{season2?\}/

/**
 * Build the filename for one episode, ready to use.
 *
 * Always one that tells episodes apart. A template without the episode in it -
 * `{title}`, say - named every episode the same, and since both the rename and
 * the upload replace a file already there (that is what lets a re-run replace
 * its own), each new episode quietly deleted the one before, locally and on the
 * share. The number is added here rather than demanded by the editor, so the
 * watches saved before this are covered as well.
 */
export function renameFor(
  step: RenameStep,
  values: TemplateValues,
  now?: Date
): string {
  const title = applyReplacements(values.title, step.replacements)
  const fill = (template: string): string => {
    /*
      The title gives way, not the episode. Cutting the finished name at the
      limit took the number off the end of a long enough title - a Russian
      name and a romaji one side by side - and every episode came out alike
      even though the template named it. Cleaning only ever shortens, so a
      name that fits before it fits after.
    */
    const uses = template.split('{title}').length - 1
    const rest = fillTemplate(template, { ...values, title: '' }, now).length
    const room = uses ? Math.max(0, Math.floor((NAME_LIMIT - rest) / uses)) : title.length
    return safeSegment(fillTemplate(template, { ...values, title: title.slice(0, room) }, now))
  }
  let stem = fill(step.template)
  if (!EPISODE_TOKEN.test(step.template)) {
    // Cut the stem, not the number, when the whole name would be too long.
    const suffix = fillTemplate(EPISODE_SUFFIX, values, now)
    stem = stem
      ? safeSegment(stem.slice(0, NAME_LIMIT - suffix.length) + suffix)
      : fill(DEFAULT_RENAME_TEMPLATE)
  }
  const ext = values.ext ? `.${values.ext.replace(/^\./, '')}` : ''
  return `${stem || 'episode'}${ext}`
}

/**
 * What a rename template leaves out that keeps episodes apart, for the editor
 * to point out. Without the episode, `renameFor` adds it. Without the season,
 * nothing does: a single-season series is fine as it is, but in one with
 * several, E01 of the second season lands on E01 of the first. A blank
 * template has nothing to say - it uses the default, and the preview shows it.
 */
export function renameGap(template: string): 'episode' | 'season' | undefined {
  if (!template.trim()) return undefined
  if (!EPISODE_TOKEN.test(template)) return 'episode'
  if (!SEASON_TOKEN.test(template)) return 'season'
  return undefined
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
// Trying an episode again
// ---------------------------------------------------------------------------

/**
 * Goes an episode gets before it is given up on: one per check, never closer.
 *
 * Every failure used to mark the episode handled on the spot, so a NAS that was
 * asleep, a password changed that afternoon or one queue hiccup lost that
 * episode for good. Retrying for ever is the opposite fault - a file the site
 * keeps broken would be fetched unattended at every check for as long as it
 * stays broken. Three checks at the watch's own interval rides out a night of
 * the first kind and gives up on the second.
 */
export const MAX_ATTEMPTS = 3

/**
 * How one go at an episode ended, for deciding what it leaves on the watch.
 *
 * `skipped` is a person's decision - the download cancelled or removed in the
 * queue - and is as final as success. `stopped` is the watch being paused or
 * removed mid-run, which settles nothing: a paused watch fetches that episode
 * again once it is resumed.
 */
export type EpisodeOutcome = 'done' | 'failed' | 'skipped' | 'stopped'

function isSeen(watch: Watch, ref: EpisodeRef): boolean {
  const key = episodeKey(ref)
  return watch.seen.some((s) => episodeKey(s) === key)
}

/** Failed goes so far at this episode. */
export function attemptsAt(watch: Watch, ref: EpisodeRef): number {
  return watch.attempts?.[episodeKey(ref)] ?? 0
}

/**
 * Whether a failure now would be the one that gives up.
 *
 * Also true for an episode already handled, which only "try again" can reach:
 * nothing will try it on a schedule afterwards, so its failure is the last word.
 */
export function isFinalAttempt(watch: Watch, ref: EpisodeRef): boolean {
  return isSeen(watch, ref) || attemptsAt(watch, ref) + 1 >= MAX_ATTEMPTS
}

/**
 * What one go at an episode changes on its watch, if anything.
 *
 * Handled means added to `seen` - once, however many times it is retried by
 * hand - with its count dropped. A failure short of the cap only counts, so the
 * next check finds the episode again.
 */
export function settleEpisode(
  watch: Watch,
  ref: EpisodeRef,
  outcome: EpisodeOutcome
): Partial<Watch> | undefined {
  if (outcome === 'stopped') return undefined
  const key = episodeKey(ref)
  const { [key]: count = 0, ...others } = watch.attempts ?? {}
  const rest = Object.keys(others).length ? others : undefined

  if (outcome === 'failed' && !isSeen(watch, ref) && count + 1 < MAX_ATTEMPTS) {
    return { attempts: { ...others, [key]: count + 1 } }
  }
  return {
    seen: isSeen(watch, ref) ? watch.seen : [...watch.seen, ref],
    attempts: rest
  }
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

/** Counts that are counts. Anything else in the map is a corrupt file, and forgetting it costs one extra try. */
function cleanAttempts(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, number> = {}
  for (const [key, n] of Object.entries(raw)) {
    if (typeof n === 'number' && Number.isInteger(n) && n > 0) out[key] = n
  }
  return Object.keys(out).length ? out : undefined
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
      attempts: cleanAttempts(candidate.attempts),
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

/** What a step that was under way when the app went says. */
export const INTERRUPTED_NOTE = 'Interrupted when the app closed.'

/**
 * End a run the file says is still going.
 *
 * Read from disk, "running" can only mean a process that has gone: the list is
 * loaded once per launch, before this one has started anything. Left alone,
 * such a run read "running" in the history for good, beside the real run the
 * next check started for the same episode. It ends when its last step did -
 * not now, or it would look as if it had taken days.
 */
export function endInterruptedRun(run: Run): Run {
  if (run.state !== 'running') return run
  const last = Math.max(
    Number(run.startedAt) || 0,
    ...(run.steps ?? []).map((s) => s.finishedAt ?? s.startedAt ?? 0)
  )
  return {
    ...run,
    state: 'failed',
    finishedAt: run.finishedAt ?? last,
    steps: (run.steps ?? []).map(
      (s): RunStep => (s.state === 'running' ? { ...s, state: 'failed', message: INTERRUPTED_NOTE } : s)
    )
  }
}

/** Every interrupted run ended, and how many there were - so the store knows to write the file back. */
export function endInterruptedRuns(runs: Record<string, Run[]>): {
  runs: Record<string, Run[]>
  ended: number
} {
  let ended = 0
  const out: Record<string, Run[]> = {}
  for (const [watchId, list] of Object.entries(runs)) {
    out[watchId] = list.map((run) => {
      const next = endInterruptedRun(run)
      if (next !== run) ended++
      return next
    })
  }
  return { runs: out, ended }
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

// ---------------------------------------------------------------------------
// Something is wrong
// ---------------------------------------------------------------------------

/**
 * What is wrong with a watch, if anything.
 *
 * A check that failed comes first, because until the page can be read again no
 * episode is going anywhere. Then an episode that failed on its way through the
 * chain - which used to be visible only in that watch's history, so a watch
 * whose every upload was being refused after a password change read as healthy
 * in the list and drew no mark on the tab.
 */
export function watchTrouble(watch: Watch): string | undefined {
  return watch.lastError || watch.lastRunError || undefined
}

/** Whether a watch counts towards the mark on the tab. A paused one is not anyone's emergency. */
export function watchFailing(watch: Watch): boolean {
  return watch.enabled && Boolean(watchTrouble(watch))
}

/**
 * A change from the screen, with the episode failure it settles cleared.
 *
 * Editing the steps is how somebody fixes a chain, and pausing or resuming is
 * how they say they have seen it; either way the old failure is no longer news.
 * A patch that names `lastRunError` at all is the dismiss button, and can only
 * ever clear it - the screen has no business writing a failure of its own.
 */
export function settleRunError(patch: Partial<Watch>): Partial<Watch> {
  if (!('steps' in patch || 'enabled' in patch || 'lastRunError' in patch)) return patch
  return { ...patch, lastRunError: undefined, lastRunFailedAt: undefined }
}
