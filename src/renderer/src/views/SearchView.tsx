import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { dialog, enter, overlay, staggerChild, staggerParent } from '../lib/motion'
import { Check, Download, ExternalLink, Loader2, Search, X } from 'lucide-react'
import type { AppSettings, MediaInfo, SearchResult, SearchScope, SearchService } from '@shared/types'
import StreamingCard from '../components/StreamingCard'
import Thumbnail from '../components/Thumbnail'
import Choice from '../components/Choice'
import { formatCount, formatDuration } from '../lib/format'
import { initialMode, initialQuality, maxHeightOf } from '../lib/quality'
import { toast } from '../lib/toast'
import { useT, type TranslateFn } from '../i18n'
import { useStore } from '../store'

type Status = 'idle' | 'searching' | 'error'

interface QualityProbe {
  status: 'loading' | 'done' | 'failed'
  maxHeight: number
  thumbnail?: string
}

interface Props {
  settings: AppSettings | null
  /** Rendered inside the main window (rather than the standalone search window). */
  embedded?: boolean
}

/**
 * Services are a wrapping pill row, not a 176px vertical rail.
 *
 * The rail cost a fixed column of the window on eight one-word labels and put
 * the scope control as far from the query field as the layout allowed. Sitting
 * the pills directly under the field says what they are — a filter on the thing
 * above — and gives the results the full width.
 */
const SERVICES: { value: SearchScope; label: string }[] = [
  { value: 'all', label: 'all' },
  { value: 'youtube', label: 'youtube' },
  { value: 'soundcloud', label: 'soundcloud' },
  { value: 'dailymotion', label: 'dailymotion' },
  { value: 'yummyani', label: 'anime' },
  { value: 'bilibili', label: 'bilibili' },
  { value: 'niconico', label: 'niconico' },
  { value: 'pornhub', label: 'pornhub' }
]

// Services whose results carry real thumbnails + a probe-able quality.
const PROBE_SERVICES: SearchService[] = ['youtube', 'pornhub', 'dailymotion']

function queryFromHash(): string {
  const m = window.location.hash.match(/[?&]q=([^&]*)/)
  return m ? decodeURIComponent(m[1]) : ''
}

