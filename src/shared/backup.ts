/**
 * A backup of the app's configuration: the settings, the watched series and the
 * shares they upload to, in one file a person can carry to a new computer.
 *
 * Moving machines or reinstalling used to mean building every watch again by
 * hand - the series, the dub, the rename template, the remote path - and
 * remembering every setting that had ever been changed. This is the file that
 * saves that afternoon.
 *
 * Pure, so the rules that matter can be tested without Electron: what goes into
 * the file, what a file has to look like before anything is taken from it, and
 * how what it holds is merged into what is already here. Main does the dialogs
 * and the disk; nothing in here touches either.
 *
 * Secrets never travel. The SMB passwords, the Telegram bot token and the
 * proxy's password live in the encrypted secret store, sealed with a key that
 * belongs to this machine and could not be opened on another one anyway. A
 * backup is a file people leave in a downloads folder, sync to a cloud drive
 * and attach to messages, so it carries none of them, and says so when it is
 * imported.
 */

import { AUDIO_CONTAINERS, SUPPORTED_COOKIE_BROWSERS, type AppSettings } from './types'
import { proxyUser, splitProxyPassword } from './proxy'
import { normalizeUrl } from './urls'
import {
  DEFAULT_REMOTE_PATH,
  episodeKey,
  exactDuplicate,
  inheritedSeen,
  migrateWatches,
  normaliseSmbTarget,
  sameDub,
  type EpisodeRef,
  type PipelineStep,
  type Replacement,
  type SmbTarget,
  type Watch
} from './automation'

export const BACKUP_FORMAT = 'uvd-backup'

/**
 * The shape of the file this build writes. A file with a higher number came
 * from a newer build, and is refused rather than half-read: whatever changed
 * is exactly the part this build would get wrong.
 */
export const BACKUP_VERSION = 1

/**
 * The settings a backup carries. The shares and the Telegram chat travel on
 * their own, because they are merged rather than replaced.
 */
export type BackupSettings = Partial<Omit<AppSettings, 'smbTargets' | 'telegramChatId'>>

export interface Backup {
  format: typeof BACKUP_FORMAT
  version: number
  /** The app version that wrote it, for whoever reads the file. */
  app: string
  /** ISO time it was written. */
  exportedAt: string
  settings: BackupSettings
  watches: Watch[]
  /** Without passwords, which are never in a target to begin with. */
  smbTargets: SmbTarget[]
  /** Without the bot token. */
  telegram: { chatId: string }
}

/** Why a file was not accepted, for the screen to put into words. */
export type BackupError = 'json' | 'format' | 'version' | 'shape' | 'read' | 'write'

/** What one import did, for the screen to report. */
export interface ImportCounts {
  /** Something in the file changed a setting here. */
  settings: boolean
  watchesAdded: number
  /** Series already being watched here, left alone. */
  watchesSkipped: number
  /** Entries in the file too damaged to be a watch. */
  watchesInvalid: number
  targetsAdded: number
  /** The backup's download folder does not exist on this machine, so the current one stayed. */
  folderKept: boolean
  /**
   * The import set a proxy that signs in with a user name. Its password never
   * travels, and the proxy turns away every download and every request of the
   * app's own until it is typed in again - somewhere other than the watching
   * section the share passwords and the bot token are entered in.
   */
  proxyPassword: boolean
}

export type ExportOutcome =
  | { ok: true; path: string; watches: number; targets: number }
  | { ok: false; canceled: true }
  | { ok: false; error: BackupError }

export type ImportOutcome =
  | { ok: true; counts: ImportCounts; settings: AppSettings }
  | { ok: false; canceled: true }
  | { ok: false; error: BackupError }

// ---------------------------------------------------------------------------
// Which settings travel
// ---------------------------------------------------------------------------

type Check = (value: unknown) => boolean

const isBool: Check = (v) => typeof v === 'boolean'
const isText: Check = (v) => typeof v === 'string'
const isNumber: Check = (v) => typeof v === 'number' && Number.isFinite(v)
const oneOf =
  (values: readonly string[]): Check =>
  (v) =>
    typeof v === 'string' && values.includes(v)

