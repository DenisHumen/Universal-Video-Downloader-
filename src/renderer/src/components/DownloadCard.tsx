import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  CheckCircle2,
  ChevronDown,
  Copy,
  FolderOpen,
  Music,
  Pause,
  Play,
  RotateCw,
  Sparkles,
  Trash2,
  Video,
  X,
  XCircle
} from 'lucide-react'
import type { DownloadItem } from '@shared/types'
import { formatBytes, formatEta, formatSpeed } from '../lib/format'
import { useT, type TranslationKey } from '../i18n'
import { toast } from '../lib/toast'

interface Props {
  item: DownloadItem
}

const STATE_META: Record<DownloadItem['state'], { label: TranslationKey; tone: string }> = {
  queued: { label: 'state.queued', tone: 'text-fg/45' },
  detecting: { label: 'state.detecting', tone: 'text-warn' },
  downloading: { label: 'state.downloading', tone: 'text-cream' },
  processing: { label: 'state.processing', tone: 'text-cream' },
  completed: { label: 'state.completed', tone: 'text-good' },
  error: { label: 'state.error', tone: 'text-bad' },
  paused: { label: 'state.paused', tone: 'text-fg/45' },
  canceled: { label: 'state.canceled', tone: 'text-fg/35' }
}

export default function DownloadCard({ item }: Props): JSX.Element {
  const t = useT()
  const [logOpen, setLogOpen] = useState(false)
  const meta = STATE_META[item.state]
  const active =
    item.state === 'downloading' || item.state === 'processing' || item.state === 'detecting'
  const percent = Math.round(item.percent || 0)
  const qualityLabel =
    item.mode === 'audio' || item.formatId
      ? null
      : item.quality && item.quality !== 'best' && item.quality !== 'audio'
        ? `${item.quality}p`
        : null

  const copyError = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(item.error || item.log || '')
      toast(t('common.copied'), 'success')
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="card overflow-hidden"
    >
      <div className="flex gap-4 p-3.5">
        <div className="relative h-[68px] w-[120px] shrink-0 overflow-hidden rounded-2xl bg-ink-950">
          {item.thumbnail ? (
            <img
              src={item.thumbnail}
              alt=""
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-fg/15">
              {item.mode === 'audio' ? <Music size={22} /> : <Video size={22} />}
            </div>
          )}
          <span className="absolute bottom-1 left-1 flex h-5 w-5 items-center justify-center rounded-md bg-black/70 text-white/80">
            {item.mode === 'audio' ? <Music size={11} /> : <Video size={11} />}
          </span>
          {item.extractor === 'Universal' && (
            <span
              className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-md bg-black/70 text-white/80"
              title={t('home.universal')}
            >
              <Sparkles size={11} />
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-between">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-cream" title={item.title}>
                {item.title}
              </p>
              <div className="mono mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                <span className={`font-medium ${meta.tone}`}>{t(meta.label)}</span>
                {qualityLabel && <span className="text-fg/35">· {qualityLabel}</span>}
                {active && item.speed ? (
                  <span className="text-fg/35">· {formatSpeed(item.speed)}</span>
                ) : null}
                {active && item.eta ? <span className="text-fg/35">· {formatEta(item.eta)}</span> : null}
                {item.state === 'downloading' && item.downloadedBytes && item.totalBytes ? (
                  <span className="text-fg/35">
                    · {formatBytes(item.downloadedBytes)} / {formatBytes(item.totalBytes)}
                  </span>
                ) : null}
                {item.state === 'completed' && item.totalBytes ? (
                  <span className="text-fg/35">· {formatBytes(item.totalBytes)}</span>
                ) : null}
                {item.state === 'queued' && (item.attempts || 0) > 0 ? (
                  <span className="text-warn">· {t('queue.retryingIn')}</span>
                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {item.state === 'completed' && item.filepath && (
                <>
                  <button
                    className="btn-icon"
                    title={t('common.play')}
                    onClick={() => window.api.openPath(item.filepath!)}
                  >
                    <Play size={16} />
                  </button>
                  <button
                    className="btn-icon"
                    title={t('common.showInFolder')}
                    onClick={() => window.api.showInFolder(item.filepath!)}
                  >
                    <FolderOpen size={16} />
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
                  <Pause size={16} />
                </button>
              )}
              {item.state === 'paused' && (
                <button
                  className="btn-icon"
                  title={t('common.resume')}
                  onClick={() => window.api.resumeDownload(item.id)}
                >
                  <Play size={16} />
                </button>
              )}
              {(item.state === 'error' || item.state === 'canceled') && (
                <button
                  className="btn-icon"
                  title={t('common.retry')}
                  onClick={() => window.api.retryDownload(item.id)}
                >
                  <RotateCw size={16} />
                </button>
              )}
              {(item.state === 'downloading' ||
                item.state === 'paused' ||
                item.state === 'queued' ||
                item.state === 'detecting') && (
                <button
                  className="btn-icon hover:bg-bad/20 hover:text-bad"
                  title={t('common.cancel')}
                  onClick={() => window.api.cancelDownload(item.id)}
                >
                  <X size={16} />
                </button>
              )}
              <button
                className="btn-icon hover:bg-bad/20 hover:text-bad"
                title={t('common.remove')}
                onClick={() => window.api.removeDownload(item.id)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>

          <div className="mt-2">
            {item.state === 'error' ? (
              <div className="flex items-center gap-2">
                <p className="flex min-w-0 items-center gap-1.5 truncate text-xs text-bad" title={item.error}>
                  <XCircle size={12} className="shrink-0" /> {item.error || t('error.title')}
                </p>
                <button
                  className="btn-icon h-6 w-6 shrink-0"
                  title={t('queue.copyError')}
                  onClick={copyError}
                >
                  <Copy size={12} />
                </button>
              </div>
            ) : item.state === 'completed' ? (
              <p
                className="mono flex items-center gap-1.5 truncate text-xs text-good"
                title={item.filepath}
              >
                <CheckCircle2 size={12} className="shrink-0" /> {item.filepath || 'Saved'}
              </p>
            ) : (
              <div className="flex items-center gap-3">
                <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-fg/[0.08]">
                  <motion.div
                    className="absolute inset-y-0 left-0 rounded-full bg-accent"
                    animate={{ width: `${percent}%` }}
                    transition={{ ease: 'easeOut', duration: 0.3 }}
                  />
                  {active && (
                    <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-fg/25 to-transparent" />
                  )}
                </div>
                <span className="mono w-9 text-right text-xs font-medium tabular-nums text-fg/50">
                  {percent}%
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {item.log && (item.state === 'error' || item.state === 'completed') && (
        <>
          <button
            onClick={() => setLogOpen((v) => !v)}
            className="flex w-full items-center justify-between border-t border-fg/[0.06] px-4 py-2 text-[11px] font-medium text-fg/35 transition-colors hover:text-fg/70"
          >
            <span>{t('queue.log')}</span>
            <motion.span animate={{ rotate: logOpen ? 180 : 0 }}>
              <ChevronDown size={14} />
            </motion.span>
          </button>
          <AnimatePresence initial={false}>
            {logOpen && (
              <motion.pre
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="selectable mono max-h-48 overflow-auto whitespace-pre-wrap break-all bg-ink-950/60 px-4 py-3 text-[10px] leading-relaxed text-fg/45"
              >
                {item.log}
              </motion.pre>
            )}
          </AnimatePresence>
        </>
      )}
    </motion.div>
  )
}
