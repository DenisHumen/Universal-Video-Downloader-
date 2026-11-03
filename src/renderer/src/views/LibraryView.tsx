import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LibraryEntry, LibraryGroup } from '@shared/library'
import type { DownloadItem } from '@shared/types'
import { useStore } from '../store'
import { useI18n, useT } from '../i18n'
import { formatBytes } from '../lib/format'
import { toast } from '../lib/toast'
import ConfirmDialog from '../components/ConfirmDialog'
import MediaJobModal, { type JobMode } from '../components/MediaJobModal'
import Thumbnail from '../components/Thumbnail'
import { EmptyState, Icon, IconButton, Menu, PreferencesGroup, SegmentedControl } from '../ui'
import { FileVideo, FolderOpen, MoreHorizontal, Play, Search } from '../ui/icons'

/*
  The Library (plan 5.3): every file the app has finished, from main's
  library.json (services/library.ts), which "clear finished" in Activity
  never touches. Grouped by date or site, searchable by title. Whether a
  file is still on disk is asked in a batch when the view opens, never
  stored. "Delete file" asks first, then moves it to the system trash.
*/

const DAY = 86_400_000

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
    extractor: e.extractor
  }
}

export default function LibraryView(): JSX.Element {
  const t = useT()
  const language = useI18n((s) => s.language)
  const requestDetect = useStore((s) => s.requestDetect)
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<LibraryGroup>('date')
  const [missing, setMissing] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<LibraryEntry | null>(null)
  const [job, setJob] = useState<{ entry: LibraryEntry; mode: JobMode } | null>(null)

  const load = useCallback(async () => {
    const page = await window.api.listLibrary({ query, group, limit: 500 })
    setEntries(page.entries)
    setLoaded(true)
    const gone = await window.api.libraryMissing(page.entries.map((e) => e.filepath))
    setMissing(new Set(gone))
  }, [query, group])

  useEffect(() => {
    void load()
    return window.api.onLibraryChanged(() => void load())
  }, [load])

  const sections = useMemo(() => {
    const out: { title: string; rows: LibraryEntry[] }[] = []
    for (const e of entries) {
      const title =
        group === 'site'
          ? e.extractor || t('library.otherSite')
          : dayLabel(e.finishedAt, language, t('library.today'), t('library.yesterday'))
      const last = out[out.length - 1]
      if (last && last.title === title) last.rows.push(e)
      else out.push({ title, rows: [e] })
    }
    return out
  }, [entries, group, language, t])

  const empty = loaded && entries.length === 0 && !query

  return (
    <div className="h-full overflow-y-auto">
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
                { value: 'site', label: t('library.bySite') }
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
                className="no-drag min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-3"
                spellCheck={false}
              />
            </label>
          </div>
          {entries.length === 0 && <p className="py-10 text-center text-body text-ink-2">{t('library.noMatch')}</p>}
          {sections.map((s) => (
            <PreferencesGroup key={s.title} title={s.title}>
              {s.rows.map((e) => {
                const gone = missing.has(e.filepath)
                return (
                  <div key={e.id} className="ui-row min-h-[56px]" data-row={e.id}>
                    <span className="h-10 w-[72px] shrink-0 overflow-hidden rounded-1 bg-fill/10">
                      <Thumbnail
                        src={e.thumb}
                        pageUrl={e.sourceUrl}
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
                          new Date(e.finishedAt).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' }),
                          e.sizeBytes ? formatBytes(e.sizeBytes) : null,
                          e.container?.toUpperCase(),
                          group === 'date' ? e.extractor : null
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    {gone && <span className="tag shrink-0 text-warn">{t('library.missing')}</span>}
                    <IconButton
                      label={t('common.play')}
                      icon={<Play size={16} />}
                      disabled={gone}
                      onClick={() => void window.api.openPath(e.filepath)}
                    />
                    <IconButton
                      label={t('common.showInFolder')}
                      icon={<FolderOpen size={16} />}
                      disabled={gone}
                      onClick={() => void window.api.showInFolder(e.filepath)}
                    />
                    <Menu
                      label={t('queue.more')}
                      items={[
                        { label: t('library.cut'), onSelect: () => setJob({ entry: e, mode: 'trim' }), disabled: gone },
                        { label: t('library.convert'), onSelect: () => setJob({ entry: e, mode: 'convert' }), disabled: gone },
                        { label: t('library.again'), onSelect: () => requestDetect(e.sourceUrl || e.url) },
                        'separator',
                        gone
                          ? { label: t('library.forget'), onSelect: () => void window.api.forgetLibraryEntry(e.id) }
                          : { label: t('library.delete'), danger: true, onSelect: () => setConfirm(e) }
                      ]}
                      trigger={(p) => <IconButton {...p} label={t('queue.more')} icon={<MoreHorizontal size={16} />} />}
                    />
                  </div>
                )
              })}
            </PreferencesGroup>
          ))}
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
      {job && <MediaJobModal item={asItem(job.entry)} mode={job.mode} onClose={() => setJob(null)} />}
    </div>
  )
}

