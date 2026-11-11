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
} from '../ui/icons'
import type { DownloadItem } from '@shared/types'
import { useStore } from '../store'
import { useKept } from '../hooks/useKept'
import { formatBytes, formatEta, formatSpeed } from '../lib/format'
import { useT, useTp, type TranslationKey } from '../i18n'
import QueueRow from '../components/QueueRow'
import { failedRecordingCanBeSaved, groupQueue, queueGroupOf, type QueueGroup } from '../lib/downloads'
import ConfirmDialog from '../components/ConfirmDialog'
import { EmptyState, Icon, IconButton } from '../ui'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { toast } from '../lib/toast'
import HeaderSlot from '../shell/HeaderSlot'
import { SegmentedControl } from '../ui'

type Filter = 'all' | 'active' | 'done' | 'failed'

const FILTERS: { value: Filter; label: TranslationKey }[] = [
  { value: 'all', label: 'queue.filterAll' },
  { value: 'active', label: 'queue.filterActive' },
  { value: 'done', label: 'queue.finishedToday' },
  { value: 'failed', label: 'queue.filterFailed' }
]

const GROUP_LABEL: Record<QueueGroup, TranslationKey> = {
  active: 'queue.filterActive',
  failed: 'queue.filterFailed',
  done: 'queue.finishedToday'
}

const ACTIVE_STATES: DownloadItem['state'][] = [
  'queued',
  'detecting',
  'waiting',
  'downloading',
  'processing',
  'paused'
]

/** Finished since midnight. Older finished rows live in the Library (5.2 + 5.3). */
function finishedToday(item: DownloadItem): boolean {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return (item.finishedAt ?? item.createdAt) >= start.getTime()
}

