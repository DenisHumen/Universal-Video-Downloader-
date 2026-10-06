import { memo, useId, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { collapse, listItem } from '../lib/motion'
import {
  ArrowUp,
  ChevronDown,
  Copy,
  ExternalLink,
  Link2,
  FileVideo,
  FolderOpen,
  Pause,
  Play,
  RotateCw,
  Scissors,
  Trash2,
  X
} from 'lucide-react'
import type { DownloadItem } from '@shared/types'
import { formatBytes, formatEta, formatSpeed, splitPath } from '../lib/format'
import { errorReport, errorText } from '../lib/errors'
import { useT, type TranslationKey } from '../i18n'
import { toast } from '../lib/toast'
import MediaJobModal, { type JobMode } from './MediaJobModal'
import Thumbnail from './Thumbnail'
import ReportPrompt, { useReportOffer } from './ReportPrompt'

interface Props {
  item: DownloadItem
  /** Position in the visible list — the row's mono index. */
  index: number
  /** Fade in on mount: true for entries that arrive while the queue is open. */
  animateIn?: boolean
}

const STATE_META: Record<DownloadItem['state'], { label: TranslationKey; dot: string; text: string }> =
  {
    queued: { label: 'state.queued', dot: 'bg-edge-strong', text: 'text-ink-3' },
    detecting: { label: 'state.detecting', dot: 'bg-warn', text: 'text-warn' },
    downloading: { label: 'state.downloading', dot: 'bg-accent', text: 'text-accent-ink' },
    processing: { label: 'state.processing', dot: 'bg-accent', text: 'text-accent-ink' },
    completed: { label: 'state.completed', dot: 'bg-good', text: 'text-good' },
    error: { label: 'state.error', dot: 'bg-bad', text: 'text-bad' },
    paused: { label: 'state.paused', dot: 'bg-edge-strong', text: 'text-ink-3' },
    canceled: { label: 'state.canceled', dot: 'bg-edge-strong', text: 'text-ink-3' }
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
function QueueRow({ item, index, animateIn = true }: Props): JSX.Element {
  const t = useT()
  const [logOpen, setLogOpen] = useState(false)
  // The engine output mounts only while open, so aria-controls is set only then.
  const logId = useId()
  const [jobModal, setJobModal] = useState<JobMode | null>(null)
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

  const facts = [
    phaseLabel,
    jobKindLabel,
    item.jobLabel,
    qualityLabel,
    active && item.speed ? formatSpeed(item.speed) : null,
    active && item.eta ? t('queue.eta', { time: formatEta(item.eta) }) : null,
    item.state === 'downloading' && item.downloadedBytes
      ? item.totalBytes
        ? `${formatBytes(item.downloadedBytes)} / ${formatBytes(item.totalBytes)}`
        : formatBytes(item.downloadedBytes)
      : null,
    item.state === 'completed' && item.totalBytes ? formatBytes(item.totalBytes) : null,
    item.state === 'queued' && (item.attempts || 0) > 0 ? t('queue.retryingIn') : null
  ].filter(Boolean)

  /*
    The link this entry came from. Internal schemes (`uvd-rezka://`,
    `uvd-yummy://`) are addresses the resolver invented for itself — copying one
    hands the user a string no other program understands — so link actions only
    appear for real web addresses.
  */
  const sourceLink = item.sourceUrl || item.url
  const hasWebLink = item.kind !== 'trim' && item.kind !== 'convert' && /^https?:\/\//i.test(sourceLink)

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

  const copyLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(sourceLink)
      toast(t('common.copied'), 'success')
    } catch {
      /* clipboard unavailable */
    }
  }

  const savedAt = splitPath(item.filepath ?? '')

  const copyError = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(errorReport(t, item))
      toast(t('common.copied'), 'success')
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <motion.li
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
      <div className="flex items-center gap-3.5 py-3 pl-1 pr-1 transition-colors duration-fast ease-ease group-hover:bg-raise">
        <span className="mono w-6 shrink-0 text-center text-[12px] tabular-nums text-ink-3">
          {String(index + 1).padStart(2, '0')}
        </span>

        <div className="relative h-11 w-[74px] shrink-0 overflow-hidden rounded-1 bg-sink">
          <Thumbnail
            src={item.thumbnail}
            pageUrl={item.sourceUrl}
            className="h-full w-full object-cover"
            fallback={<div className="h-full w-full bg-sink" />}
          />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium text-ink" title={item.title}>
            {item.title}
          </p>
          <p className="mono mt-1 flex items-center gap-2 truncate text-[12px] text-ink-2">
            <span className={`inline-flex items-center gap-1.5 ${meta.text}`}>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
              {t(meta.label)}
            </span>
            {item.state === 'queued' && (item.priority ?? 0) > 0 && (
              <span className="text-accent-ink">{t('queue.next')}</span>
            )}
            {facts.length > 0 && <span className="truncate">{facts.join('  ·  ')}</span>}
          </p>
        </div>

        {/*
          Progress: a real bar with a visible track, plus the number.

          Two things were wrong here. The fill was a framer-motion `animate`,
          so the bar rode the frame clock — the same clock that stalls in a
          throttled window, which is exactly where a download sits while it
          runs. It is a plain style with a CSS transition now: the browser
          moves it whether or not anything is scheduling animation frames.

          And when a site reports no total size, `percent` is genuinely
          unknown. It used to render as a confident `0%` that never moved until
          the download finished and the bar vanished. An indeterminate band and
          the bytes downloaded so far say the true thing: working, size not
          known.
        */}
        {!['completed', 'error', 'canceled'].includes(item.state) && (
          <div className="flex w-24 shrink-0 items-center gap-2.5 lg:w-32">
            <div
              className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-sink"
              role="progressbar"
              aria-valuenow={indeterminate ? undefined : percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={phaseLabel ?? t(meta.label)}
            >
              {/*
                The bar carries both halves of the job: what is finished is
                solid, and what is running without a figure to report is a band
                travelling across the part that is left. A trimmed download
                fills to 90% on the last byte, then the remaining tenth visibly
                works while the re-encode runs — rather than standing still and
                jumping to done.
              */}
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-base ease-ease"
                style={{ width: `${percent}%` }}
              />
              {indeterminate && percent < 100 && (
                <div
                  className="absolute inset-y-0 right-0 overflow-hidden"
                  style={{ left: `${percent}%` }}
                >
                  <div className="progress-indeterminate h-full bg-accent/45" />
                </div>
              )}
            </div>
            {/* The bar already carries the number's meaning; on a narrow window
                the title needs those 40px more than the reader does. */}
            <span className="mono hidden w-9 shrink-0 text-right text-[12px] tabular-nums text-ink-2 md:block">
              {(indeterminate || item.state === 'queued') && percent === 0 ? '—' : `${percent}%`}
            </span>
          </div>
        )}

        {/*
          Always visible.
          These were `opacity-0` until hover, which reads as tidy and means a
          user who never moves the mouse over a row cannot discover that pause,
          cancel or "show in folder" exist at all. Critical actions do not hide.
        */}
        <div className="flex shrink-0 items-center gap-1">
          {item.state === 'queued' && (
            <button
              className="btn-icon-bare"
              title={t('queue.moveUp')}
              aria-label={t('queue.moveUp')}
              onClick={() => window.api.prioritizeDownload(item.id)}
            >
              <ArrowUp size={15} />
            </button>
          )}
          {/*
            Link actions are conveniences, so they are the first thing to yield
            when the row runs out of width — measured at 660px, six buttons plus
            the progress block left the title 86px, which is about ten
            characters. Pause, cancel, remove and "next" never hide.
          */}
          {hasWebLink && (
            <>
              <button
                className="btn-icon-bare hidden lg:inline-flex"
                title={t('queue.copyLink')}
                aria-label={t('queue.copyLink')}
                onClick={copyLink}
              >
                <Link2 size={15} />
              </button>
              <button
                className="btn-icon-bare hidden lg:inline-flex"
                title={t('queue.openSource')}
                aria-label={t('queue.openSource')}
                onClick={() => window.api.openExternal(sourceLink)}
              >
                <ExternalLink size={15} />
              </button>
            </>
          )}
          {item.state === 'completed' && item.filepath && (
            <>
              <button
                className="btn-icon-bare"
                title={t('common.play')}
                aria-label={t('common.play')}
                onClick={() =>
                  // The OS answers with an error rather than throwing; the click used to do nothing.
                  void window.api.openPath(item.filepath!).then((why) => {
                    if (why) toast(t('queue.openFailed'), 'error')
                  })
                }
              >
                <Play size={15} />
              </button>
              <button className="btn-icon-bare" title={t('trim.openEditor')} aria-label={t('trim.openEditor')} onClick={() => setJobModal('trim')}>
                <Scissors size={15} />
              </button>
              <button className="btn-icon-bare" title={t('convert.open')} aria-label={t('convert.open')} onClick={() => setJobModal('convert')}>
                <FileVideo size={15} />
              </button>
              <button
                className="btn-icon-bare"
                title={t('common.showInFolder')}
                aria-label={t('common.showInFolder')}
                onClick={() => window.api.showInFolder(item.filepath!)}
              >
                <FolderOpen size={15} />
              </button>
            </>
          )}
          {(item.state === 'downloading' ||
            item.state === 'queued' ||
            item.state === 'processing' ||
            item.state === 'detecting') && (
            <button
              className="btn-icon-bare"
              title={t('common.pause')}
                aria-label={t('common.pause')}
              onClick={() => window.api.pauseDownload(item.id)}
            >
              <Pause size={15} />
            </button>
          )}
          {item.state === 'paused' && (
            <button
              className="btn-icon-bare"
              title={t('common.resume')}
                aria-label={t('common.resume')}
              onClick={() => window.api.resumeDownload(item.id)}
            >
              <Play size={15} />
            </button>
          )}
          {(item.state === 'error' || item.state === 'canceled') && (
            <button
              className="btn-icon-bare"
              title={t('common.retry')}
                aria-label={t('common.retry')}
              onClick={() => window.api.retryDownload(item.id)}
            >
              <RotateCw size={15} />
            </button>
          )}
          {item.state === 'error' && (
            <button className="btn-icon-bare" title={t('queue.copyError')} aria-label={t('queue.copyError')} onClick={copyError}>
              <Copy size={15} />
            </button>
          )}
          {/*
            `processing` belongs here too. It was the one running state with no
            way out: a merge or a trim on a long video takes minutes, and while
            it ran the row offered pause but not cancel — so the only way to
            abandon a job that had gone wrong was to pause it and then remove
            it, which is two steps to say one thing.
          */}
          {(item.state === 'downloading' ||
            item.state === 'processing' ||
            item.state === 'paused' ||
            item.state === 'queued' ||
            item.state === 'detecting') && (
            <button
              className="btn-icon-bare hover:text-bad"
              title={t('common.cancel')}
              aria-label={t('common.cancel')}
              onClick={() => window.api.cancelDownload(item.id)}
            >
              <X size={15} />
            </button>
          )}
          {/*
            Not on a row that is still working: beside Cancel, a bin that also
            stops the download read as a second way to do the same thing, and
            removed the row with it. Cancel first, then remove.
          */}
          {!['downloading', 'processing', 'detecting', 'queued', 'paused'].includes(item.state) && (
            <button
              className="btn-icon-bare hover:text-bad"
              title={t('common.remove')}
              aria-label={t('common.remove')}
              onClick={() => window.api.removeDownload(item.id)}
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>

      {/*
        Outcome: the path it landed at, or why it didn't. An automated episode
        whose local copy was deleted once it was on the share has only the
        share's path left; the buttons that need a local file are gone already.
      */}
      {(item.state === 'completed' || item.state === 'error') && (
        <div className="pb-3 pl-[124px] pr-1">
          {/*
            Each translated failure says what happened and then what to do,
            and one truncated line kept only the first half. A path gives up
            its folder before its file name, which is the part people look for.
          */}
          {item.state === 'error' ? (
            <p
              className="selectable line-clamp-3 break-words text-[12px] text-bad"
              title={errorText(t, item)}
            >
              {errorText(t, item)}
            </p>
          ) : (
            item.filepath ? (
              <p className="selectable mono flex min-w-0 text-[12px]" title={item.filepath}>
                <span className="min-w-0 shrink truncate text-ink-3">{savedAt.dir}</span>
                <span className="max-w-full shrink-0 truncate text-ink-2">{savedAt.base}</span>
              </p>
            ) : (
              <p className="selectable mono truncate text-[12px] text-ink-3" title={landed}>
                {landed}
              </p>
            )
          )}
          {item.log && (
            <>
              <button
                onClick={() => setLogOpen((v) => !v)}
                aria-expanded={logOpen}
                aria-controls={logOpen ? logId : undefined}
                className="mono mt-2 flex items-center gap-1 text-[11px] uppercase tracking-[0.08em] text-ink-2 transition-colors duration-fast ease-ease hover:text-ink"
              >
                {t('queue.log')}
                <motion.span animate={{ rotate: logOpen ? 180 : 0 }} transition={{ duration: 0.16 }}>
                  <ChevronDown size={12} />
                </motion.span>
              </button>
              <AnimatePresence initial={false}>
                {logOpen && (
                  <motion.pre
                    {...collapse}
                    id={logId}
                    className="selectable mono mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-1 bg-sink px-3 py-2.5 text-[11px] leading-relaxed text-ink-2"
                  >
                    {item.log}
                  </motion.pre>
                )}
              </AnimatePresence>
            </>
          )}
          {canReport && (
            <button
              onClick={() => setReportOpenFor(reportOpen ? null : (failure.reportId ?? null))}
              aria-expanded={reportOpen}
              className="mono mt-2 flex items-center gap-1 text-[11px] uppercase tracking-[0.08em] text-accent-ink transition-colors duration-fast ease-ease hover:text-ink"
            >
              {t('report.open')}
              <motion.span animate={{ rotate: reportOpen ? 180 : 0 }} transition={{ duration: 0.16 }}>
                <ChevronDown size={12} />
              </motion.span>
            </button>
          )}
          {/* Stays mounted once answered, so it can say how sending went. */}
          {reportOpen && <ReportPrompt key={failure.reportId} {...failure} />}
        </div>
      )}

      {jobModal && <MediaJobModal item={item} mode={jobModal} onClose={() => setJobModal(null)} />}
    </motion.li>
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
  (a, b) => a.item === b.item && a.index === b.index && a.animateIn === b.animateIn
)
