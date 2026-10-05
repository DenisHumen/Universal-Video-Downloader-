import { app, net } from 'electron'
import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { homedir, release, userInfo } from 'os'
import {
  buildReport,
  createRateLimiter,
  isReportable,
  postReport,
  type BuiltReport,
  type DetectTrace,
  type FailureContext,
  type ReportEnv,
  type ReportPreview,
  type SendOutcome
} from '@shared/report'
import type { DetectResult, DownloadItem } from '@shared/types'
import { DEFAULT_TEMPLATE, getSettings } from './settings'
import { hasCookies } from './options'
import { getYtdlpStatus } from './ytdlp'
import { ffmpegPath } from './ffmpeg'
import { currentLanguage } from './locale'
import { getSecret, SECRET } from './secrets'
import { log } from './log'

/**
 * The main-process half of error reports: a short memory of what failed, and
 * the one request that sends a report once the user has said yes.
 *
 * What a report says is decided in `@shared/report`, where it can be tested.
 * This half knows the things only main can know — versions, the home folder,
 * the stored secrets that have to be scrubbed out — and owns the network.
 */

/*
  The failures themselves stay here; the window is handed an id. A queue row
  carries that id to the renderer and into history.json, and the engine output
  it points at has no business in either.

  Bounded, oldest first: a watch failing every ten minutes overnight would
  otherwise hold every one of them until quit. Fifty is far more than anyone
  scrolls back through to press "send".
*/
const MAX_KEPT = 50
const failures = new Map<string, FailureContext>()

const limiter = createRateLimiter()

/** Keep a failure for a possible report. No id when it isn't worth offering one. */
export function recordFailure(context: Omit<FailureContext, 'at' | 'flags'>): string | undefined {
  if (!isReportable(context.errorCode)) return undefined
  const settings = getSettings()
  // Off means off: not merely unprompted, but not kept either.
  if (settings.errorReports === 'off') return undefined
  const id = randomUUID()
  failures.set(id, {
    ...context,
    at: Date.now(),
    flags: {
      cookies: hasCookies(settings),
      proxy: Boolean(settings.proxy.trim()),
      customTemplate: settings.filenameTemplate !== DEFAULT_TEMPLATE
    }
  })
  while (failures.size > MAX_KEPT) {
    const oldest = failures.keys().next().value
    if (oldest === undefined) break
    failures.delete(oldest)
  }
  return id
}

/** The hook in the downloader's failure path. */
export function recordDownloadFailure(item: DownloadItem, rawError: string): string | undefined {
  const local = item.kind === 'trim' || item.kind === 'convert'
  const link = local ? (item.sourcePath ?? item.url) : item.sourceUrl || item.url
  return recordFailure({
    stage: 'download',
    kind: item.kind ?? 'download',
    url: link,
    local,
    // By now `url` is whatever the last resolve produced — the stream itself.
    resolvedUrl: !local && item.url !== link ? item.url : undefined,
    title: item.title !== link ? item.title : undefined,
    extractor: item.extractor,
    mode: item.mode,
    quality: item.quality,
    formatId: item.formatId,
    range: item.range,
    precise: item.precise,
    job: local ? item.jobLabel : undefined,
    errorCode: item.errorCode,
    message: item.error || rawError,
    rawError,
    engineOutput: item.log
  })
}

/** A detection result plus what was learned on the way — for the report, never for the window. */
export type DetectVerdict = DetectResult & {
  /** Everything the engine printed on the way to failing. */
  output?: string
  /** The resolver's or the engine's own words, when the message is a translation of them. */
  raw?: string
  extractor?: string
  title?: string
}

/**
 * The hook at each of the detector's failure exits.
 *
 * Always returns a fresh result with only the public fields on it, reportable
 * or not — the engine output rides in on `result` and must not ride out to the
 * window with it.
 */
export function reportDetectFailure(result: DetectVerdict, url: string, trace: DetectTrace): DetectResult {
  if (result.ok) return { ok: true, info: result.info }
  const reportId = recordFailure({
    stage: 'detect',
    url,
    title: result.title,
    extractor: result.extractor ?? trace.resolver,
    errorCode: result.errorCode,
    message: result.error || 'Detection failed.',
    rawError: result.raw ?? result.output,
    engineOutput: result.output,
    detection: trace
  })
  return {
    ok: false,
    error: result.error,
    errorCode: result.errorCode,
    cookieHint: result.cookieHint,
    reportId
  }
}

/*
  ffmpeg's version, asked once and only when a report is actually being built.
  It is worth the spawn: the bundled build is pinned, and "which ffmpeg" has
  already been the whole answer to one class of failure in this app.
*/
let ffmpegVersion: Promise<string | undefined> | null = null

function readFfmpegVersion(): Promise<string | undefined> {
  if (ffmpegVersion) return ffmpegVersion
  ffmpegVersion = new Promise((resolve) => {
    const bin = ffmpegPath()
    if (!bin) {
      resolve('missing')
      return
    }
    let out = ''
    const child = spawn(bin, ['-version'], { windowsHide: true })
    const finish = (): void => {
      clearTimeout(timer)
      resolve(/ffmpeg version (\S+)/.exec(out)?.[1])
    }
    const timer = setTimeout(() => {
      child.kill()
      finish()
    }, 3000)
    child.stdout?.on('data', (chunk: Buffer) => (out += chunk.toString()))
    child.on('error', finish)
    child.on('close', finish)
  })
  return ffmpegVersion
}

/*
  Read at the moment a report is built and dropped straight after. The stored
  passwords are only here so they can be searched for and removed; they never
  reach a field.
*/
async function environment(): Promise<ReportEnv> {
  const settings = getSettings()
  let userName: string | undefined
  try {
    userName = userInfo().username
  } catch {
    /* some sandboxes have no passwd entry */
  }
  const secrets = [
    getSecret(SECRET.telegramToken()),
    ...settings.smbTargets.map((target) => getSecret(SECRET.smbPassword(target.id)))
  ].filter((value): value is string => Boolean(value))

  return {
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    osRelease: release(),
    electron: process.versions.electron,
    ytdlp: getYtdlpStatus().version,
    ffmpeg: await readFfmpegVersion(),
    language: currentLanguage(),
    scrub: {
      homeDir: homedir(),
      userName,
      cookiesFile: settings.cookiesFile,
      proxy: settings.proxy,
      secrets
    }
  }
}

async function build(id: string): Promise<BuiltReport | null> {
  const context = failures.get(id)
  return context ? buildReport(context, await environment()) : null
}

/** Exactly what would be sent, for the user to read first. */
export async function previewReport(id: string): Promise<ReportPreview | null> {
  const report = await build(id)
  return report ? { subject: report.subject, text: report.text } : null
}

/** Send one report. Only ever called from the window, after a click on "send". */
export async function sendReport(id: string): Promise<SendOutcome> {
  const report = await build(id)
  if (!report) return { ok: false, reason: 'expired' }
  if (!limiter.take()) {
    log.warn('report', 'Error report not sent: the hourly or daily limit is reached')
    return { ok: false, reason: 'rateLimited' }
  }
  const outcome = await postReport(report, (url, init) => net.fetch(url, init))
  // Never the contents — the log is exactly the kind of file people attach to things.
  if (outcome.ok) {
    log.info('report', 'Error report sent')
    // One failure, one email: whatever the window asks next, this one is done.
    failures.delete(id)
  } else {
    log.warn('report', 'Error report not sent', { why: outcome.reason })
  }
  return outcome
}
