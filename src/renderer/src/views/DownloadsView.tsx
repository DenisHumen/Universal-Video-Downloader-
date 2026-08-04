import { useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { FolderOpen, Pause, Play, RotateCw, Search, Trash2 } from 'lucide-react'
import type { DownloadItem } from '@shared/types'
import { useStore } from '../store'
import { formatBytes, formatSpeed } from '../lib/format'
import { useT, type TranslationKey } from '../i18n'
import QueueRow from '../components/QueueRow'
import Choice from '../components/Choice'

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

/**
 * The queue as a document: a header stating the totals, a control strip, then
 * one ruled list. Bulk actions live as icons in the header rather than inside
 * each row, so the per-row controls stay about that row.
 */
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

  const running = downloads.filter((d) => d.state === 'downloading')
  const totalSpeed = running.reduce((n, d) => n + (d.speed || 0), 0)
  const remainingBytes = running.reduce(
    (n, d) => n + Math.max(0, (d.totalBytes || 0) - (d.downloadedBytes || 0)),
    0
  )

  const summary = [
    downloads.length === 1
      ? t('queue.item', { count: 1 })
      : t('queue.items', { count: downloads.length }),
    totalSpeed > 0 ? formatSpeed(totalSpeed) : null,
    remainingBytes > 0 ? t('queue.remaining', { size: formatBytes(remainingBytes) }) : null
  ].filter(Boolean)

  return (
    <div className="mx-auto flex h-full w-full max-w-[860px] flex-col px-6 pb-8 pt-10">
      <header className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">{t('queue.title')}</h1>
          <p className="mono mt-1 truncate text-[11px] text-ink-3">{summary.join('  ·  ')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {settings?.downloadDir && (
            <button
              className="btn-icon"
              title={t('queue.openFolder')}
              onClick={() => window.api.openPath(settings.downloadDir)}
            >
              <FolderOpen size={16} />
            </button>
          )}
          {hasRunning && (
            <button className="btn-icon" title={t('queue.pauseAll')} onClick={() => window.api.pauseAll()}>
              <Pause size={16} />
            </button>
          )}
          {hasPaused && (
            <button className="btn-icon" title={t('queue.resumeAll')} onClick={() => window.api.resumeAll()}>
              <Play size={16} />
            </button>
          )}
          {hasFailed && (
            <button
              className="btn-icon"
              title={t('queue.retryFailed')}
              onClick={() => window.api.retryFailed()}
            >
              <RotateCw size={16} />
            </button>
          )}
          {hasFinished && (
            <button className="btn-icon" title={t('queue.clearFinished')} onClick={clearFinished}>
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </header>

      {downloads.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Choice
            label={t('queue.title')}
            value={filter}
            onChange={(v) => setFilter(v as Filter)}
            options={FILTERS.map((f) => ({ value: f.value, label: t(f.label) }))}
          />
          <div className="field ml-auto flex min-w-[200px] max-w-[280px] flex-1 items-center gap-2 rounded-full px-3 py-1.5">
            <Search size={13} className="shrink-0 text-ink-3" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('queue.searchPlaceholder')}
              className="no-drag min-w-0 flex-1 bg-transparent py-1 text-[12px] text-ink outline-none placeholder:text-ink-3"
              spellCheck={false}
            />
          </div>
        </div>
      )}

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
        {downloads.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-[14px] font-medium text-ink">{t('queue.empty')}</p>
            <p className="mono mt-1.5 text-[11px] text-ink-3">{t('queue.emptyHint')}</p>
            <button className="btn-solid mt-6" onClick={() => setView('home')}>
              {t('queue.add')}
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-[14px] font-medium text-ink">{t('queue.emptyFiltered')}</p>
          </div>
        ) : (
          <ul className="border-t border-edge">
            <AnimatePresence mode="popLayout">
              {visible.map((item, i) => (
                <QueueRow key={item.id} item={item} index={i} />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </div>
  )
}
