import { randomUUID } from 'crypto'
import { existsSync, renameSync, rmSync, statSync } from 'fs'
import { dirname, extname, join } from 'path'
import { downloadEvents, getDownload, resumeDownload, startDownload } from '../downloader'
import { shouldResume } from '../resume'
import { getSettings } from '../settings'
import { getSecret, SECRET } from '../secrets'
import { log } from '../log'
import { awaitDownload, type QueueView } from './await-download'
import { downloadUrlFor } from './detect'
import { addRun, updateRun, updateWatch } from './store'
import { uploadFile } from './smb'
import { composeEpisodeNews, composeFailure, sendNotification } from './telegram'
import {
  episodeKey,
  remoteDirFor,
  renameFor,
  type EpisodeRef,
  type PipelineStep,
  type Run,
  type RunStep,
  type TemplateValues,
  type Watch
} from '@shared/automation'

/**
 * Taking one episode through a watch's chain of steps.
 *
 * The download step drives the queue the app already has rather than fetching
 * anything itself. That is the whole reason pause, cancel, retry, the
 * concurrency limit, partial-file cleanup and the history keep working for an
 * automatic download exactly as they do for one somebody started by hand —
 * there is no second downloader to keep in step with the first.
 */

/** Steps that always run first, in this order, whatever the user added after. */
const HEAD: PipelineStep['kind'][] = ['download']

const QUEUE: QueueView = { events: downloadEvents, get: getDownload }

/** On the download step while its queue item is paused. The screen says the same in its own words. */
const PAUSED_NOTE = 'Paused in the queue; resume it there to continue.'

function markStep(run: Run, kind: PipelineStep['kind'], patch: Partial<RunStep>): void {
  const step = run.steps.find((s) => s.kind === kind)
  if (step) Object.assign(step, patch)
  updateRun(run.id, { steps: run.steps })
}

/**
 * Where bad news about this watch goes, or nowhere.
 *
 * The same three conditions for an episode that failed and for a page that has
 * stopped answering: a bot token, a chat, and a watch that asked to be told.
 * A watch without a notify step has said it does not want messages, and a
 * failure is not a reason to start sending them.
 */
export function alertChannel(watch: Watch): { token: string; chatId: string } | undefined {
  const token = getSecret(SECRET.telegramToken())
  const chatId = getSettings().telegramChatId
  if (!token || !chatId) return undefined
  if (!watch.steps.some((s) => s.kind === 'notify' && s.enabled)) return undefined
  return { token, chatId }
}

/**
 * Run one episode through one watch's steps.
 *
 * A step that fails stops this episode and nothing else: other watches, and the
 * next episode of this one, are unaffected. The failure is recorded on the run,
 * written to the log, and — if the watch notifies — sent, because the entire
 * point is that nobody is watching the window.
 */
