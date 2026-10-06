import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CircleX,
  FolderOpen,
  Inbox,
  Pause,
  Play,
  Plus,
  RotateCw,
  Search,
  SearchX,
  Trash2
} from 'lucide-react'
import type { DownloadItem } from '@shared/types'
import { useStore } from '../store'
import { formatBytes, formatEta, formatSpeed } from '../lib/format'
import { useT, type TranslationKey } from '../i18n'
import QueueRow from '../components/QueueRow'
import Choice from '../components/Choice'
import EmptyState from '../components/EmptyState'
import ConfirmDialog from '../components/ConfirmDialog'

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
 * Rows drawn when the queue opens, and how many more join as the end nears.
 *
 * History is never pruned, and every row is a dozen elements and a handful of
 * icons: drawing all of them blocked each visit to this tab for 250-400 ms at
 * 500 entries and over half a second at 1000, before anything appeared. The
 * first page is what fits on any screen several times over; the rest is drawn
 * as the reader scrolls towards it. Windowing was the alternative, and the
 * wrong one here - rows differ in height and a log opens inside a row.
 */
const PAGE = 100

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

  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [confirmClearFailed, setConfirmClearFailed] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLLIElement>(null)
  /*
    Rows that were already in the queue when it opened appear in place; only
    entries that arrive while it is open fade in. Every row used to start its
    own opacity spring on every visit to the tab - hundreds of animations to
    say nothing more than "this screen is showing".
  */
  const [presentAtOpen] = useState(() => new Set(downloads.map((d) => d.id)))

  // A new filter or search starts again from the top, one page deep. Reset
  // alongside the change, not in an effect after it, so the list is never
  // drawn once at the old depth on the way.
  const changeFilter = (next: Filter): void => {
    setFilter(next)
    setLimit(PAGE)
  }
  const changeQuery = (next: string): void => {
    setQuery(next)
    setLimit(PAGE)
  }

  /*
    No refresh afterwards. Main sends the removals as one batch, and the
    full re-read that used to follow redrew the list a second time for
    nothing.
  */
  const clearFinished = (): Promise<void> => window.api.clearFinished()

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return downloads.filter(
      (d) => matches(d, filter) && (!needle || d.title.toLowerCase().includes(needle))
    )
  }, [downloads, filter, query])

  const hasMore = visible.length > limit
  useEffect(() => {
    const root = scrollRef.current
    const sentinel = sentinelRef.current
    if (!hasMore || !root || !sentinel) return
    /*
      The root is the list's own scroller - the page never scrolls, this div
      does, and an observer on the viewport would see the sentinel as hidden
      however far down the reader went. A fresh observer for every new depth
      reports where the sentinel is straight away, so a window tall enough to
      show the whole new page asks for the next one without waiting for a
      scroll.
    */
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit((l) => l + PAGE)
      },
      { root, rootMargin: '800px 0px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, limit])

  // Failures are not "finished": they keep their error and their retry until cleared on purpose.
  const hasFinished = downloads.some((d) => d.state === 'completed' || d.state === 'canceled')
  const hasRunning = downloads.some((d) =>
    ['downloading', 'processing', 'detecting', 'queued'].includes(d.state)
  )
  const hasPaused = downloads.some((d) => d.state === 'paused')
  const hasFailed = downloads.some((d) => d.state === 'error' || d.state === 'canceled')
  const hasErrors = downloads.some((d) => d.state === 'error')

  const running = downloads.filter((d) => d.state === 'downloading')
  const totalSpeed = running.reduce((n, d) => n + (d.speed || 0), 0)
  const remainingBytes = running.reduce(
    (n, d) => n + Math.max(0, (d.totalBytes || 0) - (d.downloadedBytes || 0)),
    0
  )
  /*
    How long the whole queue has left, not just each row.

    The header already knew the bytes still to come and the combined speed, and
    stopped one division short of the answer to the question people actually
    open this screen with. Bytes over bytes-per-second, and only while both are
    real — a figure derived from a stalled transfer is worse than no figure.
  */
  const totalEta = totalSpeed > 0 && remainingBytes > 0 ? remainingBytes / totalSpeed : 0

  const summary = [
    downloads.length === 1
      ? t('queue.item', { count: 1 })
      : t('queue.items', { count: downloads.length }),
    totalSpeed > 0 ? formatSpeed(totalSpeed) : null,
    remainingBytes > 0 ? t('queue.remaining', { size: formatBytes(remainingBytes) }) : null,
    totalEta > 0 ? t('queue.etaAll', { time: formatEta(totalEta) }) : null
  ].filter(Boolean)

  return (
    <div className="mx-auto flex h-full w-full max-w-[860px] flex-col px-6 pb-8 pt-10">
      <header className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="h1">{t('queue.title')}</h1>
          <p className="mono mt-1.5 truncate text-[12px] text-ink-2">{summary.join('  ·  ')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {settings?.downloadDir && (
            <button
              className="btn-icon"
              title={t('queue.openFolder')} aria-label={t('queue.openFolder')}
              onClick={() => window.api.openPath(settings.downloadDir)}
            >
              <FolderOpen size={16} />
            </button>
          )}
          {hasRunning && (
            <button className="btn-icon" title={t('queue.pauseAll')} aria-label={t('queue.pauseAll')} onClick={() => window.api.pauseAll()}>
              <Pause size={16} />
            </button>
          )}
          {hasPaused && (
            <button className="btn-icon" title={t('queue.resumeAll')} aria-label={t('queue.resumeAll')} onClick={() => window.api.resumeAll()}>
              <Play size={16} />
            </button>
          )}
          {hasFailed && (
            <button
              className="btn-icon"
              title={t('queue.retryFailed')} aria-label={t('queue.retryFailed')}
              onClick={() => window.api.retryFailed()}
            >
              <RotateCw size={16} />
            </button>
          )}
          {hasFinished && (
            <button className="btn-icon" title={t('queue.clearFinished')} aria-label={t('queue.clearFinished')} onClick={clearFinished}>
              <Trash2 size={16} />
            </button>
          )}
          {hasErrors && (
            <button
              className="btn-icon"
              title={t('queue.clearFailed')}
              aria-label={t('queue.clearFailed')}
              onClick={() => setConfirmClearFailed(true)}
            >
              <CircleX size={16} />
            </button>
          )}
        </div>
      </header>

      {downloads.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Choice
            label={t('queue.title')}
            value={filter}
            onChange={(v) => changeFilter(v as Filter)}
            options={FILTERS.map((f) => ({ value: f.value, label: t(f.label) }))}
          />
          {/* A label, so the whole pill is the target — the padding around a bare
              input is dead to the pointer. */}
          <label className="field ml-auto flex min-w-[220px] max-w-[300px] flex-1 cursor-text items-center gap-2 rounded-full px-4 py-1.5">
            <Search size={15} className="shrink-0 text-ink-3" />
            <input
              value={query}
              onChange={(e) => changeQuery(e.target.value)}
              placeholder={t('queue.searchPlaceholder')}
              className="no-drag min-w-0 flex-1 self-stretch bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
              spellCheck={false}
            />
          </label>
        </div>
      )}

      <div ref={scrollRef} className="mt-5 min-h-0 flex-1 overflow-y-auto">
        {downloads.length === 0 ? (
          <EmptyState
            icon={<Inbox size={24} />}
            title={t('queue.empty')}
            hint={t('queue.emptyHint')}
            action={
              <button className="btn-solid" onClick={() => setView('home')}>
                <Plus size={15} /> {t('queue.add')}
              </button>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<SearchX size={24} />}
            title={t('queue.emptyFiltered')}
            hint={t('queue.emptyFilteredHint')}
            action={
              <button
                className="btn-quiet"
                onClick={() => {
                  changeFilter('all')
                  changeQuery('')
                }}
              >
                {t('queue.clearFilters')}
              </button>
            }
          />
        ) : (
          <ul className="border-t border-edge">
            {/*
              No AnimatePresence around the rows.
              By default it hands every child a fresh context value on each of
              its own renders - a `Math.random()` in the dependencies, for
              presence-affects-layout - so every row redrew on every change to
              the queue, memo or not, and its key lookups are quadratic in the
              row count. With three downloads running that was 32 ms per
              progress tick at 500 rows and 94 ms at 1000. All it bought was a
              120 ms fade on the row being removed; a removed row now simply
              goes, and the rows below still slide up into its place.
            */}
            {visible.slice(0, limit).map((item, i) => (
              <QueueRow
                key={item.id}
                item={item}
                index={i}
                animateIn={!presentAtOpen.has(item.id)}
              />
            ))}
            {hasMore && <li ref={sentinelRef} aria-hidden className="h-px" />}
          </ul>
        )}
      </div>
      {confirmClearFailed && (
        <ConfirmDialog
          title={t('queue.clearFailedConfirm')}
          body={t('queue.clearFailedBody')}
          confirmLabel={t('queue.clearFailed')}
          onConfirm={() => {
            setConfirmClearFailed(false)
            void window.api.clearFailed()
          }}
          onCancel={() => setConfirmClearFailed(false)}
        />
      )}
    </div>
  )
}