/**
 * Every setting, and what a value for it has to look like to be taken from a
 * file.
 *
 * A record over the settings' own keys rather than a list, so a setting added
 * later does not compile until somebody has decided whether it belongs in a
 * backup. That is the moment to notice a new field holds something that must
 * not leave the machine. Ranges are left to the settings' own migration, which
 * every write already goes through: it clamps the concurrency, refuses an
 * unsafe filename template and maps a theme from an older build.
 */
const SETTING_CHECKS: Record<keyof BackupSettings, Check> = {
  downloadDir: isText,
  concurrentDownloads: isNumber,
  defaultMode: oneOf(['video', 'audio']),
  defaultQuality: (v) => typeof v === 'string' && /^(?:best|audio|\d{3,4})$/.test(v),
  audioFormat: oneOf(AUDIO_CONTAINERS),
  embedThumbnail: isBool,
  embedSubtitles: isBool,
  embedMetadata: isBool,
  embedChapters: isBool,
  writeSubtitles: isBool,
  subtitleLanguages: isText,
  sponsorBlock: isBool,
  restrictFilenames: isBool,
  preferCompatible: isBool,
  automationEnabled: isBool,
  autostart: isBool,
  logVerbose: isBool,
  filenameTemplate: isText,
  createSubfolders: isBool,
  speedLimit: isText,
  playlistLimit: isNumber,
  playlistNumbering: isBool,
  playlistFolder: isBool,
  autoUpdate: isBool,
  resumeOnLaunch: isBool,
  keepFinished: isNumber,
  theme: isText,
  language: oneOf(['auto', 'en', 'ru']),
  notifications: isBool,
  clipboardWatch: isBool,
  trayEnabled: isBool,
  universalFallback: isBool,
  showAdultServices: isBool,
  proxy: isText,
  cookiesFromBrowser: (v) => v === '' || oneOf(SUPPORTED_COOKIE_BROWSERS)(v),
  cookiesFile: isText,
  errorReports: oneOf(['ask', 'off'])
}

const SETTING_KEYS = Object.keys(SETTING_CHECKS) as (keyof BackupSettings)[]

/**
 * The settings worth carrying, with the proxy's password taken out.
 *
 * On a system with no key store the password stays inside the address, because
 * there is nowhere else to keep it between launches - which is exactly the
 * case where it would otherwise ride along into the file.
 */
function portableSettings(source: Partial<AppSettings>): BackupSettings {
  const out: Record<string, unknown> = {}
  for (const key of SETTING_KEYS) {
    const value = source[key]
    if (value === undefined || !SETTING_CHECKS[key](value)) continue
    out[key] = key === 'proxy' ? splitProxyPassword(value as string).proxy : value
  }
  return out as BackupSettings
}

/** Only the fields a share is made of. Anything else on the object is not ours to copy. */
function portableTarget(target: SmbTarget): SmbTarget {
  return {
    id: target.id,
    name: target.name,
    host: target.host,
    share: target.share,
    path: target.path,
    domain: target.domain,
    username: target.username
  }
}

/**
 * A watch as the file keeps it: what the user built and what it has handled.
 *
 * The record of the last check - its time, its error, the failures counted
 * towards backoff and the goes at each failed episode - describes this
 * machine's schedule and this machine's network, and means nothing on another.
 */
function portableWatch(watch: Watch): Watch {
  const copy: Watch = { ...watch, failures: 0 }
  delete copy.lastCheckedAt
  delete copy.lastError
  delete copy.lastRunError
  delete copy.lastRunFailedAt
  delete copy.attempts
  return copy
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** The name the save dialog suggests, dated by the local calendar the user reads. */
export function backupFileName(now: Date): string {
  const day = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
  return `universal-video-downloader-backup-${day}.json`
}

export function buildBackup(input: {
  settings: AppSettings
  watches: Watch[]
  app: string
  now: Date
}): Backup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app: input.app,
    exportedAt: input.now.toISOString(),
    settings: portableSettings(input.settings),
    watches: input.watches.map(portableWatch),
    smbTargets: (input.settings.smbTargets ?? []).map(portableTarget),
    telegram: { chatId: input.settings.telegramChatId ?? '' }
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const BOM = String.fromCharCode(0xfeff)

export type ParsedBackup =
  | { ok: true; backup: Backup; invalid: number }
  | { ok: false; error: BackupError }

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v)