export default function SearchView({ settings, embedded = false }: Props): JSX.Element {
  const t = useT()
  const setView = useStore((s) => s.setView)
  const [query, setQuery] = useState(embedded ? '' : queryFromHash)
  const [service, setService] = useState<SearchScope>('all')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [probes, setProbes] = useState<Record<string, QualityProbe>>({})
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [picker, setPicker] = useState<MediaInfo | null>(null)
  const [pickerBusy, setPickerBusy] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Bumped on every new search so stale probe results are discarded.
  const generation = useRef(0)

  const search = async (value?: string, svc?: SearchScope): Promise<void> => {
    const q = (value ?? query).trim()
    const s = svc ?? service
    if (!q) return
    generation.current++
    setStatus('searching')
    setError('')
    setResults(null)
    setProbes({})
    setAdded(new Set())
    setPicker(null)
    const res = await window.api.searchVideos(q, s, s === 'all' ? 6 : 12)
    if (res.ok && res.results) {
      setResults(res.results)
      setStatus('idle')
      void probeQualities(res.results, generation.current)
    } else {
      setError(res.error || t('search.failed'))
      setStatus('error')
    }
  }

  // Lazily discover each result's best quality + thumbnail (2 probes at a time)
  // so tiles fill in as answers arrive. Only for services that carry both.
  const probeQualities = async (list: SearchResult[], gen: number): Promise<void> => {
    const queue = list.filter((r) => PROBE_SERVICES.includes(r.service))
    const worker = async (): Promise<void> => {
      while (queue.length) {
        const item = queue.shift()!
        if (gen !== generation.current) return
        setProbes((p) => ({ ...p, [item.url]: { status: 'loading', maxHeight: 0 } }))
        try {
          const res = await window.api.detect(item.url)
          if (gen !== generation.current) return
          const info = res.ok ? res.info : undefined
          setProbes((p) => ({
            ...p,
            [item.url]: {
              status: res.ok ? 'done' : 'failed',
              maxHeight: info ? maxHeightOf(info.formats) : 0,
              thumbnail: info?.thumbnail
            }
          }))
        } catch {
          if (gen !== generation.current) return
          setProbes((p) => ({ ...p, [item.url]: { status: 'failed', maxHeight: 0 } }))
        }
      }
    }
    await Promise.all([worker(), worker()])
  }

  // Auto-run the query this view was opened with, plus follow-up queries sent
  // from the main window (standalone) or the home view (embedded).
  useEffect(() => {
    if (query) void search(query)
    else inputRef.current?.focus()

    const offIpc = embedded
      ? undefined
      : window.api.onSearchQuery((q) => {
          setQuery(q)
          void search(q)
        })
    const onLocalQuery = (e: Event): void => {
      const q = (e as CustomEvent<string>).detail
      if (!q) return
      setQuery(q)
      void search(q)
    }
    window.addEventListener('uvd:search-query', onLocalQuery)
    return () => {
      offIpc?.()
      window.removeEventListener('uvd:search-query', onLocalQuery)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const changeService = (s: SearchScope): void => {
    setService(s)
    if (results || status === 'error') void search(undefined, s)
  }

  // Regular video/audio: queue straight to the downloads list.
  const download = async (r: SearchResult): Promise<void> => {
    const probe = probes[r.url]
    const mode = r.service === 'soundcloud' ? 'audio' : initialMode(settings)
    try {
      await window.api.startDownload({
        url: r.url,
        title: r.title,
        thumbnail: r.thumbnail || probe?.thumbnail,
        mode,
        quality: mode === 'audio' ? 'audio' : initialQuality(settings, probe?.maxHeight || 0)
      })
      setAdded((prev) => new Set(prev).add(r.url))
      toast(embedded ? t('home.addedToQueue') : t('search.addedRemote'), 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : t('home.startFailed'), 'error')
    }
  }

  // Anime: open the episode/translator/quality picker (like pasting the link).
  const openPicker = async (r: SearchResult): Promise<void> => {
    if (!r.pickerUrl) return
    setPickerBusy(r.url)
    try {
      const res = await window.api.detect(r.pickerUrl)
      if (res.ok && res.info?.streaming) setPicker(res.info)
      else toast(res.error || t('search.failed'), 'error')
    } catch (err) {
      toast(err instanceof Error ? err.message : t('search.failed'), 'error')
    } finally {
      setPickerBusy(null)
    }
  }

  const activeLabel =
    service === 'all' ? t('search.allServices') : (SERVICES.find((s) => s.value === service)?.label ?? '')

  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto w-full max-w-[1080px] shrink-0 px-6 pt-10">
        <label className="label mb-2.5 block" htmlFor="uvd-search">
          {t('search.title')}
        </label>
        <div className="field flex items-center gap-1.5 rounded-3 p-2">
          <Search size={16} className="ml-2 shrink-0 text-ink-3" />
          <input
            id="uvd-search"
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder={t('search.placeholder')}
            className="no-drag min-w-0 flex-1 bg-transparent px-1.5 py-2 text-[15px] text-ink outline-none placeholder:text-ink-3"
            spellCheck={false}
            autoComplete="off"
          />
          <button
            className="btn-solid px-4 py-3"
            onClick={() => search()}
            disabled={!query.trim() || status === 'searching'}
          >
            {status === 'searching' ? <Loader2 size={15} className="animate-spin" /> : null}
            {t('common.search')}
          </button>
        </div>

        <div className="mt-3.5 flex flex-wrap items-center gap-3">
          <Choice
            label={t('search.services')}
            value={service}
            onChange={(v) => changeService(v as SearchScope)}
            options={SERVICES.map((s) => ({
              value: s.value,
              label: s.value === 'all' ? t('search.allServices') : s.label
            }))}
          />
          {results && (
            <span className="mono ml-auto shrink-0 text-[11px] text-ink-3">
              {t('search.results', { count: results.length })}
            </span>
          )}
        </div>
      </div>

      <div className="mx-auto min-h-0 w-full max-w-[1080px] flex-1 overflow-y-auto px-6 pb-8 pt-6">
        <AnimatePresence mode="popLayout">
          {status === 'searching' && (
            <motion.div
              key="skeleton"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="grid grid-cols-2 gap-x-5 gap-y-7 md:grid-cols-3 xl:grid-cols-4"
            >
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i}>
                  <div className="skeleton aspect-video w-full rounded-2" />
                  <div className="skeleton mt-2.5 h-3.5 w-5/6 rounded-1" />
                  <div className="skeleton mt-1.5 h-3 w-1/2 rounded-1" />
                </div>
              ))}
            </motion.div>
          )}

          {status === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={enter}
              className="block p-4"
            >
              <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
                <span className="h-1.5 w-1.5 rounded-full bg-bad" /> {t('search.failed')}
              </p>
              <p className="mono selectable mt-2 break-words text-[12px] leading-relaxed text-ink-2">
                {error}
              </p>
            </motion.div>
          )}

          {status === 'idle' && results && results.length === 0 && (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-24 text-center"
            >
              <p className="text-[14px] font-medium text-ink">{t('search.nothing')}</p>
              <p className="mono mt-1.5 text-[11px] text-ink-3">{t('search.nothingHint')}</p>
            </motion.div>
          )}

          {status === 'idle' && results && results.length > 0 && (
            <motion.div
              key="results"
              variants={staggerParent}
              initial="hidden"
              animate="show"
              exit={{ opacity: 0 }}
              className="grid grid-cols-2 gap-x-5 gap-y-7 md:grid-cols-3 xl:grid-cols-4"
            >
              {results.map((r, i) => (
                <ResultTile
                  key={`${r.service}-${r.id}-${i}`}
                  result={r}
                  probe={probes[r.url]}
                  added={added.has(r.url)}
                  busy={pickerBusy === r.url}
                  t={t}
                  onDownload={() => download(r)}
                  onOpenPicker={() => openPicker(r)}
                />
              ))}
            </motion.div>
          )}

          {status === 'idle' && !results && (
            <motion.div
              key="hint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-24 text-center"
            >
              <p className="mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
                {t('search.searching', { service: activeLabel })}
              </p>
              <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-ink-2">
                {t('search.hint')}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Anime episode/translator/quality picker */}
      <AnimatePresence>
        {picker && (
          <motion.div
            key="picker-backdrop"
            {...overlay}
            className="fixed inset-0 flex items-center justify-center bg-canvas/80 p-6"
            style={{ zIndex: 'var(--z-modal)' }}
            onClick={() => setPicker(null)}
          >
            <motion.div
              {...dialog}
              className="relative max-h-[86vh] w-full max-w-lg overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="btn-icon absolute right-2 top-2 z-10 bg-raise"
                onClick={() => setPicker(null)}
                aria-label={t('common.close')}
              >
                <X size={15} />
              </button>
              <StreamingCard
                info={picker}
                onDone={() => {
                  setPicker(null)
                  if (embedded) setView('downloads')
                }}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** The quality/kind marker in the thumbnail's corner. */
function marker(probe: QualityProbe | undefined, service: SearchService, t: TranslateFn): string | null {
  if (service === 'yummyani') return t('search.anime')
  if (service === 'soundcloud') return t('search.audio')
  if (!probe || probe.status === 'loading') return t('search.qualityProbe')
  if (probe.status === 'done' && probe.maxHeight > 0) return `${probe.maxHeight}p`
  if (probe.status === 'done') return t('search.audio')
  return null
}

/**
 * A result tile with no frame.
 *
 * The old card had a border, a lit top edge, a hover lift and a hover shadow —
 * four devices to say "this is one item", in a grid where the gaps already say
 * it. Here the thumbnail is the object and everything else is set beneath it.
 */
function ResultTile({
  result,
  probe,
  added,
  busy,
  t,
  onDownload,
  onOpenPicker
}: {
  result: SearchResult
  probe?: QualityProbe
  added: boolean
  busy: boolean
  t: TranslateFn
  onDownload: () => Promise<void>
  onOpenPicker: () => Promise<void>
}): JSX.Element {
  const [downloading, setDownloading] = useState(false)
  const isAnime = result.service === 'yummyani'
  const thumb = result.thumbnail || probe?.thumbnail
  const badge = marker(probe, result.service, t)

  const handle = async (): Promise<void> => {
    if (isAnime) {
      await onOpenPicker()
      return
    }
    setDownloading(true)
    await onDownload()
    setDownloading(false)
  }

  const meta = [result.uploader, result.viewCount != null ? formatCount(result.viewCount) : null]
    .filter(Boolean)
    .join('  ·  ')

  return (
    <motion.div variants={staggerChild} className="group flex flex-col">
      <button
        className="relative block aspect-video w-full cursor-pointer overflow-hidden rounded-2 bg-sink text-left"
        title={t('common.openInBrowser')}
        onClick={() => window.api.openExternal(result.url)}
      >
        <Thumbnail
          src={thumb}
          pageUrl={result.url}
          className="h-full w-full object-cover"
          fallback={<div className="h-full w-full bg-sink" />}
        />
        {badge && (
          <span className="mono absolute left-1.5 top-1.5 rounded-1 bg-canvas/85 px-1.5 py-1 text-[10px] leading-none text-ink">
            {badge}
          </span>
        )}
        {result.duration != null && result.duration > 0 && (
          <span className="mono absolute bottom-1.5 right-1.5 rounded-1 bg-canvas/85 px-1.5 py-1 text-[10px] leading-none text-ink">
            {formatDuration(result.duration)}
          </span>
        )}
      </button>

      <p
        className="mt-2.5 line-clamp-2 text-[13px] font-medium leading-snug text-ink"
        title={result.title}
      >
        {result.title}
      </p>
      <p className="mono mt-1 truncate text-[11px] text-ink-3">{meta || result.service}</p>

      <div className="mt-auto flex items-center gap-1 pt-2.5">
        <button
          className={`flex-1 py-2 ${added ? 'btn bg-good/12 text-good' : 'btn-quiet'}`}
          onClick={handle}
          disabled={downloading || busy || added}
        >
          {downloading || busy ? (
            <Loader2 size={13} className="animate-spin" />
          ) : added ? (
            <Check size={13} />
          ) : (
            <Download size={13} />
          )}
          {added ? t('search.queued') : isAnime ? t('search.episodes') : t('common.download')}
        </button>
        <button
          className="btn-icon"
          title={t('common.openInBrowser')}
          onClick={() => window.api.openExternal(result.url)}
        >
          <ExternalLink size={14} />
        </button>
      </div>
    </motion.div>
  )
}
