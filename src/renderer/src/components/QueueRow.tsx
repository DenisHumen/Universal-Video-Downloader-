import { memo, useId, useState } from 'react'
import { AnimatePresence, m } from 'framer-motion'
import { collapse, listItem } from '../lib/motion'
import {
  ArrowUp,
  ChevronDown,
  MoreHorizontal,
  ExternalLink,
  Link2,
  FileVideo,
  FolderOpen,
  Pause,
  Play,
  ProcessStop,
  RotateCw,
  Scissors,
  Trash2,
  Upload,
  X
} from '../ui/icons'
import type { DownloadItem } from '@shared/types'
import { pageLinkOf } from '@shared/library'
import { useStore } from '../store'
import { formatBytes, formatEta, formatSpeed, splitPath } from '../lib/format'
import { errorReport, errorText } from '../lib/errors'
import { useT } from '../i18n'
import { STATE_META } from '../lib/states'
import { toast } from '../lib/toast'
import { showFile } from '../lib/showFile'
import { cancelLosesWork, failedRecordingCanBeSaved } from '../lib/downloads'
import ConfirmDialog from './ConfirmDialog'
import MediaJobModal, { type JobMode } from './MediaJobModal'
import Thumbnail from './Thumbnail'
import ReportPrompt, { useReportOffer } from './ReportPrompt'
import FixBar from './FixBar'
import EngineOutput from './EngineOutput'
import SendToShareDialog from './SendToShareDialog'
import { queueDownload } from '../lib/queue'
import { IconButton, Menu, type MenuItem } from '../ui'

interface Props {
  item: DownloadItem
  /** Position in the visible list — the row's mono index. */
  index: number
  /** Fade in on mount: true for entries that arrive while the queue is open. */
  animateIn?: boolean
  /** The section this row opens, when it is the first of one. */
  heading?: string
}


/**
 * One queue entry, as a row in a ruled list.
 *
 * The old queue stacked rounded, bordered, blurred cards with a lit top edge —
 * four separate treatments per item, repeated down the screen, which made a
 * list of twelve downloads read as twelve objects rather than one list.
 * Hairlines between rows carry the same separation at a fraction of the visual
 * cost.
 */
