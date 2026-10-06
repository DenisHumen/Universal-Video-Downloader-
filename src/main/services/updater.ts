import { app, net, powerMonitor, shell } from 'electron'
import { EventEmitter } from 'events'
import { readFileSync } from 'fs'
import { join } from 'path'
import pkg from 'electron-updater'
import { isNewerVersion } from '@shared/version'
import type { UpdateStatus } from '@shared/types'
import { log } from './log'
import { withProxyAuth } from './proxy-auth'
import {
  CHECK_LAUNCH_DELAY,
  CHECK_RESUME_DELAY,
  CHECK_TICK,
  checkDue,
  mayCheckInBackground,
  pickDownload,
  type InstallKind,
  type ReleaseAsset
} from './updater-rules'

const { autoUpdater } = pkg

export const updateEvents = new EventEmitter()

export const RELEASES_PAGE = 'https://github.com/DenisHumen/Universal-Video-Downloader-/releases/latest'
const RELEASES_API =
  'https://api.github.com/repos/DenisHumen/Universal-Video-Downloader-/releases/latest'

let currentStatus: UpdateStatus = { state: 'idle' }

/** The last time any check heard back from the release feed, for the scheduler. */
let lastAnswered = 0
/** The last scheduled check, answered or not. */
let lastTried = 0
/**
 * Set while a check nobody asked for is running. Such a check shows no spinner
 * and reports no failure: the user did not start it, and an offline laptop
 * waking up should not greet them with a red strip about a server they never
 * asked to reach. The failure is logged instead.
 */
let quiet = false
/** True from the click on "download" until electron-updater settles it. */
let downloadRequested = false

function emit(status: UpdateStatus): void {
  const previous = currentStatus
  currentStatus = { ...status, manual: status.manual ?? isManualPlatform() }
  if (status.state === 'available' || status.state === 'not-available') lastAnswered = Date.now()
  /*
    Every change goes to the log. There was no updater line in it at all, so an
    update that failed - or one that happened - left nothing to go on. Progress
    ticks are the one exception: they would fill the file during a download.
  */
  if (status.state !== 'downloading' || previous.state !== 'downloading') {
    if (status.state === 'error') {
      log.warn('updater', 'Update failed', { error: status.message })
    } else {
      log.info('updater', `Update status: ${status.state}`, {
        version: status.version,
        manual: currentStatus.manual ? 'yes' : undefined
      })
    }
  }
  updateEvents.emit('status', currentStatus)
}

export function getUpdateStatus(): UpdateStatus {
  return currentStatus
}

/**
 * Platforms where electron-updater can't install for us:
 *
 *  - **macOS**: Squirrel.Mac refuses to apply an update to an app that isn't
 *    signed with a Developer ID, and our CI builds are unsigned. Trying anyway
 *    just produces a confusing "Could not get code signature" error.
 *  - **Linux .deb/.rpm**: only AppImage installs can self-update; a packaged
 *    install belongs to the system package manager.
 *
 * On those we still *check* for updates — we just hand the user the matching
 * installer (the release page when none matches) instead of pretending we can
 * restart into a new version.
 *
 * electron-updater could install a .deb or .rpm itself through pkexec, and
 * electron-builder writes the marker it looks for. That is left off on
 * purpose: the same package reaches people through apt, dnf and the AUR, whose
 * package managers own the files, and a password prompt on quit is no way to
 * find out.
 */
export function isManualPlatform(): boolean {
  if (!app.isPackaged) return false
  if (process.platform === 'darwin') return true
  if (process.platform === 'linux' && !process.env.APPIMAGE) return true
  return false
}

let initialised = false

