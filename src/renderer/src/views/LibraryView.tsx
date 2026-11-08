import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { showFile } from '../lib/showFile'
import { librarySite, pageLinkOf, type LibraryEntry, type LibraryGroup } from '@shared/library'
import type { DownloadItem } from '@shared/types'
import { useStore } from '../store'
import { useI18n, useT } from '../i18n'
import { formatBytes, formatDuration } from '../lib/format'
import { toast } from '../lib/toast'
import ConfirmDialog from '../components/ConfirmDialog'
import MediaJobModal, { type JobMode } from '../components/MediaJobModal'
import Thumbnail from '../components/Thumbnail'
import HeaderSlot from '../shell/HeaderSlot'
import { Dialog, EmptyState, Icon, IconButton, Menu, PreferencesGroup, SegmentedControl } from '../ui'
import { FileVideo, FolderOpen, MoreHorizontal, Play, Search } from '../ui/icons'

/*
  The Library (plan 5.3): every file the app has finished, from main's
  library.json (services/library.ts), which "clear finished" in Activity
  never touches. Grouped by date or site, searchable by title. Whether a
  file is still on disk is asked in a batch when the view opens, never
  stored. "Delete file" asks first, then moves it to the system trash.
*/

const DAY = 86_400_000

/**
 * Rows fetched when the view opens, and how many more as the end nears: the
 * pattern and the reasoning are DownloadsView's, and a library only grows.
 * Each page asks about its own files on disk, so a big library costs what the
 * reader actually scrolled past.
 */
const PAGE = 100
/** The most main hands back for one request. */
const MOST_PER_REQUEST = 500

function dayLabel(at: number, language: string, today: string, yesterday: string): string {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  if (at >= start.getTime()) return today
  if (at >= start.getTime() - DAY) return yesterday
  return new Date(at).toLocaleDateString(language, { day: 'numeric', month: 'long', year: 'numeric' })
}

/** An entry as the trim/convert dialog wants it: a finished queue row for that file. */
function asItem(e: LibraryEntry): DownloadItem {
  return {
    id: e.id,
    url: e.url,
    sourceUrl: e.sourceUrl,
    originUrl: e.originUrl,
    title: e.title,
    thumbnail: e.thumb,
    state: 'completed',
    percent: 100,
    outputDir: e.filepath.replace(/[\\/][^\\/]*$/, ''),
    mode: 'video',
    createdAt: e.finishedAt,
    finishedAt: e.finishedAt,
    filepath: e.filepath,
    duration: e.duration,
    totalBytes: e.sizeBytes,
    extractor: e.extractor,
    uploader: e.uploader,
    series: e.seriesId
  }
}