function QueueRow({ item, index, animateIn = true, heading }: Props): JSX.Element {
  const t = useT()
  const [logOpen, setLogOpen] = useState(false)
  // The engine output mounts only while open, so aria-controls is set only then.
  const logId = useId()
  const [jobModal, setJobModal] = useState<JobMode | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [sending, setSending] = useState(false)
  const hasShare = useStore((s) => (s.settings?.smbTargets?.length ?? 0) > 0)
  const meta = STATE_META[item.state]
  const landed =
    item.filepath ?? (item.remotePath ? t('queue.onShare', { path: item.remotePath }) : undefined)
  const jobKindLabel =
    item.kind === 'trim' ? t('job.trim') : item.kind === 'convert' ? t('job.convert') : null
  const active =
    item.state === 'downloading' || item.state === 'processing' || item.state === 'detecting'
  const percent = Math.round(item.percent || 0)
  /*
    Whether the phase that is running can say how far along it is.

    The engine answers this directly now. The fallback covers entries persisted
    by an older build, and the case it always covered: streams with no byte
    total (HLS, no Content-Length) give yt-dlp nothing to compute a percentage
    from, and a bar pinned at 0% reads as "stuck", not as "unknown".
  */
  /*
    `??`, not `||`: the engine sends `false` when it knows the figure, and only
    the gap before its first progress line leaves this undefined. `active` gates
    it either way — a paused or errored row must not go on animating a step that
    is not running.
  */
  const indeterminate =
    active && (item.indeterminate ?? (percent === 0 && !item.totalBytes))

  /**
   * Which post-processing step is running, when it is one worth naming — and
   * only while something actually is. A paused or errored row that still names
   * a step reads as though the work were carrying on without it.
   */
  const phaseLabel = !active
    ? null
    : item.savingLive
      ? t('phase.saveLive')
      : item.postprocess === 'trim'
      ? t('phase.trim')
      : item.postprocess === 'merge'
        ? t('phase.merge')
        : item.postprocess === 'convert'
          ? t('phase.convert')
          : null
  /*
    The resolution this entry will actually produce.

    `best` is a promise, not a number, and the row used to print nothing at all
    for it — so the one thing a person checks a queue for ("did it pick 1080 or
    360?") was the one thing it wouldn't say. `targetHeight` is worked out from
    the real format list when the download is queued; the preset is the
    fallback for entries queued before that existed.
  */
  const qualityLabel =
    item.mode === 'audio' || item.formatId
      ? null
      : item.targetHeight
        ? `${item.targetHeight}p`
        : item.quality && item.quality !== 'best' && item.quality !== 'audio'
          ? `${item.quality}p`
          : null

  /*
    A broadcast has no end for the row to wait for and cannot be picked up where
    it left off, so its way out is the labelled button rather than pause. A
    paused row got there through "pause all" or a restart, and still has its
    partial to save, and so has a recording that failed partway, unless the
    failure was saving it.
  */
  const canStopSave =
    item.live &&
    !item.savingLive &&
    (item.state === 'downloading' ||
      // A wait paused before anything came down has nothing to save.
      (item.state === 'paused' && (!item.waitForVideo || Boolean(item.partialPaths?.length))) ||
      failedRecordingCanBeSaved(item))

  const facts = [
    item.live && item.state === 'downloading' ? t('queue.recording') : null,
    phaseLabel,
    jobKindLabel,
    item.jobLabel,
    qualityLabel,
    /*
      The line loses its end first when the row is narrow, so the order is what
      survives: how much, then how long, then the speed, which the queue's
      header already adds up. A size cut to "53…" says nothing at all.
    */
    item.state === 'downloading' && item.downloadedBytes
      ? item.totalBytes
        ? `${formatBytes(item.downloadedBytes)} / ${formatBytes(item.totalBytes)}`
        : formatBytes(item.downloadedBytes)
      : null,
    active && item.eta ? t('queue.eta', { time: formatEta(item.eta) }) : null,
    active && item.speed ? formatSpeed(item.speed) : null,
    item.state === 'completed' && item.totalBytes ? formatBytes(item.totalBytes) : null,
    item.state === 'queued' && (item.attempts || 0) > 0 ? t('queue.retryingIn') : null,
    item.state === 'waiting' ? t('queue.waitingHint') : null
  ].filter(Boolean)

  /*
    The link this entry came from. Internal schemes (`uvd-rezka://`,
    `uvd-yummy://`) are addresses the resolver invented for itself — copying one
    hands the user a string no other program understands — so link actions only
    appear for real web addresses.
  */
  const sourceLink = item.sourceUrl || item.url
  const hasWebLink = item.kind !== 'trim' && item.kind !== 'convert' && /^https?:\/\//i.test(sourceLink)
  // The same, for going back to the page: a clip or conversion has one too, through the file it was made from.
  const pageLink = pageLinkOf(item)

  /*
    A failed row offers a report behind one small toggle rather than with the
    whole card open: a queue of twenty failures should read as twenty rows, not
    twenty questions.
  */
  const failure = {
    reportId: item.state === 'error' ? item.reportId : undefined,
    stage: 'download' as const,
    url: item.kind === 'trim' || item.kind === 'convert' ? (item.sourcePath ?? item.url) : sourceLink,
    errorCode: item.errorCode
  }
  const canReport = useReportOffer(failure)
  // Open for one failure: a retry that fails again starts closed, like any new failure.
  const [reportOpenFor, setReportOpenFor] = useState<string | null>(null)
  const reportOpen = Boolean(failure.reportId) && reportOpenFor === failure.reportId

  const copyLink = async (link: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(link)
      toast(t('common.copied'), 'success')
    } catch {
      /* clipboard unavailable */
    }
  }

  const savedAt = splitPath(item.filepath ?? '')

  /*
    6.2: a fix that changes the request (audio only, another folder) queues
    it afresh in place of this row; the row goes first, so the new one is not
    taken for a duplicate of it.
  */
  const requeue = async (change: { mode?: 'audio'; outputDir?: string; waitForVideo?: boolean }): Promise<void> => {
    await window.api.removeDownload(item.id)
    await queueDownload({
      // The page, not the stream a resolver found on it: that address expires and carries no referer.
      url: item.sourceUrl || item.url,
      title: item.title,
      thumbnail: item.thumbnail,
      mode: change.mode ?? item.mode,
      playlist: item.playlist,
      quality: change.mode === 'audio' ? 'audio' : item.quality,
      formatId: change.mode === 'audio' ? undefined : item.formatId,
      targetHeight: change.mode === 'audio' ? undefined : item.targetHeight,
      duration: item.duration,
      extractor: item.extractor,
      uploader: item.uploader,
      series: item.series,
      // As on Home: what a wait turns into may well be a broadcast.
      live: (change.waitForVideo ?? item.waitForVideo) ? true : item.live,
      section: item.range,
      preciseSection: item.precise,
      subtitles: change.mode === 'audio' ? undefined : item.subtitles,
      audioLanguage: item.audioLanguage,
      waitForVideo: change.waitForVideo ?? item.waitForVideo,
      outputDir: change.outputDir ?? item.outputDir
    })
  }

  const running =
    item.state === 'downloading' ||
    item.state === 'queued' ||
    item.state === 'processing' ||
    item.state === 'detecting' ||
    item.state === 'waiting'

  // A wait is the one place someone may well ask what the engine is up to; `active` also drives the bar.
  const showsOutput = active || item.state === 'paused' || item.state === 'waiting'

  // Until it has started there is nothing being recorded for Stop and Save to keep.
  const canPause =
    running &&
    (!item.live ||
      (Boolean(item.waitForVideo) && item.state !== 'downloading' && item.state !== 'processing'))

  /*
    Everything but the row's one primary action and its remove, behind "⋯".
    Each used to be an icon of its own - up to eight on a finished row - so
    the action the row was about was one square among many, and a narrow
    window left the title ten characters.
  */
  const menu: MenuItem[] = [
    ...(pageLink
      ? [
          { label: t('queue.copyLink'), icon: <Link2 size={14} />, onSelect: () => void copyLink(pageLink) },
          {
            label: t('queue.openSource'),
            icon: <ExternalLink size={14} />,
            onSelect: () => void window.api.openExternal(pageLink)
          }
        ]
      : []),
    ...(item.state === 'queued'
      ? [
          {
            label: t('queue.moveUp'),
            icon: <ArrowUp size={14} />,
            onSelect: () => void window.api.prioritizeDownload(item.id)
          }
        ]
      : []),
    ...(item.state === 'completed' && item.filepath
      ? [
          { label: t('trim.openEditor'), icon: <Scissors size={14} />, onSelect: () => setJobModal('trim') },
          { label: t('convert.open'), icon: <FileVideo size={14} />, onSelect: () => setJobModal('convert') },
          ...(hasShare
            ? [{ label: t('queue.sendShare'), icon: <Upload size={14} />, onSelect: () => setSending(true) }]
            : [])
        ]
      : []),
    ...(item.state === 'completed' && pageLink
      ? [
          {
            label: t('library.again'),
            icon: <RotateCw size={14} />,
            onSelect: () => useStore.getState().requestDetect(pageLink)
          }
        ]
      : []),
    ...(item.state === 'completed' && item.filepath
      ? [
          {
            label: t('library.delete'),
            icon: <Trash2 size={14} />,
            danger: true,
            onSelect: () => setConfirmDelete(true)
          }
        ]
      : []),
    ...(showsOutput
      ? [{ label: t('queue.log'), icon: <FileVideo size={14} />, onSelect: () => setLogOpen((v) => !v) }]
      : [])
  ]

  const deleteFile = async (): Promise<void> => {
    setConfirmDelete(false)
    const outcome = await window.api.trashLibraryFile(item.filepath!)
    if (outcome === 'noEntry') {
      toast(t('queue.notInLibrary'), 'error')
    } else if (outcome === 'failed') {
      toast(t('library.trashFailed'), 'error')
    } else {
      toast(t('library.trashed'), 'success')
      // The row was only about that file, and its Play would now open nothing.
      void window.api.removeDownload(item.id)
    }
  }

  /* What the second line says, after the state: progress, speed, time left, quality. */
  const progressFact =
    item.state === 'downloading' || item.state === 'processing'
      ? indeterminate && percent === 0
        ? null
        : `${percent}%`
      : null
  const lineFacts = [progressFact, ...facts]
  /*
    The track is for work that has started or been stopped part way. A queued
    row has nothing to show on it, and a finished one says so in words.
  */
  const showTrack = ['downloading', 'processing', 'detecting', 'paused'].includes(item.state)

  return (
    <m.li
      data-row={item.id}
      /*
        Measured only when the row moves or changes state. With no dependency,
        framer measured the layout on every render, and a running download
        renders its row with every progress tick. Neither value changes on a
        tick; a row inserted or removed above changes `index`, so the rows
        below still slide.
      */
      layout
      layoutDependency={`${item.state}:${index}`}
      initial={animateIn ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={listItem}
      className="group relative border-b border-edge"
    >
      {/* In the row rather than between rows, so the list stays one <ul> of <li>s. */}
      {heading && <p className="label border-b border-edge pb-2 pt-5">{heading}</p>}
      {/* The whole row, its error and buttons included. `bg-raise` was the sheet's own colour: no visible hover at all. */}
      <div className="transition-colors duration-fast ease-ease hover:bg-fill/[0.04]">
      <div className="flex items-center gap-3 py-2.5 pl-1 pr-1">
        <span className="mono w-6 shrink-0 text-center text-meta tabular-nums text-ink-3">
          {String(index + 1).padStart(2, '0')}
        </span>

        <div className="relative h-9 w-16 shrink-0 overflow-hidden rounded-1 bg-sink">
          <Thumbnail
            src={item.thumbnail}
            pageUrl={item.sourceUrl ?? item.originUrl}
            className="h-full w-full object-cover"
            fallback={<div className="h-full w-full bg-sink" />}
          />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-ink" title={item.title}>
            {item.title}
          </p>
          <p className="numeric mt-0.5 flex items-center gap-2 truncate text-meta text-ink-2">
            <span className={`inline-flex shrink-0 items-center gap-1.5 ${meta.text}`}>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
              {t(meta.label)}
            </span>
            {item.state === 'queued' && (item.priority ?? 0) > 0 && (
              <span className="shrink-0 text-accent-ink">{t('queue.next')}</span>
            )}
            {lineFacts.filter(Boolean).length > 0 && (
              <span className="truncate">{lineFacts.filter(Boolean).join(' · ')}</span>
            )}
          </p>
        </div>

        {/*
          Always visible: the state's one primary action, remove, and the menu.
          These were `opacity-0` until hover once, which reads as tidy and
          means a user who never moves the mouse over a row cannot discover
          that pause or "show in folder" exist at all.
        */}
        <div className="flex shrink-0 items-center gap-0.5">
          {item.state === 'completed' && item.filepath && (
            <>
              <IconButton
                label={t('common.play')}
                icon={<Play size={16} />}
                onClick={() =>
                  // The OS answers with an error rather than throwing; the click used to do nothing.
                  void window.api.openPath(item.filepath!).then((why) => {
                    if (why) toast(t('queue.openFailed'), 'error')
                  })
                }
              />
              <IconButton
                label={t('common.showInFolder')}
                icon={<FolderOpen size={16} />}
                onClick={() => void showFile(item.filepath!)}
              />
            </>
          )}
          {canStopSave && (
            <button
              type="button"
              className="btn-quiet mr-1"
              data-action="stop-save"
              title={t('queue.stopSaveHint')}
              onClick={() => void window.api.stopLiveRecording(item.id)}
            >
              <ProcessStop size={14} />
              {t('queue.stopSave')}
            </button>
          )}
          {canPause && (
            <IconButton label={t('common.pause')} icon={<Pause size={16} />} onClick={() => window.api.pauseDownload(item.id)} />
          )}
          {item.state === 'paused' && (
            <IconButton label={t('common.resume')} icon={<Play size={16} />} onClick={() => window.api.resumeDownload(item.id)} />
          )}
          {(item.state === 'error' || item.state === 'canceled') && (
            <IconButton label={t('common.retry')} icon={<RotateCw size={16} />} onClick={() => window.api.retryDownload(item.id)} />
          )}
          {/*
            Remove, in the form the state allows. A row still working is
            cancelled - `processing` too: a merge on a long video takes
            minutes, and it was once the one running state with no way out -
            and a bin beside cancel read as a second way to say the same thing.
            A row that has stopped is removed.
          */}
          {running || item.state === 'paused' ? (
            <IconButton
              className="hover:text-bad"
              data-uvd="cancel-download"
              label={t('common.cancel')}
              icon={<X size={16} />}
              onClick={() => (cancelLosesWork(item) ? setConfirmCancel(true) : void window.api.cancelDownload(item.id))}
            />
          ) : (
            <IconButton
              className="hover:text-bad"
              label={t('queue.removeRow')}
              icon={<Trash2 size={16} />}
              onClick={() => window.api.removeDownload(item.id)}
            />
          )}
          {menu.length > 0 && (
            <Menu
              label={t('queue.more')}
              items={menu}
              trigger={(p) => <IconButton {...p} label={t('queue.more')} icon={<MoreHorizontal size={16} />} />}
            />
          )}
        </div>
      </div>

      {/*
        Progress: a 3px track across the whole row, along its bottom edge.

        The fill is a plain style with a CSS transition, not a framer-motion
        `animate`: that rode the frame clock, which stalls in a throttled
        window - exactly where a download sits while it runs.

        When a site reports no total size, `percent` is genuinely unknown, and
        a confident 0% that never moves reads as stuck. A band travelling
        across the part that is left says the true thing: working, size not
        known. A trimmed download fills to 90% on the last byte, then the
        remaining tenth visibly works while the re-encode runs.
      */}
      {showTrack && (
        <div
          className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden bg-sink"
          role="progressbar"
          aria-valuenow={indeterminate ? undefined : percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={phaseLabel ?? t(meta.label)}
        >
          <div
            className={`h-full transition-[width] duration-base ease-ease ${item.state === 'paused' ? 'bg-edge-strong' : 'bg-accent-bright'}`}
            style={{ width: `${percent}%` }}
          />
          {indeterminate && percent < 100 && (
            <div className="absolute inset-y-0 right-0 overflow-hidden" style={{ left: `${percent}%` }}>
              <div className="progress-indeterminate h-full bg-accent-bright/45" />
            </div>
          )}
        </div>
      )}

      {logOpen && showsOutput && (
        <div className="pb-3 pl-[116px] pr-1">
          <EngineOutput id={item.id} running={active || item.state === 'waiting'} />
        </div>
      )}

      {/*
        Outcome: the path it landed at, or why it didn't. An automated episode
        whose local copy was deleted once it was on the share has only the
        share's path left; the buttons that need a local file are gone already.
      */}
      {(item.state === 'completed' || item.state === 'error') && (
        <div className="pb-3 pl-[116px] pr-1">
          {/*
            Each translated failure says what happened and then what to do,
            and one truncated line kept only the first half. A path gives up
            its folder before its file name, which is the part people look for.
          */}
          {item.state === 'error' ? (
            <p
              className="selectable line-clamp-3 break-words text-meta text-bad"
              title={errorText(t, item)}
            >
              {errorText(t, item)}
              {item.keptPartial && (
                <button
                  type="button"
                  className="selectable mono mt-1 block max-w-full truncate text-left text-ink-2 underline"
                  title={t('common.showInFolder')}
                  onClick={() => window.api.showInFolder(item.keptPartial!)}
                >
                  {item.keptPartial}
                </button>
              )}
            </p>
          ) : (
            item.filepath ? (
              <p className="selectable mono flex min-w-0 text-meta" title={item.filepath}>
                <span className="min-w-0 shrink truncate text-ink-3">{savedAt.dir}</span>
                <span className="max-w-full shrink-0 truncate text-ink-2">{savedAt.base}</span>
              </p>
            ) : (
              <p className="selectable mono truncate text-meta text-ink-3" title={landed}>
                {landed}
              </p>
            )
          )}
          {item.filepath && item.remotePath && (
            <p className="selectable mono mt-1 truncate text-meta text-ink-3" title={item.remotePath}>
              {t('queue.onShare', { path: item.remotePath })}
            </p>
          )}
          {item.log && (
            <>
              <button
                onClick={() => setLogOpen((v) => !v)}
                aria-expanded={logOpen}
                aria-controls={logOpen ? logId : undefined}
                className="mt-2 flex items-center gap-1 text-meta font-bold text-ink-2 transition-colors duration-fast ease-ease hover:text-ink"
              >
                {t('queue.log')}
                <m.span animate={{ rotate: logOpen ? 180 : 0 }} transition={{ duration: 0.16 }}>
                  <ChevronDown size={12} />
                </m.span>
              </button>
              <AnimatePresence initial={false}>
                {logOpen && (
                  <m.pre
                    {...collapse}
                    id={logId}
                    className="selectable mono mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-1 bg-sink px-3 py-2.5 text-caption leading-relaxed text-ink-2"
                  >
                    {item.log}
                  </m.pre>
                )}
              </AnimatePresence>
            </>
          )}
          {item.state === 'error' && (
            <FixBar
              errorCode={item.errorCode}
              cookieHint={item.cookieHint}
              url={hasWebLink ? sourceLink : ''}
              retryKey={item.id}
              copyText={errorReport(t, item)}
              onRetry={() => void window.api.retryDownload(item.id)}
              onAudioOnly={() => void requeue({ mode: 'audio' })}
              onChangeFolder={(dir) => void requeue({ outputDir: dir })}
              onWaitForVideo={() => void requeue({ waitForVideo: true })}
              report={
                canReport
                  ? { open: reportOpen, onToggle: () => setReportOpenFor(reportOpen ? null : (failure.reportId ?? null)) }
                  : undefined
              }
            />
          )}
          {/* Stays mounted once answered, so it can say how sending went. */}
          {reportOpen && <ReportPrompt key={failure.reportId} {...failure} />}
        </div>
      )}

      {jobModal && <MediaJobModal item={item} mode={jobModal} onClose={() => setJobModal(null)} />}
      {/* Cancelling deletes the partial files, so a paused 95% is worth one question. */}
      {confirmCancel && (running || item.state === 'paused') && (
        <ConfirmDialog
          title={t('queue.cancelConfirm')}
          body={t('queue.cancelBody', {
            amount: item.percent > 0 ? `${Math.round(item.percent)}%` : formatBytes(item.downloadedBytes)
          })}
          confirmLabel={t('queue.cancelButton')}
          onConfirm={() => {
            setConfirmCancel(false)
            void window.api.cancelDownload(item.id)
          }}
          onCancel={() => setConfirmCancel(false)}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={t('library.deleteConfirm')}
          body={t('library.deleteBody', { title: item.title })}
          confirmLabel={t('library.deleteButton')}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void deleteFile()}
        />
      )}
      {sending && <SendToShareDialog id={item.id} title={item.title} onClose={() => setSending(false)} />}
    </div>
    </m.li>
  )
}

/**
 * Memoised, because a queue redraws far more often than it changes.
 *
 * The store replaces one entry per progress update and leaves the rest of the
 * array alone, but the array itself is new every time — so without this, a
 * single download reporting its progress re-rendered every row in the list,
 * several times a second, for the lifetime of the transfer. That is what a
 * long queue feeling sluggish was made of.
 *
 * The comparison is deliberately shallow on identity: `item` is a fresh object
 * exactly when that row's data changed, and `index` when the list reordered.
 * `animateIn` never changes for a mounted row, so comparing it costs nothing.
 */
export default memo(
  QueueRow,
  (a, b) =>
    a.item === b.item &&
    a.index === b.index &&
    a.animateIn === b.animateIn &&
    a.heading === b.heading
)
