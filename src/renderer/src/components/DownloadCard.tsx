import { motion } from 'framer-motion'
import {
  CheckCircle2,
  FolderOpen,
  Music,
  Pause,
  Play,
  RotateCw,
  Trash2,
  Video,
  XCircle,
  X
} from 'lucide-react'
import type { DownloadItem } from '@shared/types'
import { formatBytes, formatEta, formatSpeed } from '../lib/format'

interface Props {
  item: DownloadItem
}

const STATE_LABEL: Record<DownloadItem['state'], { label: string; tone: string }> = {
  queued: { label: 'queued', tone: 'text-white/45' },
  detecting: { label: 'preparing', tone: 'text-amber-300/80' },
  downloading: { label: 'downloading', tone: 'text-cream' },
  processing: { label: 'processing', tone: 'text-cream' },
  completed: { label: 'completed', tone: 'text-emerald-300/80' },
  error: { label: 'failed', tone: 'text-red-300/80' },
  paused: { label: 'paused', tone: 'text-white/45' },
  canceled: { label: 'canceled', tone: 'text-white/35' }
}

export default function DownloadCard({ item }: Props): JSX.Element {
  const meta = STATE_LABEL[item.state]
  const active =
    item.state === 'downloading' || item.state === 'processing' || item.state === 'detecting'
  const percent = Math.round(item.percent || 0)
  const qualityLabel =
    item.mode === 'audio'
      ? null
      : item.formatId
        ? null
        : item.quality && item.quality !== 'best' && item.quality !== 'audio'
          ? `${item.quality}p`
          : null

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="card flex gap-4 p-3.5"
    >
      <div className="relative h-[68px] w-[120px] shrink-0 overflow-hidden rounded-2xl bg-ink-950">
        {item.thumbnail ? (
          <img
            src={item.thumbnail}
            alt=""
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-white/15">
            {item.mode === 'audio' ? <Music size={22} /> : <Video size={22} />}
          </div>
        )}
        <span className="absolute bottom-1 left-1 flex h-5 w-5 items-center justify-center rounded-md bg-black/70 text-white/80">
          {item.mode === 'audio' ? <Music size={11} /> : <Video size={11} />}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-cream" title={item.title}>
              {item.title}
            </p>
            <div className="mono mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <span className={`font-medium ${meta.tone}`}>{meta.label}</span>
              {qualityLabel && <span className="text-white/35">· {qualityLabel}</span>}
              {active && item.speed ? <span className="text-white/35">· {formatSpeed(item.speed)}</span> : null}
              {active && item.eta ? <span className="text-white/35">· {formatEta(item.eta)}</span> : null}
              {item.state === 'downloading' && item.downloadedBytes && item.totalBytes ? (
                <span className="text-white/35">
                  · {formatBytes(item.downloadedBytes)} / {formatBytes(item.totalBytes)}
                </span>
              ) : null}
              {item.state === 'completed' && item.totalBytes ? (
                <span className="text-white/35">· {formatBytes(item.totalBytes)}</span>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {item.state === 'completed' && item.filepath && (
              <>
                <button className="btn-icon" title="Play" onClick={() => window.api.openPath(item.filepath!)}>
                  <Play size={16} />
                </button>
                <button className="btn-icon" title="Show in folder" onClick={() => window.api.showInFolder(item.filepath!)}>
                  <FolderOpen size={16} />
                </button>
              </>
            )}
            {(item.state === 'downloading' ||
              item.state === 'queued' ||
              item.state === 'processing' ||
              item.state === 'detecting') && (
              <button className="btn-icon" title="Pause" onClick={() => window.api.pauseDownload(item.id)}>
                <Pause size={16} />
              </button>
            )}
            {item.state === 'paused' && (
              <button className="btn-icon" title="Resume" onClick={() => window.api.resumeDownload(item.id)}>
                <Play size={16} />
              </button>
            )}
            {(item.state === 'error' || item.state === 'canceled') && (
              <button className="btn-icon" title="Retry" onClick={() => window.api.retryDownload(item.id)}>
                <RotateCw size={16} />
              </button>
            )}
            {(item.state === 'downloading' ||
              item.state === 'paused' ||
              item.state === 'queued' ||
              item.state === 'detecting') && (
              <button
                className="btn-icon hover:bg-red-500/20 hover:text-red-300"
                title="Cancel"
                onClick={() => window.api.cancelDownload(item.id)}
              >
                <X size={16} />
              </button>
            )}
            <button
              className="btn-icon hover:bg-red-500/20 hover:text-red-300"
              title="Remove"
              onClick={() => window.api.removeDownload(item.id)}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        <div className="mt-2">
          {item.state === 'error' ? (
            <p className="flex items-center gap-1.5 truncate text-xs text-red-300/70" title={item.error}>
              <XCircle size={12} /> {item.error || 'Something went wrong'}
            </p>
          ) : item.state === 'completed' ? (
            <p className="mono flex items-center gap-1.5 truncate text-xs text-emerald-300/60" title={item.filepath}>
              <CheckCircle2 size={12} /> {item.filepath || 'Saved'}
            </p>
          ) : (
            <div className="flex items-center gap-3">
              <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-full bg-cream"
                  animate={{ width: `${percent}%` }}
                  transition={{ ease: 'easeOut', duration: 0.3 }}
                />
                {active && (
                  <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/25 to-transparent" />
                )}
              </div>
              <span className="mono w-9 text-right text-xs font-medium tabular-nums text-white/50">{percent}%</span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}