const text = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)

function isEpisodeRef(v: unknown): v is EpisodeRef {
  if (!isRecord(v)) return false
  const { season, episode } = v
  return (
    Number.isInteger(season) &&
    Number.isInteger(episode) &&
    (season as number) >= 0 &&
    (episode as number) >= 0
  )
}

function cleanReplacements(raw: unknown): Replacement[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(isRecord)
    .filter((r) => typeof r.from === 'string' && typeof r.to === 'string')
    .map((r) => ({ from: r.from as string, to: r.to as string }))
}

/**
 * One step, rebuilt from the fields its kind has.
 *
 * A kind this build does not know is dropped: it could not run it, and
 * carrying it along would only put a step on screen that nobody can edit.
 * Deleting the local file after an upload is only kept when the file says so
 * in as many words - a damaged entry should not be the reason files vanish.
 */
function cleanStep(raw: unknown, index: number): PipelineStep | undefined {
  if (!isRecord(raw)) return undefined
  const id = text(raw.id) || `step-${index + 1}`
  const enabled = raw.enabled !== false
  switch (raw.kind) {
    case 'download':
    case 'notify':
      return { id, kind: raw.kind, enabled }
    case 'rename':
      return {
        id,
        kind: 'rename',
        enabled,
        template: text(raw.template),
        replacements: cleanReplacements(raw.replacements)
      }
    case 'upload':
      return {
        id,
        kind: 'upload',
        enabled,
        targetId: text(raw.targetId),
        remotePath: text(raw.remotePath, DEFAULT_REMOTE_PATH),
        createDirs: raw.createDirs !== false,
        deleteLocalAfter: raw.deleteLocalAfter === true
      }
    default:
      return undefined
  }
}

/**
 * A watch from a file, made of known fields only.
 *
 * The same repairs the watch list gets on every launch come first, so a file
 * from an older build reads the way that build's own list would. Then the
 * object is rebuilt field by field: whatever else a hand-edited file carries
 * does not end up in watches.json.
 */
function cleanWatch(raw: Watch): Watch {
  const seen: EpisodeRef[] = []
  const keys = new Set<string>()
  for (const ref of raw.seen) {
    if (!isEpisodeRef(ref)) continue
    const key = episodeKey(ref)
    if (keys.has(key)) continue
    keys.add(key)
    seen.push({ season: ref.season, episode: ref.episode })
  }
  const steps = raw.steps
    .map(cleanStep)
    .filter((step): step is PipelineStep => step !== undefined)
  return {
    id: raw.id,
    url: raw.url,
    title: text(raw.title, raw.url),
    ...(typeof raw.thumbnail === 'string' ? { thumbnail: raw.thumbnail } : {}),
    provider: raw.provider,
    translatorId: text(raw.translatorId),
    ...(typeof raw.translatorName === 'string' ? { translatorName: raw.translatorName } : {}),
    quality: text(raw.quality, 'best'),
    enabled: raw.enabled,
    intervalMinutes: raw.intervalMinutes,
    nextCheckAt: 0,
    failures: 0,
    seen,
    steps,
    createdAt: raw.createdAt,
    ...(raw.pending === true ? { pending: true } : {}),
    ...(isNumber(raw.releaseAt) ? { releaseAt: raw.releaseAt } : {})
  }
}

/**
 * A share from a file, through the same repair settings get on every read - which
 * can also find the server in a whole path typed into the share box. One that
 * still names no server is nowhere anything could be sent.
 */
function cleanTarget(raw: unknown): SmbTarget | undefined {
  if (!isRecord(raw)) return undefined
  const target = normaliseSmbTarget({
    id: text(raw.id),
    name: text(raw.name),
    host: text(raw.host),
    share: text(raw.share),
    path: text(raw.path),
    domain: text(raw.domain),
    username: text(raw.username)
  })
  return target.host ? target : undefined
}

