import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { collapse, listItem } from '../lib/motion'
import {
  ChevronDown,
  Copy,
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
import { formatBytes, formatEta, formatSpeed } from '../lib/format'
import { useT, type TranslationKey } from '../i18n'
import { toast } from '../lib/toast'
import MediaJobModal, { type JobMode } from './MediaJobModal'
import Thumbnail from './Thumbnail'

interface Props {
  item: DownloadItem
  /** Position in the visible list — the row's mono index. */
  index: number
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
 * cost, and let the progress rail sit flush at the row's bottom edge where it
 * doubles as the divider while an item is running.
 */
export default function QueueRow({ item, index }: Props): JSX.Element {
  const t = useT()
  const [logOpen, setLogOpen] = useState(false)
  const [jobModal, setJobModal] = useState<JobMode | null>(null)
  const meta = STATE_META[item.state]
  const jobKindLabel =
    item.kind === 'trim' ? t('job.trim') : item.kind === 'convert' ? t('job.convert') : null
  const active =
    item.state === 'downloading' || item.state === 'processing' || item.state === 'detecting'
  const percent = Math.round(item.percent || 0)
  const qualityLabel =
    item.mode === 'audio' || item.formatId
      ? null
      : item.quality && item.quality !== 'best' && item.quality !== 'audio'
        ? `${item.quality}p`
        : null

  const facts = [
    jobKindLabel,
    item.jobLabel,
    qualityLabel,
    active && item.speed ? formatSpeed(item.speed) : null,
    active && item.eta ? formatEta(item.eta) : null,
    item.state === 'downloading' && item.downloadedBytes && item.totalBytes
      ? `${formatBytes(item.downloadedBytes)} / ${formatBytes(item.totalBytes)}`
      : null,
    item.state === 'completed' && item.totalBytes ? formatBytes(item.totalBytes) : null,
    item.state === 'queued' && (item.attempts || 0) > 0 ? t('queue.retryingIn') : null
  ].filter(Boolean)

  const copyError = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(item.error || item.log || '')
      toast(t('common.copied'), 'success')
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <motion.li
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={listItem}
      className="group relative border-b border-edge"
    >
      <div className="flex items-center gap-3.5 py-3 pl-1 pr-1 transition-colors duration-fast ease-ease group-hover:bg-raise">
        <span className="mono w-6 shrink-0 text-center text-[11px] tabular-nums text-ink-3">
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
          <p className="truncate text-[13px] text-ink" title={item.title}>
            {item.title}
          </p>
          <p className="mono mt-1 flex items-center gap-2 truncate text-[11px] text-ink-3">
            <span className={`inline-flex items-center gap-1.5 ${meta.text}`}>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
              {t(meta.label)}
            </span>
            {facts.length > 0 && <span className="truncate">{facts.join('  ·  ')}</span>}
          </p>
        </div>

        {/* Percent is the only number that earns a fixed column: it's what the
            eye scans down the list while things are running. */}
        {!['completed', 'error', 'canceled'].includes(item.state) && (
          <span className="mono w-10 shrink-0 text-right text-[12px] tabular-nums text-ink-2">
            {percent}%
          </span>
        )}

        {/* Actions stay dim until the row is hovered or focused, so a long queue
            isn't a wall of icons — but they remain in the tab order. */}
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-fast ease-ease focus-within:opacity-100 group-hover:opacity-100">
          {item.state === 'completed' && item.filepath && (
            <>
              <button
                className="btn-icon"
                title={t('common.play')}
                onClick={() => window.api.openPath(item.filepath!)}
              >
                <Play size={15} />
              </button>
              <button className="btn-icon" title={t('trim.openEditor')} onClick={() => setJobModal('trim')}>
                <Scissors size={15} />
              </button>
              <button className="btn-icon" title={t('convert.open')} onClick={() => setJobModal('convert')}>
                <FileVideo size={15} />
              </button>
              <button
                className="btn-icon"
                title={t('common.showInFolder')}
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
              className="btn-icon"
              title={t('common.pause')}
              onClick={() => window.api.pauseDownload(item.id)}
            >
              <Pause size={15} />
            </button>
          )}
          {item.state === 'paused' && (
            <button
              className="btn-icon"
              title={t('common.resume')}
              onClick={() => window.api.resumeDownload(item.id)}
            >
              <Play size={15} />
            </button>
          )}
          {(item.state === 'error' || item.state === 'canceled') && (
            <button
              className="btn-icon"
              title={t('common.retry')}
              onClick={() => window.api.retryDownload(item.id)}
            >
              <RotateCw size={15} />
            </button>
          )}
          {item.state === 'error' && (
            <button className="btn-icon" title={t('queue.copyError')} onClick={copyError}>
              <Copy size={15} />
            </button>
          )}
          {(item.state === 'downloading' ||
            item.state === 'paused' ||
            item.state === 'queued' ||
            item.state === 'detecting') && (
            <button
              className="btn-icon hover:text-bad"
              title={t('common.cancel')}
              onClick={() => window.api.cancelDownload(item.id)}
            >
              <X size={15} />
            </button>
          )}
          <button
            className="btn-icon hover:text-bad"
            title={t('common.remove')}
            onClick={() => window.api.removeDownload(item.id)}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* The row's own bottom edge, painted over by progress while it runs. */}
      {!['completed', 'error', 'canceled'].includes(item.state) && (
        <motion.div
          className="absolute bottom-0 left-0 h-0.5 bg-accent"
          animate={{ width: `${percent}%` }}
          transition={{ ease: 'easeOut', duration: 0.3 }}
        />
      )}

      {/* Outcome: the path it landed at, or why it didn't. */}
      {(item.state === 'completed' || item.state === 'error') && (
        <div className="pb-3 pl-[124px] pr-1">
          <p
            className={`mono selectable truncate text-[11px] ${
              item.state === 'error' ? 'text-bad' : 'text-ink-3'
            }`}
            title={item.state === 'error' ? item.error : item.filepath}
          >
            {item.state === 'error' ? item.error || t('error.title') : item.filepath}
          </p>
          {item.log && (
            <>
              <button
                onClick={() => setLogOpen((v) => !v)}
                className="mono mt-1.5 flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-ink-3 transition-colors duration-fast ease-ease hover:text-ink"
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
                    className="selectable mono mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-1 bg-sink px-3 py-2.5 text-[10px] leading-relaxed text-ink-2"
                  >
                    {item.log}
                  </motion.pre>
                )}
              </AnimatePresence>
            </>
          )}
        </div>
      )}

      {jobModal && <MediaJobModal item={item} mode={jobModal} onClose={() => setJobModal(null)} />}
    </motion.li>
  )
}
