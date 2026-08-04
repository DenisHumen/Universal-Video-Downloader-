import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle,
  Check,
  Clock,
  Download,
  ExternalLink,
  Eye,
  Film,
  Globe,
  Layers,
  Loader2,
  Music,
  Search,
  SearchX,
  Tv,
  Video,
  X,
  Youtube
} from 'lucide-react'
import type { AppSettings, MediaInfo, SearchResult, SearchScope, SearchService } from '@shared/types'
import StreamingCard from '../components/StreamingCard'
import Thumbnail from '../components/Thumbnail'
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

interface ServiceMeta {
  value: SearchScope
  label: string
  icon: JSX.Element
}

const SERVICES: ServiceMeta[] = [
  { value: 'all', label: 'all services', icon: <Globe size={16} /> },
  { value: 'youtube', label: 'youtube', icon: <Youtube size={16} /> },
  { value: 'soundcloud', label: 'soundcloud', icon: <Music size={16} /> },
  { value: 'dailymotion', label: 'dailymotion', icon: <Video size={16} /> },
  { value: 'yummyani', label: 'anime', icon: <Tv size={16} /> },
  { value: 'bilibili', label: 'bilibili', icon: <Video size={16} /> },
  { value: 'niconico', label: 'niconico', icon: <Video size={16} /> },
  { value: 'pornhub', label: 'pornhub', icon: <Film size={16} /> }
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
  // so cards fill in as answers arrive. Only for services that carry both.
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

  const activeService = SERVICES.find((s) => s.value === service)
  const activeLabel = service === 'all' ? t('search.allServices') : (activeService?.label ?? '')

  return (
    <div className="flex h-full">
      {/* Services — vertical, scrollable (room for many more) */}
      <aside className="flex w-[176px] shrink-0 flex-col border-r border-fg/[0.06]">
        <p className="group-title mb-2 px-4 pt-6">{t('search.services')}</p>
        <div className="flex-1 space-y-1 overflow-y-auto px-2.5 pb-4">
          {SERVICES.map((s) => {
            const isActive = s.value === service
            return (
              <button
                key={s.value}
                onClick={() => changeService(s.value)}
                className="no-drag group relative flex w-full items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left"
              >
                {isActive && (
                  <motion.span
                    layoutId="search-service-active"
                    className="absolute inset-0 rounded-2xl bg-accent"
                    transition={{ type: 'spring', stiffness: 480, damping: 40 }}
                  />
                )}
                <span
                  className={`relative z-10 transition-colors ${
                    isActive ? 'text-accent-fg' : 'text-fg/45 group-hover:text-cream'
                  }`}
                >
                  {s.icon}
                </span>
                <span
                  className={`relative z-10 truncate text-[13px] font-medium transition-colors ${
                    isActive ? 'text-accent-fg' : 'text-fg/55 group-hover:text-cream'
                  }`}
                >
                  {s.value === 'all' ? t('search.allServices') : s.label}
                </span>
              </button>
            )
          })}
        </div>
      </aside>

      {/* Search + results */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="px-7 pt-7">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="flex items-center gap-2 rounded-3xl border border-fg/[0.08] bg-ink-900 p-2 transition-colors focus-within:border-accent/40"
          >
            <Search className="ml-2.5 shrink-0 text-fg/30" size={19} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
              placeholder={t('search.placeholder')}
              className="no-drag min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-cream placeholder:text-fg/25 outline-none"
              spellCheck={false}
            />
            <button
              className="btn-primary px-5 py-2.5"
              onClick={() => search()}
              disabled={!query.trim() || status === 'searching'}
            >
              {status === 'searching' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Search size={16} />
              )}
              {t('common.search')}
            </button>
          </motion.div>
          <div className="mt-2.5 flex items-center justify-between px-1">
            <p className="mono text-xs text-fg/35">{t('search.searching', { service: activeLabel })}</p>
            {results && (
              <span className="mono text-xs text-fg/35">
                {t('search.results', { count: results.length })}
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-7 pb-7 pt-4">
          <AnimatePresence mode="popLayout">
            {status === 'searching' && (
              <motion.div
                key="skeleton"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="grid grid-cols-2 gap-3 lg:grid-cols-3"
              >
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="card overflow-hidden">
                    <div className="relative aspect-video bg-fg/[0.04]">
                      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-fg/[0.08] to-transparent" />
                    </div>
                    <div className="space-y-2 p-3">
                      <div className="h-3.5 w-5/6 rounded bg-fg/[0.05]" />
                      <div className="h-3 w-1/2 rounded bg-fg/[0.05]" />
                      <div className="h-8 w-full rounded-xl bg-fg/[0.04]" />
                    </div>
                  </div>
                ))}
              </motion.div>
            )}

            {status === 'error' && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="card flex items-start gap-3 p-4"
              >
                <AlertCircle className="mt-0.5 shrink-0 text-bad" size={18} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-cream">{t('search.failed')}</p>
                  <p className="mt-0.5 text-xs text-fg/45">{error}</p>
                </div>
              </motion.div>
            )}

            {status === 'idle' && results && results.length === 0 && (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center py-16 text-center"
              >
                <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-fg/[0.03] text-fg/20">
                  <SearchX size={28} />
                </div>
                <p className="mt-4 text-sm font-medium text-fg/55">{t('search.nothing')}</p>
                <p className="mono mt-1 text-xs text-fg/30">{t('search.nothingHint')}</p>
              </motion.div>
            )}

            {status === 'idle' && results && results.length > 0 && (
              <motion.div
                key="results"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="grid grid-cols-2 gap-3 lg:grid-cols-3"
              >
                {results.map((r, i) => (
                  <ResultCard
                    key={`${r.service}-${r.id}-${i}`}
                    result={r}
                    index={i}
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
                className="flex flex-col items-center justify-center py-16 text-center"
              >
                <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-fg/[0.03] text-fg/20">
                  <Search size={28} />
                </div>
                <p className="mt-4 text-sm font-medium text-fg/55">{t('search.title')}</p>
                <p className="mono mt-1 text-xs text-fg/30">{t('search.hint')}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Anime episode/translator/quality picker */}
      <AnimatePresence>
        {picker && (
          <motion.div
            key="picker-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
            onClick={() => setPicker(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 12 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              className="relative max-h-[86vh] w-full max-w-lg overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="btn-icon absolute right-2 top-2 z-10 bg-black/40"
                onClick={() => setPicker(null)}
                aria-label={t('common.close')}
              >
                <X size={16} />
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

function qualityBadge(
  probe: QualityProbe | undefined,
  service: SearchService,
  t: TranslateFn
): JSX.Element | null {
  if (service === 'yummyani') {
    return (
      <span className="chip bg-black/70 text-[10px] font-semibold text-white/90">
        <Tv size={9} /> {t('search.anime')}
      </span>
    )
  }
  if (service === 'soundcloud') {
    return (
      <span className="chip bg-black/70 text-[10px] text-white/85">
        <Music size={9} /> {t('search.audio')}
      </span>
    )
  }
  if (!probe || probe.status === 'loading') {
    return (
      <span className="chip bg-black/70 text-[10px] text-white/60">
        <Loader2 size={9} className="animate-spin" /> {t('search.qualityProbe')}
      </span>
    )
  }
  if (probe.status === 'done' && probe.maxHeight > 0) {
    return (
      <span className="chip bg-black/70 text-[10px] font-semibold text-white/90">
        {probe.maxHeight}p
      </span>
    )
  }
  if (probe.status === 'done') {
    return (
      <span className="chip bg-black/70 text-[10px] text-white/85">
        <Music size={9} /> {t('search.audio')}
      </span>
    )
  }
  return null
}

function ResultCard({
  result,
  index,
  probe,
  added,
  busy,
  t,
  onDownload,
  onOpenPicker
}: {
  result: SearchResult
  index: number
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

  const handle = async (): Promise<void> => {
    if (isAnime) {
      await onOpenPicker()
      return
    }
    setDownloading(true)
    await onDownload()
    setDownloading(false)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.03, 0.35) }}
      className="card group flex flex-col overflow-hidden transition-colors hover:border-fg/[0.16]"
    >
      <button
        className="relative block aspect-video w-full cursor-pointer overflow-hidden bg-ink-950 text-left"
        title={t('common.openInBrowser')}
        onClick={() => window.api.openExternal(result.url)}
      >
        <Thumbnail
          src={thumb}
          pageUrl={result.url}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          fallback={
            <div className="flex h-full items-center justify-center text-fg/15">
              {isAnime ? <Tv size={26} /> : <Search size={26} />}
            </div>
          }
        />
        <div className="absolute left-1.5 top-1.5">{qualityBadge(probe, result.service, t)}</div>
        <span className="chip absolute right-1.5 top-1.5 bg-black/70 text-[10px] text-white/75">
          {result.service}
        </span>
        {result.duration != null && result.duration > 0 && (
          <span className="chip absolute bottom-1.5 right-1.5 bg-black/70 text-[10px] font-medium text-white/90">
            <Clock size={9} /> {formatDuration(result.duration)}
          </span>
        )}
      </button>

      <div className="flex flex-1 flex-col p-3">
        <p className="line-clamp-2 text-[13px] font-medium leading-snug text-cream" title={result.title}>
          {result.title}
        </p>
        <div className="mono mt-1.5 flex items-center gap-2 text-[11px] text-fg/35">
          {result.uploader && <span className="truncate">{result.uploader}</span>}
          {result.viewCount != null && (
            <span className="flex shrink-0 items-center gap-1">
              <Eye size={10} /> {formatCount(result.viewCount)}
            </span>
          )}
        </div>

        <div className="mt-auto flex items-center gap-1.5 pt-3">
          <button
            className={`btn flex-1 py-2 text-xs ${added ? 'bg-good/15 text-good' : 'btn-primary'}`}
            onClick={handle}
            disabled={downloading || busy || added}
          >
            {downloading || busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : added ? (
              <Check size={14} />
            ) : isAnime ? (
              <Layers size={14} />
            ) : (
              <Download size={14} />
            )}
            {added ? t('search.queued') : isAnime ? t('search.episodes') : t('common.download')}
          </button>
          <button
            className="btn-icon shrink-0"
            title={t('common.openInBrowser')}
            onClick={() => window.api.openExternal(result.url)}
          >
            <ExternalLink size={15} />
          </button>
        </div>
      </div>
    </motion.div>
  )
}