/**
 * Read a file the user picked, and decide whether anything may be taken from it.
 *
 * The whole file is judged before any of it is used. A file that is not JSON,
 * is not one of ours, or came from a newer build is refused outright; so is one
 * whose sections are the wrong kind of thing altogether, because that is a file
 * somebody else's program wrote, not a damaged one of ours. Inside the
 * sections the reading is forgiving, the way the watch list's own migration
 * is: one damaged watch is dropped and counted, and the rest still arrive.
 */
export function parseBackup(source: string): ParsedBackup {
  let raw: unknown
  try {
    // Notepad saves UTF-8 with a byte-order mark, which JSON.parse will not read past.
    raw = JSON.parse(source.startsWith(BOM) ? source.slice(1) : source)
  } catch {
    return { ok: false, error: 'json' }
  }
  if (!isRecord(raw) || raw.format !== BACKUP_FORMAT) return { ok: false, error: 'format' }
  const { version } = raw
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: 'format' }
  }
  if (version > BACKUP_VERSION) return { ok: false, error: 'version' }

  const settings = raw.settings ?? {}
  const watches = raw.watches ?? []
  const targets = raw.smbTargets ?? []
  const telegram = raw.telegram ?? {}
  const fits =
    isRecord(settings) && Array.isArray(watches) && Array.isArray(targets) && isRecord(telegram)
  if (!fits) return { ok: false, error: 'shape' }

  const repaired = migrateWatches({ watches, runs: {} }).watches.map(cleanWatch)

  return {
    ok: true,
    invalid: watches.length - repaired.length,
    backup: {
      format: BACKUP_FORMAT,
      version,
      app: text(raw.app),
      exportedAt: text(raw.exportedAt),
      settings: portableSettings(settings as Partial<AppSettings>),
      watches: repaired,
      smbTargets: targets.map(cleanTarget).filter((t): t is SmbTarget => t !== undefined),
      telegram: { chatId: text(telegram.chatId).trim() }
    }
  }
}

// ---------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------

/**
 * How long an imported watch that uploads or sends a message waits before its
 * first check.
 *
 * The passwords and the bot token do not come with the backup, so a watch
 * checked straight away would fetch whatever is new and then fail at the share,
 * spending one of its episode's few tries on a password nobody has had the
 * chance to type in yet. Half an hour is time enough to do that, and soon
 * enough that a restored machine catches up the same evening. A watch that only
 * downloads needs nothing from the secret store and is due at once, as a new
 * watch is.
 */
export const IMPORT_GRACE_MS = 30 * 60_000

/** One server, share, folder and account, however differently it is spelled. */
function sameShare(a: SmbTarget, b: SmbTarget): boolean {
  const squash = (v: string): string => v.trim().toLowerCase()
  const folder = (v: string): string => squash(v).split(/[\\/]+/).filter(Boolean).join('/')
  return (
    squash(a.host) === squash(b.host) &&
    squash(a.share) === squash(b.share) &&
    folder(a.path) === folder(b.path) &&
    squash(a.username) === squash(b.username) &&
    squash(a.domain) === squash(b.domain)
  )
}

/**
 * Whether a watch from the file is already being looked after here.
 *
 * Against the watches that were here before the import, the series and the
 * dub decide it, whatever the quality: somebody who re-created a watch by hand
 * before finding the backup does not want every new episode fetched twice. A
 * watch still waiting for its release has no dub yet, so any watch of the same
 * title answers for it.
 *
 * Against the ones this import has just added, only an exact copy counts. Two
 * watches of one series at different qualities, sending to different shares,
 * are somebody's deliberate choice, and a backup holding both should restore
 * both.
 */
function alreadyHere(before: Watch[], added: Watch[], candidate: Watch): boolean {
  const series = normalizeUrl(candidate.url)
  const local = before.some((w) =>
    candidate.pending
      ? w.provider === candidate.provider && normalizeUrl(w.url) === series
      : !w.pending && sameDub(w, candidate)
  )
  if (local) return true
  if (candidate.pending) {
    return added.some(
      (w) => w.pending && w.provider === candidate.provider && normalizeUrl(w.url) === series
    )
  }
  return exactDuplicate(added, candidate) !== undefined
}

function needsSecret(watch: Watch): boolean {
  return watch.steps.some((s) => s.enabled && (s.kind === 'upload' || s.kind === 'notify'))
}