export async function runEpisode(watch: Watch, ref: EpisodeRef, seriesTitle: string): Promise<Run> {
  const kinds = [
    ...HEAD,
    ...watch.steps.filter((s) => s.enabled && !HEAD.includes(s.kind)).map((s) => s.kind)
  ]

  const run: Run = {
    id: randomUUID(),
    watchId: watch.id,
    season: ref.season,
    episode: ref.episode,
    title: seriesTitle,
    state: 'running',
    steps: kinds.map((kind) => ({ kind, state: 'pending' })),
    startedAt: Date.now()
  }
  addRun(run)

  const shortId = run.id.slice(0, 8)
  const settings = getSettings()
  let filepath: string | undefined
  let remotePath: string | undefined
  let bytes: number | undefined
  let seconds: number | undefined

  const values = (): TemplateValues => ({
    title: seriesTitle,
    season: ref.season,
    episode: ref.episode,
    quality: watch.quality,
    ext: filepath ? extname(filepath).replace(/^\./, '') : undefined
  })

  try {
    // --- download -----------------------------------------------------------
    markStep(run, 'download', { state: 'running', startedAt: Date.now() })
    log.info('watcher', `Downloading ${seriesTitle} ${episodeKey(ref)}`, { id: shortId })

    const item = await startDownload({
      url: downloadUrlFor(watch, ref),
      title: `${seriesTitle} ${episodeKey(ref)}`,
      thumbnail: watch.thumbnail,
      mode: 'video',
      quality: watch.quality as never
    })
    updateRun(run.id, { downloadId: item.id })

    /*
      The duplicate check can hand back a paused item for this very episode:
      one the last shutdown cut short with resuming on launch turned off, or
      one somebody paused. The first was the app's doing and is picked back up
      here. The second is the user's decision and stays theirs, so the run
      waits for it - saying where, rather than reading "running" for ever as
      it used to, with the watch never checked again.
    */
    if (shouldResume(item)) {
      log.info('watcher', 'Resuming the download a shutdown interrupted', { id: shortId })
      resumeDownload(item.id)
    }
    const finished = await awaitDownload(item.id, QUEUE, {
      onPause: () => {
        markStep(run, 'download', { message: PAUSED_NOTE })
        log.info('watcher', `Waiting: ${seriesTitle} ${episodeKey(ref)} is paused in the queue`, {
          id: shortId
        })
      },
      onResume: () => markStep(run, 'download', { message: undefined })
    })
    filepath = finished.filepath
    if (!filepath || !existsSync(filepath)) {
      throw new Error('The download finished but the file is not where it should be.')
    }
    bytes = statSync(filepath).size
    markStep(run, 'download', { state: 'done', finishedAt: Date.now() })

    // --- rename -------------------------------------------------------------
    const renameStep = watch.steps.find((s) => s.kind === 'rename' && s.enabled)
    if (renameStep && renameStep.kind === 'rename') {
      markStep(run, 'rename', { state: 'running', startedAt: Date.now() })
      const name = renameFor(renameStep, values())
      const target = join(dirname(filepath), name)
      if (target !== filepath) {
        if (existsSync(target)) rmSync(target, { force: true })
        renameSync(filepath, target)
        filepath = target
      }
      markStep(run, 'rename', { state: 'done', finishedAt: Date.now(), message: name })
      log.info('watcher', `Renamed to ${name}`, { id: shortId })
    }

    // --- upload -------------------------------------------------------------
    const uploadStep = watch.steps.find((s) => s.kind === 'upload' && s.enabled)
    if (uploadStep && uploadStep.kind === 'upload') {
      markStep(run, 'upload', { state: 'running', startedAt: Date.now() })
      const target = settings.smbTargets.find((t) => t.id === uploadStep.targetId)
      if (!target) throw new Error('The share this watch uploads to is no longer configured.')
      const password = getSecret(SECRET.smbPassword(target.id))
      if (!password) {
        throw new Error(`No password is stored for "${target.name}". Enter it again in Settings.`)
      }

      const dir = remoteDirFor(
        uploadStep.remotePath,
        values(),
        renameStep && renameStep.kind === 'rename' ? renameStep.replacements : []
      )
      const result = await uploadFile(
        target,
        password,
        filepath,
        dir,
        filepath.split(/[\\/]/).pop() as string
      )
      remotePath = result.remotePath
      seconds = result.seconds
      markStep(run, 'upload', { state: 'done', finishedAt: Date.now(), message: remotePath })

      if (uploadStep.deleteLocalAfter) {
        try {
          rmSync(filepath, { force: true })
          log.info('watcher', 'Removed the local copy after upload', { id: shortId })
        } catch {
          /* the upload is what mattered */
        }
      }
    }

    // --- notify -------------------------------------------------------------
    const notifyStep = watch.steps.find((s) => s.kind === 'notify' && s.enabled)
    if (notifyStep) {
      markStep(run, 'notify', { state: 'running', startedAt: Date.now() })
      const token = getSecret(SECRET.telegramToken())
      if (!token || !settings.telegramChatId) {
        markStep(run, 'notify', {
          state: 'skipped',
          finishedAt: Date.now(),
          message: 'Telegram is not set up.'
        })
      } else {
        await sendNotification(
          token,
          settings.telegramChatId,
          composeEpisodeNews({
            series: seriesTitle,
            season: ref.season,
            episode: ref.episode,
            translator: watch.translatorName,
            quality: watch.quality,
            remotePath,
            bytes,
            seconds
          }),
          watch.thumbnail
        )
        markStep(run, 'notify', { state: 'done', finishedAt: Date.now() })
      }
    }

    updateRun(run.id, {
      state: 'done',
      filepath,
      remotePath,
      finishedAt: Date.now(),
      steps: run.steps
    })
    // An episode that went all the way through is proof the chain works again.
    updateWatch(watch.id, { lastRunError: undefined, lastRunFailedAt: undefined })
    log.info('watcher', `Finished ${seriesTitle} ${episodeKey(ref)}`, { id: shortId })
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err)
    const failing = run.steps.find((s) => s.state === 'running')
    if (failing) Object.assign(failing, { state: 'failed', message: why, finishedAt: Date.now() })
    updateRun(run.id, { state: 'failed', filepath, finishedAt: Date.now(), steps: run.steps })
    /*
      On the watch as well as the run. The list, its dot and the mark on the
      tab read the watch, and a run is only seen by somebody who opens that
      watch's history - so every episode could be failing to upload while the
      series read as healthy everywhere a person would glance.
    */
    updateWatch(watch.id, { lastRunError: why, lastRunFailedAt: Date.now() })
    log.error('watcher', `Failed on ${seriesTitle} ${episodeKey(ref)}: ${why}`, { id: shortId })

    /*
      Tell somebody. A failure nobody sees is the failure mode of the whole
      feature: the window is closed, and the alternative is discovering weeks
      later that nothing has been downloaded since a password changed.
    */
    const channel = alertChannel(watch)
    if (channel) {
      await sendNotification(
        channel.token,
        channel.chatId,
        composeFailure(seriesTitle, ref.season, ref.episode, why)
      ).catch(() => undefined)
    }
  }

  return run
}

/**
 * Mark an episode handled.
 *
 * Done whether the run succeeded or failed, and deliberately: a watch that
 * retried a broken episode on every check would download it over and over,
 * unattended, for as long as the site kept the file broken. The run is in the
 * history and the failure was notified; retrying is the user's call.
 */
export function markHandled(watch: Watch, ref: EpisodeRef): void {
  const seen = [...watch.seen, ref]
  updateWatch(watch.id, { seen })
}