function matches(item: DownloadItem, filter: Filter): boolean {
  if (item.state === 'completed' && !finishedToday(item)) return false
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

/*
  From here "Pause All" has room in the header bar and "Clear Finished" on the
  toolbar. Below it the sidebar and the Windows caption overlay leave a few
  pixels between the label and the centred title, in Russian, so these are
  icons with a tooltip.
*/
const LABELS_FROM = '(min-width: 1000px)'

/**
 * The queue as a document: a header stating the totals, a control strip, then
 * one ruled list. Bulk actions live as icons in the header rather than inside
 * each row, so the per-row controls stay about that row.
 */
export default function DownloadsView(): JSX.Element {
  const t = useT()
  const tp = useTp()
  const downloads = useStore((s) => s.downloads)
  const settings = useStore((s) => s.settings)
  const setView = useStore((s) => s.setView)
  const headerHasRoom = useMediaQuery(LABELS_FROM)

  const [filter, setFilter] = useKept<Filter>('kept:downloads.filter', 'all')
  const [query, setQuery] = useKept('kept:downloads.query', '')
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
    const found = downloads.filter(
      (d) => matches(d, filter) && (!needle || d.title.toLowerCase().includes(needle))
    )
    // Sections only for the unfiltered list; a filter is a section already.
    return filter === 'all' ? groupQueue(found) : found
  }, [downloads, filter, query])

  /*
    6.4: a notification was clicked. Show everything, bring its row into view
    (instantly: smooth scrolling rides the frame clock) and pulse it once.
  */
  const focusedRow = useStore((s) => s.focusedRow)
  const focusRow = useStore((s) => s.focusRow)
  useEffect(() => {
    if (!focusedRow) return
    changeFilter('all')
    changeQuery('')
    const id = focusedRow
    const timer = window.setTimeout(() => {
      const row = scrollRef.current?.querySelector<HTMLElement>(`[data-row="${id.replace(/["\\]/g, '\\$&')}"]`)
      if (row) {
        row.scrollIntoView?.({ block: 'center' })
        row.classList.add('ui-row-pulse')
        window.setTimeout(() => row.classList.remove('ui-row-pulse'), 1300)
      }
      focusRow(null)
    }, 60)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedRow])

  /*
    A row changes section or leaves when it is cancelled, retried or removed, and
    the focused button goes with it. The keyboard then started again from the top
    of the window, past the sidebar, every time. Only for a button that is really
    gone: a click on empty space must not be taken back by the next progress line.

    The row, and not a button in it. The first button of a cancelled row is Retry,
    so an Enter held or pressed once too often restarted what had just been
    cancelled. From the row, Tab goes on to its buttons and Enter does nothing.
  */
  const lastFocused = useRef<HTMLElement | null>(null)
  const lastRow = useRef<string | null>(null)
  useEffect(() => {
    const gone = lastFocused.current
    if (!gone || gone.isConnected || document.activeElement !== document.body) return
    lastFocused.current = null
    const id = lastRow.current
    const row = id ? scrollRef.current?.querySelector<HTMLElement>(`[data-row="${id.replace(/["\\]/g, '\\$&')}"]`) : null
    const target = row ?? scrollRef.current
    target?.focus({ preventScroll: true })
  }, [downloads])

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
  const hasFinished = downloads.some((d) => d.state === 'completed')
  const hasRunning = downloads.some((d) =>
    ['downloading', 'processing', 'detecting', 'queued', 'waiting'].includes(d.state)
  )
  const hasPaused = downloads.some((d) => d.state === 'paused')
  const hasErrors = downloads.some((d) => d.state === 'error')
  // A cancelled row is drawn under Failed, so it is cleared from there; it is not retried with them.
  const hasFailedRows = hasErrors || downloads.some((d) => d.state === 'canceled')

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

  // Finished rows from before today stay in the queue's history but are not drawn: they are the Library's now.
  const drawable = downloads.filter((d) => matches(d, 'all')).length

  const summary = [
    tp('queue.items', drawable),
    totalSpeed > 0 ? formatSpeed(totalSpeed) : null,
    remainingBytes > 0 ? t('queue.remaining', { size: formatBytes(remainingBytes) }) : null,
    totalEta > 0 ? t('queue.etaAll', { time: formatEta(totalEta) }) : null
  ].filter(Boolean)

  return (
    /*
      The scroller is the whole pane and the column sits inside it. The other way
      round, the scrollbar floated in the middle of a wide window, the wheel did
      nothing beside the column, and the rows were a scrollbar narrower than the
      toolbar above them.
    */
    <div
      ref={scrollRef}
      tabIndex={-1}
      className="h-full overflow-y-auto outline-none"
      onFocusCapture={(e) => {
        const target = e.target as HTMLElement
        if (target === scrollRef.current) return
        lastFocused.current = target
        lastRow.current = target.closest<HTMLElement>('[data-row]')?.dataset.row ?? null
      }}
    >
      {/* GNOME keeps the view's main bulk action in its header bar (A1.1 §3). */}
      <HeaderSlot>
        {hasRunning &&
          (headerHasRoom ? (
            <button className="btn-quiet" onClick={() => window.api.pauseAll()}>
              {t('queue.pauseAll')}
            </button>
          ) : (
            <IconButton label={t('queue.pauseAll')} icon={<Pause size={16} />} onClick={() => window.api.pauseAll()} />
          ))}
        {!hasRunning &&
          hasPaused &&
          (headerHasRoom ? (
            <button className="btn-quiet" onClick={() => window.api.resumeAll()}>
              {t('queue.resumeAll')}
            </button>
          ) : (
            <IconButton label={t('queue.resumeAll')} icon={<Play size={16} />} onClick={() => window.api.resumeAll()} />
          ))}
      </HeaderSlot>
      <div className="mx-auto flex min-h-full w-full max-w-[800px] flex-col px-6 pb-8">
      {/* Stays in reach however far down the list has been read; rows pass under it, so it has the sheet's own colour. */}
      <div
        className={`sticky top-0 z-10 bg-raise pb-3 pt-4 ${visible.length > 0 ? 'border-b border-edge' : ''}`}
        data-uvd="queue-toolbar"
      >
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          {/* The title is the header bar's now; this says how the queue stands. */}
          <h2 className="sr-only">{t('queue.title')}</h2>
          <p className="numeric truncate text-meta text-ink-2">{summary.join('  ·  ')}</p>
        </div>
        {/*
          What these do to many rows at once has to be read, not guessed from an
          arrow and an octagon, so they keep their words; when words and the
          summary do not fit on one line, the buttons take a line of their own.
          A bin says "clear" by itself, so that one gives up its words first.
        */}
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
          {settings?.downloadDir && (
            <IconButton
              label={t('queue.openFolder')}
              icon={<FolderOpen size={16} />}
              onClick={() =>
                void window.api.openPath(settings.downloadDir).then((why) => {
                  if (why) toast(t('queue.folderFailed'), 'error')
                })
              }
            />
          )}
          {hasRunning && hasPaused && (
            <IconButton label={t('queue.resumeAll')} icon={<Play size={16} />} onClick={() => window.api.resumeAll()} />
          )}
          {hasErrors && (
            <button className="btn-quiet" onClick={() => window.api.retryFailed()}>
              <RotateCw size={14} /> {t('queue.retryFailed')}
            </button>
          )}
          {hasFinished &&
            (headerHasRoom ? (
              <button className="btn-quiet" onClick={clearFinished}>
                <Trash2 size={14} /> {t('queue.clearFinished')}
              </button>
            ) : (
              <IconButton label={t('queue.clearFinished')} icon={<Trash2 size={16} />} onClick={clearFinished} />
            ))}
          {/*
            It takes the rows' errors and nothing on disk, so no question first,
            unless a row is the only way left to save what a recording got.
          */}
          {hasFailedRows && (
            <button
              className="btn-quiet"
              data-uvd="clear-failed"
              onClick={() =>
                downloads.some(failedRecordingCanBeSaved) ? setConfirmClearFailed(true) : void window.api.clearFailed()
              }
            >
              <CircleX size={14} /> {t('queue.clearFailed')}
            </button>
          )}
        </div>
      </header>

      {drawable > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <SegmentedControl
            label={t('queue.title')}
            value={filter}
            onChange={(v) => changeFilter(v as Filter)}
            options={FILTERS.map((f) => ({ value: f.value, label: t(f.label) }))}
          />
          {/* A label, so the whole pill is the target — the padding around a bare
              input is dead to the pointer. */}
          <label className="field ml-auto flex min-w-[176px] max-w-[300px] flex-1 cursor-text items-center gap-2 px-3 py-1.5">
            <Search size={15} className="shrink-0 text-ink-3" />
            <input
              value={query}
              onChange={(e) => changeQuery(e.target.value)}
              placeholder={t('queue.searchPlaceholder')}
              className="no-drag min-w-0 flex-1 self-stretch bg-transparent text-control text-ink outline-none placeholder:text-ink/80"
              spellCheck={false}
            />
          </label>
        </div>
      )}
      </div>

      <div className="min-h-0 flex-1">
        {downloads.length === 0 ? (
          <EmptyState
            icon={<Icon icon={Inbox} size="xl" />}
            title={t('queue.empty')}
            hint={t('queue.emptyHint')}
            action={
              <button className="btn-solid rounded-pill px-6" onClick={() => setView('home')}>
                <Plus size={15} /> {t('queue.add')}
              </button>
            }
          />
        ) : drawable === 0 ? (
          /* Only yesterday's rows: not a filter's doing, and there was nothing for "Show Everything" to show. */
          <EmptyState
            icon={<Icon icon={Inbox} size="xl" />}
            title={t('queue.nothingToday')}
            hint={t('queue.nothingTodayHint')}
            action={
              <button className="btn-solid rounded-pill px-6" onClick={() => setView('library')}>
                {t('queue.openLibrary')}
              </button>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Icon icon={SearchX} size="xl" />}
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
          <ul>
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
            {visible.slice(0, limit).map((item, i, shown) => {
              const group = queueGroupOf(item.state)
              const heads = filter === 'all' && (i === 0 || queueGroupOf(shown[i - 1].state) !== group)
              return (
                <QueueRow
                  key={item.id}
                  item={item}
                  index={i}
                  animateIn={!presentAtOpen.has(item.id)}
                  heading={heads ? t(GROUP_LABEL[group]) : undefined}
                />
              )
            })}
            {hasMore && <li ref={sentinelRef} aria-hidden className="h-px" />}
          </ul>
        )}
      </div>
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