export interface ImportPlan {
  /** For the settings' own update path, which repairs and saves it. Absent keys are left alone. */
  settings: Partial<AppSettings>
  watches: Watch[]
  counts: ImportCounts
}

/**
 * Work out what importing a backup changes here, without changing anything.
 *
 * Settings are replaced, since restoring them is the point - except a download
 * folder or a cookies file that does not exist on this machine, which would
 * only make every download fail; the current one stays. So does a proxy that
 * is the one already in use, so it keeps the password it has here. Shares and
 * watches are only ever added. A share that is already here is reused, and the
 * uploads of the imported watches are pointed at it. Each imported watch keeps
 * the episodes it has handled, plus any a watch already here on the same
 * series and dub has handled, so nothing old is downloaded again; the record
 * of its last check starts afresh.
 */
export function planImport(
  { backup, invalid }: { backup: Backup; invalid: number },
  current: { settings: AppSettings; watches: Watch[] },
  env: { now: number; newId: () => string; exists: (path: string) => boolean }
): ImportPlan {
  const patch: Partial<AppSettings> = { ...backup.settings }
  let folderKept = false
  if (patch.downloadDir !== undefined && (!patch.downloadDir || !env.exists(patch.downloadDir))) {
    // Only worth saying when the file named a different folder than the one in use.
    folderKept = Boolean(patch.downloadDir) && patch.downloadDir !== current.settings.downloadDir
    delete patch.downloadDir
  }
  if (patch.cookiesFile && !env.exists(patch.cookiesFile)) delete patch.cookiesFile
  /*
    The proxy in use here is compared without its password, because the file's
    copy never has one. When they are the same proxy it stays as it is: on a
    system with no key store the password still lives inside the address, and
    writing the file's copy over it would throw away the only place it is kept.
    Any other proxy that names a user arrives without the password it needs,
    and the screen has to say so.
  */
  const proxyHere = splitProxyPassword(current.settings.proxy).proxy
  if (patch.proxy !== undefined && patch.proxy === proxyHere) delete patch.proxy
  const proxyPassword = patch.proxy !== undefined && proxyUser(patch.proxy) !== undefined
  // A chat the file does not name leaves the one set here alone.
  if (backup.telegram.chatId) patch.telegramChatId = backup.telegram.chatId
  const settingsChanged = (Object.keys(patch) as (keyof AppSettings)[]).some(
    (key) => patch[key] !== current.settings[key]
  )

  // Shares first, so the watches below can be pointed at whichever copy survives.
  const targets = [...current.settings.smbTargets]
  const targetIds = new Map<string, string>()
  let targetsAdded = 0
  for (const target of backup.smbTargets) {
    const match = targets.find((t) => sameShare(t, target))
    if (match) {
      targetIds.set(target.id, match.id)
      continue
    }
    const id = !target.id || targets.some((t) => t.id === target.id) ? env.newId() : target.id
    targets.push({ ...target, id })
    if (target.id) targetIds.set(target.id, id)
    targetsAdded++
  }
  if (targetsAdded) patch.smbTargets = targets

  const added: Watch[] = []
  let watchesSkipped = 0
  for (const imported of backup.watches) {
    const watch: Watch = {
      ...imported,
      steps: imported.steps.map((step) =>
        step.kind === 'upload' && targetIds.has(step.targetId)
          ? { ...step, targetId: targetIds.get(step.targetId) as string }
          : step
      )
    }
    if (alreadyHere(current.watches, added, watch)) {
      watchesSkipped++
      continue
    }
    added.push({
      ...watch,
      id: env.newId(),
      seen: inheritedSeen([...current.watches, ...added], watch),
      failures: 0,
      nextCheckAt: needsSecret(watch) ? env.now + IMPORT_GRACE_MS : env.now,
      createdAt: watch.createdAt || env.now
    })
  }

  return {
    settings: patch,
    watches: added,
    counts: {
      settings: settingsChanged,
      watchesAdded: added.length,
      watchesSkipped,
      watchesInvalid: invalid,
      targetsAdded,
      folderKept,
      proxyPassword
    }
  }
}
