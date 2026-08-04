import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { FolderOpen, Inbox, Pause, Play, RotateCw, Search, Trash2 } from 'lucide-react'
import type { DownloadItem } from '@shared/types'
import { useStore } from '../store'
import { formatBytes, formatSpeed } from '../lib/format'
import { useT, type TranslationKey } from '../i18n'
import DownloadCard from '../components/DownloadCard'
import Segmented from '../components/Segmented'

type Filter = 'all' | 'active' | 'done' | 'failed'

const FILTERS: { value: Filter; label: TranslationKey }[] = [
  { value: 'all', label: 'queue.filterAll' },
  { value: 'active', label: 'queue.filterActive' },
  { value: 'done', label: 'queue.filterDone' },
  { value: 'failed', label: 'queue.filterFailed' }
]

const ACTIVE_STATES: DownloadItem['state'][] = [
  'queued',
  'detecting',
  'downloading',
  'processing',
  'paused'
]

function matches(item: DownloadItem, filter: Filter): boolean {
  if (filter === 'all') return true
  if (filter === 'active') return ACTIVE_STATES.includes(item.state)
  if (filter === 'done') return item.state === 'completed'
  return item.state === 'error' || item.state === 'canceled'
}

export default function DownloadsView(): JSX.Element {
  const t = useT()
  const downloads = useStore((s) => s.downloads)
  const settings = useStore((s) => s.settings)
  const setView = useStore((s) => s.setView)
  const refreshDownloads = useStore((s) => s.refreshDownloads)

  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const clearFinished = async (): Promise<void> => {
    await window.api.clearFinished()
    await refreshDownloads()
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return downloads.filter(
      (d) => matches(d, filter) && (!needle || d.title.toLowerCase().includes(needle))
    )
  }, [downloads, filter, query])

  const hasFinished = downloads.some((d) => ['completed', 'error', 'canceled'].includes(d.state))
  const hasRunning = downloads.some((d) =>
    ['downloading', 'processing', 'detecting', 'queued'].includes(d.state)
  )
  const hasPaused = downloads.some((d) => d.state === 'paused')
  const hasFailed = downloads.some((d) => d.state === 'error' || d.state === 'canceled')

  const totalSpeed = downloads
    .filter((d) => d.state === 'downloading')
    .reduce((n, d) => n + (d.speed || 0), 0)
  const remainingBytes = downloads
    .filter((d) => d.state === 'downloading')
    .reduce((n, d) => n + Math.max(0, (d.totalBytes || 0) - (d.downloadedBytes || 0)), 0)

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col px-8 py-9">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-cream">{t('queue.title')}</h1>
          <p className="mono text-sm text-fg/55">
            {downloads.length === 1
              ? t('queue.item', { count: 1 })
              : t('queue.items', { count: downloads.length })}
            {totalSpeed > 0 && <span className="text-fg/60"> · {formatSpeed(totalSpeed)}</span>}
            {remainingBytes > 0 && (
              <span className="text-fg/55"> · {formatBytes(remainingBytes)} left</span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {settings?.downloadDir && (
            <button
              className="btn-ghost px-3 py-2"
              title={t('queue.openFolder')}
              onClick={() => window.api.openPath(settings.downloadDir)}
            >
              <FolderOpen size={16} />
            </button>
          )}
          {hasRunning && (
            <button
              className="btn-ghost px-3 py-2"
              title={t('queue.pauseAll')}
              onClick={() => window.api.pauseAll()}
            >
              <Pause size={16} />
            </button>
          )}
          {hasPaused && (
            <button
              className="btn-ghost px-3 py-2"
              title={t('queue.resumeAll')}
              onClick={() => window.api.resumeAll()}
            >
              <Play size={16} />
            </button>
          )}
          {hasFailed && (
            <button
              className="btn-ghost px-3 py-2"
              title={t('queue.retryFailed')}
              onClick={() => window.api.retryFailed()}
            >
              <RotateCw size={16} />
            </button>
          )}
          {hasFinished && (
            <button className="btn-ghost px-3 py-2" title={t('queue.clearFinished')} onClick={clearFinished}>
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      {downloads.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Segmented
            layoutId="queue-filter"
            fill={false}
            value={filter}
            onChange={(v) => setFilter(v as Filter)}
            options={FILTERS.map((f) => ({ value: f.value, label: t(f.label) }))}
          />
          <div className="flex min-w-[160px] flex-1 items-center gap-2 rounded-2xl border border-fg/[0.08] bg-ink-900 px-3 py-1.5 transition-colors focus-within:border-accent/40">
            <Search size={14} className="shrink-0 text-fg/50" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('queue.searchPlaceholder')}
              className="no-drag min-w-0 flex-1 bg-transparent py-1 text-xs text-cream placeholder:text-fg/50 outline-none"
              spellCheck={false}
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto pr-1">
        {downloads.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex h-full flex-col items-center justify-center text-center"
          >
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-fg/[0.03] text-fg/35">
              <Inbox size={34} />
            </div>
            <p className="mt-4 text-sm font-medium text-fg/70">{t('queue.empty')}</p>
            <p className="mono mt-1 text-xs text-fg/50">{t('queue.emptyHint')}</p>
            <button className="btn-primary mt-5" onClick={() => setView('home')}>
              {t('queue.add')}
            </button>
          </motion.div>
        ) : visible.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-fg/[0.03] text-fg/35">
              <Search size={26} />
            </div>
            <p className="mt-4 text-sm font-medium text-fg/70">{t('queue.emptyFiltered')}</p>
          </div>
        ) : (
          <div className="space-y-3 pb-4">
            <AnimatePresence mode="popLayout">
              {visible.map((item) => (
                <DownloadCard key={item.id} item={item} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}
