import { randomUUID } from 'crypto'
import { existsSync, renameSync, rmSync, statSync } from 'fs'
import { dirname, extname, join } from 'path'
import {
  cancelDownload,
  downloadEvents,
  getDownload,
  relocateItem,
  resumeDownload,
  startDownload
} from '../downloader'
import { acquireAwake, releaseAwake } from '../awake'
import { shouldResume } from '../resume'
import { getSettings } from '../settings'
import { getSecret, SECRET } from '../secrets'
import { log } from '../log'
import { awaitDownload, DownloadStopped, type QueueView } from './await-download'
import { carryOver } from './carry-over'
import { downloadUrlFor } from './detect'
import { addRun, getWatch, lastRunFor, updateRun, updateWatch } from './store'
import { uploadFile } from './smb'
import { composeEpisodeNews, composeFailure, sendNotification, TelegramError } from './telegram'
import {
  byStepOrder,
  episodeKey,
  remoteDirFor,
  renameFor,
  settleEpisode,
  type EpisodeOutcome,
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

/** On a step an earlier go at the episode already did, and this one did not repeat. */
const KEPT_NOTE = 'Done by the earlier attempt.'

type StopReason = 'removed' | 'paused'

const STOPPED_NOTE: Record<StopReason, string> = {
  removed: 'Stopped: the series is no longer watched.',
  paused: 'Stopped: the series was paused.'
}

/** The queue item a watch's current episode is waiting on, and whether the watch has been stopped since. */
interface Ticket {
  downloadId: string
  stoppedBy?: StopReason
}

/*
  One per watch at most: a watch's episodes go one after another, and "try
  again" refuses while the schedule is working on the same watch.
*/
const waiting = new Map<string, Ticket>()

/**
 * Stop the download a watch's current episode is waiting on.
 *
 * For a watch being removed or paused. It used to be left alone, and the run
 * went on to download, upload and announce an episode for a series nobody was
 * watching any more - or, removed, failed with "removed from the queue" and was
 * marked handled. The run ends quietly instead: a paused watch fetches the
 * episode again once it is resumed. A run already past its download carries on;
 * it is minutes from done, and stopping it would waste the download.
 */
export function stopEpisode(watchId: string, why: StopReason): void {
  const ticket = waiting.get(watchId)
  if (!ticket || ticket.stoppedBy) return
  ticket.stoppedBy = why
  cancelDownload(ticket.downloadId)
}

export interface EpisodeOptions {
  /**
   * The go whose failure gives up on the episode. Only that failure is sent to
   * Telegram: one message for an episode that could not be fetched, not one per
   * check while a NAS sleeps.
   */
  final: boolean
  /** Which go this is, counting from one, for that message. */
  attempt?: number
  /** The run this one picks up from and takes the place of. The episode's latest, unless "try again" names one. */
  previous?: Run
}

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
 * next episode of this one, are unaffected. The failure is recorded on the run
 * and written to the log; whether the episode is tried again is the caller's
 * business, and only the go that gives up is sent to Telegram.
 *
 * A go after one that failed starts where that one stopped. The file it
 * downloaded is used again while it is still on disk, and an upload that went
 * through is not repeated - otherwise every retry of a refused upload fetched
 * the whole episode again and left a second copy beside the first.
 */
export async function runEpisode(
  watch: Watch,
  ref: EpisodeRef,
  seriesTitle: string,
  options: EpisodeOptions = { final: true }
): Promise<EpisodeOutcome> {
  // The run's record lists its steps in the order the code below takes them, not the order they were added.
  const kinds = [
    ...HEAD,
    ...watch.steps
      .filter((s) => s.enabled && !HEAD.includes(s.kind))
      .sort(byStepOrder)
      .map((s) => s.kind)
  ]

  const latest = options.previous ?? lastRunFor(watch.id, ref)
  const previous = latest && (latest.state === 'failed' || latest.state === 'skipped') ? latest : undefined
  const carried = carryOver(previous, existsSync)

  const run: Run = {
    id: randomUUID(),
    watchId: watch.id,
    season: ref.season,
    episode: ref.episode,
    title: seriesTitle,
    state: 'running',
    steps: kinds.map((kind) => ({ kind, state: 'pending' })),
    filepath: carried.filepath,
    remotePath: carried.remotePath,
    startedAt: Date.now()
  }
  addRun(run, previous?.id)

  const shortId = run.id.slice(0, 8)
  const settings = getSettings()
  let filepath = carried.filepath
  let remotePath = carried.remotePath
  let bytes: number | undefined
  let seconds: number | undefined
  let ticket: Ticket | undefined
  /** The upload already went through on an earlier go: rename and upload are behind us too. */
  const uploaded = Boolean(carried.remotePath)
  /** The queue row the episode's file came from: this go's, or that of the go whose file it kept. */
  let queueId = carried.filepath ? previous?.downloadId : undefined
  /** A setup problem with the bot, found by a message that did not go. */
  let notifyTrouble: string | undefined
  /*
    Held from the end of the download until the run is over. The queue lets go
    of the machine the moment the download completes, and the upload, which
    can take as long again, ran with nothing stopping the machine sleeping.
  */
  const awake = `delivery:${run.id}`

  const values = (): TemplateValues => ({
    title: seriesTitle,
    season: ref.season,
    episode: ref.episode,
    quality: watch.quality,
    ext: filepath ? extname(filepath).replace(/^\./, '') : undefined
  })

  const kept = (kind: PipelineStep['kind'], message = KEPT_NOTE): void => {
    const at = Date.now()
    markStep(run, kind, { state: 'done', startedAt: at, finishedAt: at, message })
  }

  const localFile = (): string => {
    if (!filepath || !existsSync(filepath)) {
      throw new Error('The downloaded file is no longer where it was saved.')
    }
    return filepath
  }

  /**
   * Tell the queue row where its file went - only while it still points at the
   * file being moved, since somebody may have retried that download by hand
   * meanwhile, and its new file is not this run's to account for.
   */
  const follow = (from: string, patch: { filepath?: string; remotePath?: string }): void => {
    if (queueId && getDownload(queueId)?.filepath === from) relocateItem(queueId, patch)
  }

  /** Put the episode on the queue, wait for it, and say where it landed. */
  const download = async (): Promise<string> => {
    const item = await startDownload({
      url: downloadUrlFor(watch, ref),
      title: `${seriesTitle} ${episodeKey(ref)}`,
      thumbnail: watch.thumbnail,
      mode: 'video',
      quality: watch.quality as never
    })
    updateRun(run.id, { downloadId: item.id })
    queueId = item.id

    ticket = { downloadId: item.id }
    waiting.set(watch.id, ticket)
    /*
      Paused or removed while the item was being queued - which on a first
      launch waits for the engine binary to download - and so before there
      was anything for stopping the watch to stop.
    */
    const live = getWatch(watch.id)
    if (!live || !live.enabled) stopEpisode(watch.id, live ? 'paused' : 'removed')

    try {
      /*
        The duplicate check can hand back a paused item for this very episode:
        one the last shutdown cut short with resuming on launch turned off, or
        one somebody paused. The first was the app's doing and is picked back
        up here. The second is the user's decision and stays theirs, so the run
        waits for it - saying where, rather than reading "running" for ever as
        it used to, with the watch never checked again.
      */
      if (shouldResume(item) && !ticket.stoppedBy) {
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
      if (!finished.filepath || !existsSync(finished.filepath)) {
        throw new Error('The download finished but the file is not where it should be.')
      }
      return finished.filepath
    } finally {
      waiting.delete(watch.id)
    }
  }

  try {
    // --- download -----------------------------------------------------------
    if (filepath || uploaded) {
      kept('download')
      log.info(
        'watcher',
        `Picking up ${seriesTitle} ${episodeKey(ref)} where the last attempt stopped`,
        { id: shortId, file: filepath ? 'kept' : 'uploaded' }
      )
    } else {
      markStep(run, 'download', { state: 'running', startedAt: Date.now() })
      log.info('watcher', `Downloading ${seriesTitle} ${episodeKey(ref)}`, { id: shortId })
      filepath = await download()
      markStep(run, 'download', { state: 'done', finishedAt: Date.now() })
    }
    acquireAwake(awake)
    if (filepath && existsSync(filepath)) bytes = statSync(filepath).size
    updateRun(run.id, { filepath })

    // --- rename -------------------------------------------------------------
    const renameStep = watch.steps.find((s) => s.kind === 'rename' && s.enabled)
    if (renameStep && renameStep.kind === 'rename' && uploaded) {
      kept('rename')
    } else if (renameStep && renameStep.kind === 'rename') {
      markStep(run, 'rename', { state: 'running', startedAt: Date.now() })
      // Run again on a kept file too: the name comes out the same, unless the template changed since.
      const source = localFile()
      const name = renameFor(renameStep, values())
      const target = join(dirname(source), name)
      if (target !== source) {
        if (existsSync(target)) rmSync(target, { force: true })
        renameSync(source, target)
        filepath = target
        updateRun(run.id, { filepath })
        follow(source, { filepath: target })
      }
      markStep(run, 'rename', { state: 'done', finishedAt: Date.now(), message: name })
      log.info('watcher', `Renamed to ${name}`, { id: shortId })
    }

    // --- upload -------------------------------------------------------------
    const uploadStep = watch.steps.find((s) => s.kind === 'upload' && s.enabled)
    if (uploadStep && uploadStep.kind === 'upload' && uploaded) {
      kept('upload', remotePath)
    } else if (uploadStep && uploadStep.kind === 'upload') {
      markStep(run, 'upload', { state: 'running', startedAt: Date.now() })
      const source = localFile()
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
        source,
        dir,
        source.split(/[\\/]/).pop() as string
      )
      remotePath = result.remotePath
      seconds = result.seconds
      // Written straight away: a later step that fails must not cost this upload on the retry.
      updateRun(run.id, { remotePath })
      markStep(run, 'upload', { state: 'done', finishedAt: Date.now(), message: remotePath })

      if (uploadStep.deleteLocalAfter) {
        try {
          rmSync(source, { force: true })
          // The share's copy is the only one now, and the row says so instead of a dead path.
          follow(source, { filepath: undefined, remotePath })
          log.info('watcher', 'Removed the local copy after upload', { id: shortId })
        } catch {
          /* the upload is what mattered */
        }
      } else {
        follow(source, { remotePath })
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
        try {
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
        } catch (err) {
          /*
            The episode is where it was meant to go; a message that did not
            follow it is not a failed episode. It used to be one: the run read
            as failed, and the failure notice went out through the very bot
            that had just refused - a second message into a chat already
            rate-limiting, or one that had blocked it. The step says what went
            wrong, and the run is done.
          */
          const why = err instanceof Error ? err.message : String(err)
          markStep(run, 'notify', { state: 'failed', finishedAt: Date.now(), message: why })
          log.warn('watcher', 'Notification failed', { id: shortId, why })
          // A bot that cannot write to that chat fails every message; that belongs on the watch.
          if (err instanceof TelegramError && (err.kind === 'token' || err.kind === 'chat')) {
            notifyTrouble = why
          }
        }
      }
    }

    updateRun(run.id, {
      state: 'done',
      filepath,
      remotePath,
      finishedAt: Date.now(),
      steps: run.steps
    })
    // An episode that went all the way through is proof the chain works again - its messages aside.
    updateWatch(
      watch.id,
      notifyTrouble
        ? { lastRunError: notifyTrouble, lastRunFailedAt: Date.now() }
        : { lastRunError: undefined, lastRunFailedAt: undefined }
    )
    log.info('watcher', `Finished ${seriesTitle} ${episodeKey(ref)}`, { id: shortId })
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err)
    const failing = run.steps.find((s) => s.state === 'running')

    /*
      Stopped on purpose - cancelled or removed in the queue, or the watch
      paused or removed - is not a failure. Nothing to try again at the next
      check, which would undo what somebody just did, and nothing to tell them.
    */
    const stoppedBy = ticket?.stoppedBy
    if (stoppedBy || err instanceof DownloadStopped) {
      const note = stoppedBy ? STOPPED_NOTE[stoppedBy] : why
      if (failing) Object.assign(failing, { state: 'skipped', message: note, finishedAt: Date.now() })
      updateRun(run.id, { state: 'skipped', finishedAt: Date.now(), steps: run.steps })
      log.info('watcher', `Skipped ${seriesTitle} ${episodeKey(ref)}: ${note}`, { id: shortId })
      return stoppedBy ? 'stopped' : 'skipped'
    }

    if (failing) Object.assign(failing, { state: 'failed', message: why, finishedAt: Date.now() })
    updateRun(run.id, {
      state: 'failed',
      filepath,
      remotePath,
      finishedAt: Date.now(),
      steps: run.steps
    })
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
      later that nothing has been downloaded since a password changed. Once,
      when it gives up: a go the next check will repeat is not news yet, and
      the screen already shows it.
    */
    const channel = options.final ? alertChannel(watch) : undefined
    if (channel) {
      await sendNotification(
        channel.token,
        channel.chatId,
        composeFailure(seriesTitle, ref.season, ref.episode, why, options.attempt)
      ).catch(() => undefined)
    }
    return 'failed'
  } finally {
    releaseAwake(awake)
  }

  return 'done'
}

/**
 * Write down what one go at an episode leaves on its watch.
 *
 * Every go used to mark the episode handled, failed or not, so one transient
 * failure lost that episode for good. Now a failure only counts until the cap
 * (`settleEpisode` has the rule). Read fresh, because the go may have taken an
 * hour and the watch changed meanwhile - or went, and then there is nothing to
 * write.
 */
export function recordOutcome(watchId: string, ref: EpisodeRef, outcome: EpisodeOutcome): void {
  const watch = getWatch(watchId)
  const patch = watch && settleEpisode(watch, ref, outcome)
  if (patch) updateWatch(watchId, patch)
}