export function initUpdater(): void {
  if (initialised) return
  initialised = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false

  if (!app.isPackaged) {
    // Lets us exercise the update flow in development without a build.
    autoUpdater.forceDevUpdateConfig = true
  }

  /*
    electron-updater says what it is doing - which feed, which file, why a
    download failed - but only to a logger, and it had none. Its debug output
    is left out: request dumps per blockmap chunk, which say nothing a failure
    report needs.
  */
  autoUpdater.logger = {
    info: (message?: unknown) => log.info('updater', String(message)),
    warn: (message?: unknown) => log.warn('updater', String(message)),
    error: (message?: unknown) => log.error('updater', String(message)),
    debug: () => undefined
  }

  autoUpdater.on('checking-for-update', () => {
    if (!quiet) emit({ state: 'checking' })
  })
  autoUpdater.on('update-available', (info) => {
    emit({
      state: 'available',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      releaseDate: info.releaseDate,
      downloadUrl: RELEASES_PAGE
    })
  })
  autoUpdater.on('update-not-available', (info) => {
    emit({ state: 'not-available', version: info?.version })
  })
  autoUpdater.on('download-progress', (p) => {
    emit({ state: 'downloading', percent: p.percent, bytesPerSecond: p.bytesPerSecond })
  })
  autoUpdater.on('update-downloaded', (info) => {
    emit({
      state: 'downloaded',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      releaseDate: info.releaseDate
    })
  })
  autoUpdater.on('error', (err) => {
    // A scheduled check's failure is logged by electron-updater itself and by `backgroundCheck`.
    if (quiet) return
    emit({ state: 'error', message: err == null ? 'unknown' : err.message || String(err) })
  })
}

// ---- Manual (GitHub REST) check, used where self-install isn't possible ----

interface GhRelease {
  tag_name?: string
  name?: string
  body?: string
  published_at?: string
  html_url?: string
  draft?: boolean
  prerelease?: boolean
  assets?: ReleaseAsset[]
}

/** A refusal from GitHub, carrying its status so the log can say which one. */
class GitHubHttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'GitHubHttpError'
  }
}

/** What this copy is, for choosing its file among a release's assets. */
function installKind(): InstallKind {
  let packageType: string | undefined
  if (process.platform === 'linux') {
    /*
      electron-builder writes this file into the .deb and .rpm, and nothing
      else carries it: the AppImage updates itself and never gets here.
    */
    try {
      packageType = readFileSync(join(process.resourcesPath, 'package-type'), 'utf-8').trim()
    } catch {
      /* not a package install */
    }
  }
  return {
    platform: process.platform,
    arch: process.arch,
    translated: app.runningUnderARM64Translation,
    packageType
  }
}

function fetchJson(url: string): Promise<GhRelease> {
  return new Promise((resolve, reject) => {
    const req = withProxyAuth(net.request({ url, redirect: 'follow' }), url)
    req.setHeader('Accept', 'application/vnd.github+json')
    req.setHeader('User-Agent', 'UniversalVideoDownloader')
    const timer = setTimeout(() => {
      reject(new Error('Update check timed out'))
      try {
        req.abort()
      } catch {
        /* already gone */
      }
    }, 15_000)
    req.on('response', (res) => {
      let data = ''
      res.on('data', (c: Buffer) => (data += c.toString()))
      res.on('end', () => {
        clearTimeout(timer)
        /*
          The status was never looked at, and GitHub answers a refusal with a
          perfectly well-formed JSON body: 403 or 429 with
          {"message": "API rate limit exceeded for <ip>"} once a shared address
          has spent the 60 unauthenticated requests an hour, 404 with
          {"message":"Not Found"} for a repo it cannot see. Both parsed, neither
          has a tag_name, and the caller reads a missing tag as "nothing newer"
          — so a check that never happened was reported to the user as "you are
          up to date". On macOS and .deb/.rpm installs this is the only update
          path there is, so those users could sit on an old build indefinitely
          while the app told them they were current.
        */
        const status = res.statusCode ?? 0
        if (status < 200 || status >= 300) {
          let detail = ''
          try {
            detail = String((JSON.parse(data) as { message?: string }).message ?? '')
          } catch {
            /* not JSON; the status is enough */
          }
          reject(
            new GitHubHttpError(
              status === 403 || status === 429
                ? 'GitHub is rate-limiting update checks from this network — try again in a few minutes.'
                : `Update check failed (HTTP ${status})${detail ? `: ${detail}` : ''}`,
              status
            )
          )
          return
        }
        try {
          resolve(JSON.parse(data) as GhRelease)
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Bad response'))
        }
      })
      res.on('error', (err: Error) => {
        clearTimeout(timer)
        reject(err)
      })
    })
    req.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    req.end()
  })
}

/**
 * The release's own page, kept apart from `downloadUrl`. That one is now the
 * installer itself where one matches, and the "open the downloads page" row in
 * Settings promises a page, not a file landing in Downloads.
 */
let releasePage = RELEASES_PAGE

/**
 * Ask GitHub directly. True when it answered.
 *
 * `quietly` is a scheduled check: no spinner, and a failure is logged and
 * otherwise leaves the status exactly as it was.
 */
