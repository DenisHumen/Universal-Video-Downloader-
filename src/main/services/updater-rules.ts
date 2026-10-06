import type { UpdateState } from '@shared/types'

/**
 * The decisions behind the app's own update checks: when the scheduler asks,
 * what it must leave alone, and which file a manual install is sent to.
 *
 * Apart from `updater.ts`, which needs Electron and electron-updater to run, so
 * they can be tested on their own.
 */

const MINUTE = 60_000

/**
 * How long an answer from the release feed lasts.
 *
 * The check used to run once, five seconds after launch, so an app that starts
 * at login and lives in the tray never heard of a release that came out after
 * that morning. Six hours is four requests a day; on macOS and the Linux
 * packages they go to GitHub's REST API, whose unauthenticated limit is sixty
 * an hour per address, so even a shared one has room to spare.
 */
export const CHECK_EVERY = 6 * 60 * MINUTE

/**
 * How soon to try again after a scheduled check that got no answer.
 *
 * A check made at login often runs before the network is up. Waiting the full
 * six hours after that would leave the first answer of the day until the
 * afternoon.
 */
export const CHECK_RETRY = 30 * MINUTE

/** How often the scheduler asks whether a check is due. Free unless one is. */
export const CHECK_TICK = 10 * MINUTE

/** The first look after launch, as before. */
export const CHECK_LAUNCH_DELAY = 5_000

/** The first look after waking up, once Wi-Fi has had a chance to come back. */
export const CHECK_RESUME_DELAY = 60_000

/**
 * Whether a scheduled check is due at `now`.
 *
 * `lastAnswered` is the last time any check, scheduled or asked for, heard back
 * from the feed; `lastTried` the last scheduled attempt, answered or not. Both
 * are wall-clock times, so a laptop that slept through a check makes it on the
 * next tick after waking rather than whenever an interval timer gets round to
 * it. A time in the future means the clock was moved back, and counts as long
 * ago rather than holding checks off until the clock catches up.
 */
export function checkDue(now: number, lastAnswered: number, lastTried: number): boolean {
  const recent = (at: number, span: number): boolean => at > 0 && now - at >= 0 && now - at < span
  if (recent(lastAnswered, CHECK_EVERY)) return false
  if (recent(lastTried, CHECK_RETRY)) return false
  return true
}

/**
 * Whether a check nobody asked for may run while the updater is in `state`.
 *
 * Never over a download in progress or one waiting for "restart to install":
 * a fresh answer would replace that state with "available" and take the
 * restart button away. Not while a check is already running either.
 *
 * "available" is checked again on purpose. A release offered three days ago
 * may have been followed by another since, and on macOS and the Linux packages
 * the button opens the file of the version that was offered - an outdated
 * download, if nobody looks again.
 */
export function mayCheckInBackground(state: UpdateState): boolean {
  return state !== 'checking' && state !== 'downloading' && state !== 'downloaded'
}

export interface ReleaseAsset {
  name: string
  browser_download_url: string
}

/** What this copy of the app is, as far as choosing a download goes. */
export interface InstallKind {
  platform: string
  arch: string
  /** An Intel build running on Apple silicon through Rosetta. */
  translated?: boolean
  /** The contents of resources/package-type: "deb" or "rpm" for the Linux packages. */
  packageType?: string
}

/*
  The architecture names each package format uses, as electron-builder writes
  them into the file names: the release-notes table in release.yml links the
  same names, `-linux-amd64.deb` and `-linux-x86_64.rpm`.
*/
const DEB_ARCH: Record<string, string> = { x64: 'amd64', arm64: 'arm64', ia32: 'i386', arm: 'armhf' }
const RPM_ARCH: Record<string, string> = { x64: 'x86_64', arm64: 'aarch64', ia32: 'i386', arm: 'armv7hl' }

/**
 * The end of the release file name this copy should be offered, or undefined
 * when there is no single right answer.
 *
 * An Intel build under Rosetta is offered the Apple silicon image: it runs
 * natively there, and `process.arch` alone would keep that machine on the
 * emulated build for good. Windows and the AppImage update themselves, and a
 * Linux copy that is neither package is not ours to guess at.
 */
export function installerSuffix(kind: InstallKind): string | undefined {
  if (kind.platform === 'darwin') return `-mac-${kind.translated ? 'arm64' : kind.arch}.dmg`
  if (kind.platform === 'linux') {
    if (kind.packageType === 'deb' && DEB_ARCH[kind.arch]) return `-linux-${DEB_ARCH[kind.arch]}.deb`
    if (kind.packageType === 'rpm' && RPM_ARCH[kind.arch]) return `-linux-${RPM_ARCH[kind.arch]}.rpm`
  }
  return undefined
}

/**
 * The download link for this copy among a release's files.
 *
 * The manual flow used to open the release page, which lists sixteen files,
 * blockmaps and zips among them, and left the user to work out which was
 * theirs. Undefined when nothing matches, and the caller falls back to that
 * page, whose table at least says which file is which.
 */
export function pickDownload(assets: ReleaseAsset[] | undefined, kind: InstallKind): string | undefined {
  const suffix = installerSuffix(kind)
  if (!suffix || !Array.isArray(assets)) return undefined
  const match = assets.find(
    (a) =>
      typeof a?.name === 'string' &&
      typeof a.browser_download_url === 'string' &&
      a.name.endsWith(suffix) &&
      /^https:\/\//i.test(a.browser_download_url)
  )
  return match?.browser_download_url
}