export default function LibraryView(): JSX.Element {
  const t = useT()
  const language = useI18n((s) => s.language)
  const requestDetect = useStore((s) => s.requestDetect)
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<LibraryGroup>('date')
  const [missing, setMissing] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<LibraryEntry | null>(null)
  const [job, setJob] = useState<{ entry: LibraryEntry; mode: JobMode } | null>(null)
  const [lost, setLost] = useState(0)
  const [confirmForget, setConfirmForget] = useState(false)
  const [noMatch, setNoMatch] = useState<{ entry: LibraryEntry; name: string } | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  /** Bumped by every full read, so the answer to an older one is dropped when it lands. */
  const generation = useRef(0)
  /** How far the reader has got: a change to the library re-reads this deep rather than throwing them back to the top. */
  const depth = useRef(PAGE)
  const fetchingMore = useRef(false)

  const checkMissing = useCallback((rows: LibraryEntry[], gen: number) => {
    const paths = rows.map((e) => e.filepath)
    void window.api.libraryMissing(paths).then((gone) => {
      if (gen !== generation.current) return
      setMissing((prev) => {
        const next = new Set(prev)
        for (const p of paths) next.delete(p)
        for (const p of gone) next.add(p)
        return next
      })
    })
  }, [])

  const load = useCallback(
    async (want: number) => {
      const gen = ++generation.current
      const fresh: LibraryEntry[] = []
      let known = 0
      do {
        const page = await window.api.listLibrary({
          query,
          group,
          offset: fresh.length,
          limit: Math.min(MOST_PER_REQUEST, want - fresh.length)
        })
        if (gen !== generation.current) return
        fresh.push(...page.entries)
        known = page.total
        checkMissing(page.entries, gen)
        if (!page.entries.length) break
      } while (fresh.length < want && fresh.length < known)
      setEntries(fresh)
      setTotal(known)
      setLoaded(true)
    },
    [query, group, checkMissing]
  )

  // A new search or grouping starts again from the top, one page deep.
  useEffect(() => {
    depth.current = PAGE
    scrollRef.current?.scrollTo?.({ top: 0 })
    void load(PAGE)
    return window.api.onLibraryChanged(() => void load(depth.current))
  }, [load])

  const count = entries.length
  const hasMore = count < total
  const loadMore = useCallback(async () => {
    if (fetchingMore.current) return
    fetchingMore.current = true
    const gen = generation.current
    try {
      const page = await window.api.listLibrary({ query, group, offset: count, limit: PAGE })
      if (gen !== generation.current) return
      depth.current = count + page.entries.length
      setEntries((prev) => [...prev, ...page.entries])
      setTotal(page.total)
      checkMissing(page.entries, gen)
    } finally {
      fetchingMore.current = false
    }
  }, [query, group, count, checkMissing])

  useEffect(() => {
    const root = scrollRef.current
    const sentinel = sentinelRef.current
    if (!hasMore || !root || !sentinel) return
    // The view's own scroller is the root, and a fresh observer per depth reports at once: see DownloadsView.
    const observer = new IntersectionObserver(
      (seen) => {
        if (seen.some((e) => e.isIntersecting)) void loadMore()
      },
      { root, rootMargin: '800px 0px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loadMore])

  // Of the whole library, not the rows loaded so far: the header action is about all of it.
  useEffect(() => {
    let live = true
    const ask = (): void => {
      void window.api.libraryCountMissing().then((n) => {
        if (live) setLost(n)
      })
    }
    ask()
    const off = window.api.onLibraryChanged(ask)
    return () => {
      live = false
      off()
    }
  }, [])

  const copyLink = async (link: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(link)
      toast(t('common.copied'), 'success')
    } catch {
      /* clipboard unavailable */
    }
  }

  const forgetAllMissing = async (): Promise<void> => {
    setConfirmForget(false)
    const n = await window.api.forgetMissingEntries()
    toast(t('library.forgotMissing', { n }), 'success')
  }

  /** The renderer names the entry; main shows the dialog and validates what comes back. */
  const locate = async (entry: LibraryEntry, how: 'folder' | 'file'): Promise<void> => {
    const result = await window.api.locateLibraryEntry(entry.id, how)
    if (result.status === 'found') toast(t('library.located'), 'success')
    else if (result.status === 'noMatch') setNoMatch({ entry, name: result.name })
    else if (result.status === 'taken') toast(t('library.locateTaken'), 'error')
    else if (result.status === 'failed') toast(t('library.locateFailed'), 'error')
  }

  const sections = useMemo(() => {
    const out: { title: string; rows: LibraryEntry[] }[] = []
    for (const e of entries) {
      const title =
        group === 'site'
          ? librarySite(e) || t('library.otherSite')
          : group === 'series'
            ? e.seriesId || t('library.otherSite')
            : dayLabel(e.finishedAt, language, t('library.today'), t('library.yesterday'))
      const last = out[out.length - 1]
      if (last && last.title === title) last.rows.push(e)
      else out.push({ title, rows: [e] })
    }
    return out
  }, [entries, group, language, t])

  const empty = loaded && entries.length === 0 && !query

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      {lost > 0 && (
        <HeaderSlot>
          <button className="btn-quiet" onClick={() => setConfirmForget(true)}>
            {t('library.forgetMissing')}
          </button>
        </HeaderSlot>
      )}
      {empty ? (
        <EmptyState
          icon={<Icon icon={FileVideo} size="xl" />}
          title={t('library.empty')}
          hint={t('library.emptyHint')}
          action={
            <button className="btn-solid rounded-pill px-6" onClick={() => useStore.getState().setView('home')}>
              {t('library.emptyAction')}
            </button>
          }
        />
      ) : (
        <div className="mx-auto w-full max-w-[800px] space-y-6 px-6 pb-10 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl
              label={t('library.groupBy')}
              value={group}
              onChange={setGroup}
              options={[
                { value: 'date', label: t('library.byDate') },
                { value: 'site', label: t('library.bySite') },
                { value: 'series', label: t('library.bySeries') }
              ]}
            />
            <label className="field ml-auto flex min-w-[220px] max-w-[300px] flex-1 cursor-text items-center gap-2">
              <Search size={16} className="shrink-0 text-ink-2" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('library.search')}
                aria-label={t('library.search')}
                className="no-drag min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink/80"
                spellCheck={false}
              />
            </label>
          </div>
          {entries.length === 0 && <p className="py-10 text-center text-body text-ink-2">{t('library.noMatch')}</p>}
          {sections.map((s, i) => (
            // With the index: a channel can be called "Other" as well as the heading for those without one.
            <PreferencesGroup key={`${i}:${s.title}`} title={s.title}>
              {s.rows.map((e) => {
                const gone = missing.has(e.filepath)
                const link = pageLinkOf(e)
                return (
                  <div key={e.id} className="ui-row min-h-[56px]" data-row={e.id}>
                    <span className="h-10 w-[72px] shrink-0 overflow-hidden rounded-1 bg-fill/10">
                      <Thumbnail
                        src={e.thumb}
                        pageUrl={e.sourceUrl ?? e.originUrl}
                        className="h-full w-full object-cover"
                        fallback={<span className="flex h-full w-full items-center justify-center text-ink-2"><FileVideo size={16} /></span>}
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="ui-row-title truncate" title={e.title}>
                        {e.title}
                      </p>
                      <p className="ui-row-subtitle numeric truncate">
                        {[
                          // Under a day's heading the time is enough; under anything else it needs its date.
                          group === 'date'
                            ? new Date(e.finishedAt).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })
                            : new Date(e.finishedAt).toLocaleString(language, {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              }),
                          e.duration ? formatDuration(e.duration) : null,
                          e.sizeBytes ? formatBytes(e.sizeBytes) : null,
                          e.container?.toUpperCase(),
                          group !== 'site' ? e.extractor : null,
                          // It says why a search for a channel found this row; under its own heading it would only repeat it.
                          e.uploader !== e.seriesId || group !== 'series' ? e.uploader : null
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    {/* Sent to a share by a watch and deleted here: not lost, just elsewhere. */}
                    {gone && e.remotePath ? (
                      <span className="tag shrink-0" title={e.remotePath}>
                        {t('library.onShare')}
                      </span>
                    ) : (
                      gone && <span className="tag shrink-0 text-warn">{t('library.missing')}</span>
                    )}
                    <div className="flex shrink-0 items-center gap-0.5">
                      <IconButton
                        label={t('common.play')}
                        icon={<Play size={16} />}
                        disabled={gone}
                        onClick={() =>
                          void window.api.openPath(e.filepath).then((why) => {
                            if (why) toast(t('queue.openFailed'), 'error')
                          })
                        }
                      />
                      <IconButton
                        label={t('common.showInFolder')}
                        icon={<FolderOpen size={16} />}
                        disabled={gone}
                        onClick={() => void showFile(e.filepath)}
                      />
                      <Menu
                        label={t('queue.more')}
                        items={[
                          ...(link
                            ? [
                                { label: t('queue.copyLink'), onSelect: () => void copyLink(link) },
                                { label: t('queue.openSource'), onSelect: () => void window.api.openExternal(link) }
                              ]
                            : []),
                          { label: t('library.cut'), onSelect: () => setJob({ entry: e, mode: 'trim' }), disabled: gone },
                          { label: t('library.convert'), onSelect: () => setJob({ entry: e, mode: 'convert' }), disabled: gone },
                          ...(gone && !e.remotePath
                            ? [{ label: t('library.locate'), onSelect: () => void locate(e, 'folder') }]
                            : []),
                          ...(link ? [{ label: t('library.again'), onSelect: () => requestDetect(link) }] : []),
                          'separator' as const,
                          { label: t('library.forget'), onSelect: () => void window.api.forgetLibraryEntry(e.id) },
                          ...(gone ? [] : [{ label: t('library.delete'), danger: true, onSelect: () => setConfirm(e) }])
                        ]}
                        trigger={(p) => <IconButton {...p} label={t('queue.more')} icon={<MoreHorizontal size={16} />} />}
                      />
                    </div>
                  </div>
                )
              })}
            </PreferencesGroup>
          ))}
          {hasMore && <div ref={sentinelRef} aria-hidden className="h-px" />}
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          title={t('library.deleteConfirm')}
          body={t('library.deleteBody', { title: confirm.title })}
          confirmLabel={t('library.deleteButton')}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const entry = confirm
            setConfirm(null)
            const ok = await window.api.trashLibraryEntry(entry.id)
            toast(ok ? t('library.trashed') : t('library.trashFailed'), ok ? 'success' : 'error')
          }}
        />
      )}
      {confirmForget && (
        <ConfirmDialog
          title={t('library.forgetMissingConfirm')}
          body={t('library.forgetMissingBody', { n: lost })}
          confirmLabel={t('library.forgetMissingButton')}
          onCancel={() => setConfirmForget(false)}
          onConfirm={() => void forgetAllMissing()}
        />
      )}
      {noMatch && (
        <Dialog
          role="alertdialog"
          title={t('library.locateNoMatch')}
          description={t('library.locateNoMatchBody', { name: noMatch.name })}
          onClose={() => setNoMatch(null)}
          actions={
            <>
              <button className="btn-quiet" onClick={() => setNoMatch(null)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn-solid"
                onClick={() => {
                  const { entry } = noMatch
                  setNoMatch(null)
                  void locate(entry, 'file')
                }}
              >
                {t('library.locateChoose')}
              </button>
            </>
          }
        />
      )}
      {job && <MediaJobModal item={asItem(job.entry)} mode={job.mode} onClose={() => setJob(null)} />}
    </div>
  )
}