async function checkViaGitHub(quietly = false): Promise<boolean> {
  if (!quietly) emit({ state: 'checking' })
  const fail = (message: string, status?: number): false => {
    if (quietly) {
      log.warn('updater', 'Scheduled update check failed', { status, error: message })
    } else {
      if (status) log.warn('updater', 'GitHub refused the update check', { status })
      emit({ state: 'error', message })
    }
    return false
  }
  try {
    const release = await fetchJson(RELEASES_API)
    const tag = (release.tag_name || release.name || '').trim()
    // A 200 with no tag is not "you are up to date", it is a reply we did not
    // understand. Say so rather than inventing reassurance.
    if (!tag) return fail('GitHub returned no release information.')
    if (release.draft) {
      emit({ state: 'not-available', version: app.getVersion() })
      return true
    }
    const version = tag.replace(/^v/i, '')
    if (isNewerVersion(version, app.getVersion())) {
      releasePage = release.html_url || RELEASES_PAGE
      const file = pickDownload(release.assets, installKind())
      emit({
        state: 'available',
        version,
        releaseNotes: release.body?.slice(0, 4000),
        releaseDate: release.published_at,
        manual: true,
        downloadUrl: file || releasePage
      })
    } else {
      emit({ state: 'not-available', version })
    }
    return true
  } catch (err) {
    return fail(
      err instanceof Error ? err.message : String(err),
      err instanceof GitHubHttpError ? err.status : undefined
    )
  }
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  // Somebody asked, so whatever is already in flight answers out loud too.
  quiet = false
  if (isManualPlatform()) {
    await checkViaGitHub()
    return currentStatus
  }
  initUpdater()
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    emit({ state: 'error', message: err instanceof Error ? err.message : String(err) })
  }
  return currentStatus
}

/**
 * A check the scheduler makes, as opposed to one somebody asked for.
 *
 * It leaves a download in progress, or one waiting for a restart, alone (see
 * `mayCheckInBackground`), and it is quiet: no "checking" while it runs, and
 * when it fails the status stays what it was - a pending "available" included -
 * and the reason goes to the log. The next tick tries again.
 */
export async function backgroundCheck(): Promise<void> {
  if (!mayCheckInBackground(currentStatus.state) || downloadRequested) return
  lastTried = Date.now()
  quiet = true
  try {
    if (isManualPlatform()) {
      await checkViaGitHub(true)
    } else {
      initUpdater()
      await autoUpdater.checkForUpdates()
    }
  } catch (err) {
    log.warn('updater', 'Scheduled update check failed', {
      error: err instanceof Error ? err.message : String(err)
    })
  } finally {
    quiet = false
  }
}

let checksScheduled = false

/**
 * Check for a new version for as long as the app runs, not only at launch.
 *
 * `enabled` is read on every tick, so turning automatic updates off in
 * Settings stops the checks without a restart. Ticks are wall-clock driven
 * (see `checkDue`), which is what lets a laptop that slept through a check
 * make it soon after waking.
 */
export function scheduleUpdateChecks(enabled: () => boolean): void {
  if (checksScheduled) return
  checksScheduled = true
  const tick = (): void => {
    // Offline, a check can only fail; a "no" from isOnline is reliable.
    if (!enabled() || !net.isOnline()) return
    if (!checkDue(Date.now(), lastAnswered, lastTried)) return
    backgroundCheck().catch(() => undefined)
  }
  setTimeout(tick, CHECK_LAUNCH_DELAY)
  setInterval(tick, CHECK_TICK)
  powerMonitor.on('resume', () => setTimeout(tick, CHECK_RESUME_DELAY))
}

export async function downloadUpdate(): Promise<void> {
  if (isManualPlatform()) {
    await shell.openExternal(currentStatus.downloadUrl || RELEASES_PAGE)
    return
  }
  initUpdater()
  downloadRequested = true
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    emit({ state: 'error', message: err instanceof Error ? err.message : String(err) })
  } finally {
    downloadRequested = false
  }
}

export function quitAndInstall(): void {
  if (isManualPlatform()) {
    void shell.openExternal(currentStatus.downloadUrl || RELEASES_PAGE)
    return
  }
  // isSilent=false to show progress, isForceRunAfter=true to relaunch after install.
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
}

export function openReleasesPage(): Promise<void> {
  return shell.openExternal(releasePage)
}
