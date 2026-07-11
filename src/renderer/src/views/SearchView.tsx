import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle,
  Check,
  Clock,
  Download,
  ExternalLink,
  Eye,
  Globe,
  Loader2,
  Music,
  Search,
  SearchX
} from 'lucide-react'
import type { AppSettings, SearchResult, SearchScope, SearchService } from '@shared/types'
import Segmented from '../components/Segmented'
import { formatCount, formatDuration } from '../lib/format'
import { initialMode, initialQuality, maxHeightOf } from '../lib/quality'
import { toast } from '../lib/toast'

type Status = 'idle' | 'searching' | 'error'

interface QualityProbe {
  status: 'loading' | 'done' | 'failed'
  maxHeight: number
}

interface Props {
  settings: AppSettings | null
}

function queryFromHash(): string {
  const m = window.location.hash.match(/[?&]q=([^&]*)/)
  return m ? decodeURIComponent(m[1]) : ''
}

export default function SearchView({ settings }: Props): JSX.Element {
  const [query, setQuery] = useState(queryFromHash)
  const [service, setService] = useState<SearchScope>('all')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [probes, setProbes] = useState<Record<string, QualityProbe>>({})
  const [added, setAdded] = useState<Set<string>>(new Set())
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
    const res = await window.api.searchVideos(q, s, s === 'all' ? 6 : 12)
    if (res.ok && res.results) {
      setResults(res.results)
      setStatus('idle')
      void probeQualities(res.results, generation.current)
    } else {
      setError(res.error || 'Search failed.')
      setStatus('error')
    }
  }

  // Lazily discover each result's best available quality (2 probes at a time)
  // so the cards fill in with "1080p" / "audio" badges as answers arrive.
  // SoundCloud is audio-only — no point probing it.
  const probeQualities = async (list: SearchResult[], gen: number): Promise<void> => {
    const queue = list.filter((r) => r.service !== 'soundcloud')
    const worker = async (): Promise<void> => {
      while (queue.length) {
        const item = queue.shift()!
        if (gen !== generation.current) return
        setProbes((p) => ({ ...p, [item.url]: { status: 'loading', maxHeight: 0 } }))
        try {
          const res = await window.api.detect(item.url)
          if (gen !== generation.current) return
          const maxHeight = res.ok && res.info ? maxHeightOf(res.info.formats) : 0
          setProbes((p) => ({
            ...p,
            [item.url]: { status: res.ok ? 'done' : 'failed', maxHeight }
          }))
        } catch {
          if (gen !== generation.current) return
          setProbes((p) => ({ ...p, [item.url]: { status: 'failed', maxHeight: 0 } }))
        }
      }
    }
    await Promise.all([worker(), worker()])
  }

  // Auto-run the query this window was opened with + follow-up queries sent
  // from the main window while this one is already open.
  useEffect(() => {
    if (query) void search(query)
    else inputRef.current?.focus()
    const off = window.api.onSearchQuery((q) => {
      setQuery(q)
      void search(q)
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const changeService = (s: SearchScope): void => {
    setService(s)
    if (results || status === 'error') void search(undefined, s)
  }

  const download = async (r: SearchResult): Promise<void> => {
    const probe = probes[r.url]
    const mode = r.service === 'soundcloud' ? 'audio' : initialMode(settings)
    try {
      await window.api.startDownload({
        url: r.url,
        title: r.title,
        thumbnail: r.thumbnail,
        mode,
        quality: mode === 'audio' ? 'audio' : initialQuality(settings, probe?.maxHeight || 0)
      })
      setAdded((prev) => new Set(prev).add(r.url))
      toast('Added to the queue — see the main window', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not start the download', 'error')
    }
  }

  const services = useMemo(
    () => [
      { value: 'all', label: 'all services', icon: <Globe size={13} /> },
      { value: 'youtube', label: 'youtube' },
      { value: 'soundcloud', label: 'soundcloud' },
      { value: 'bilibili', label: 'bilibili' },
      { value: 'niconico', label: 'niconico' }
    ],
    []
  )

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-8 py-8">
      {/* Search bar */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex items-center gap-2 rounded-3xl border border-white/[0.08] bg-ink-900 p-2 transition-colors focus-within:border-white/25"
      >
        <Search className="ml-2.5 shrink-0 text-white/30" size={19} />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="search videos by title"
          className="no-drag min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-cream placeholder-white/25 outline-none"
          spellCheck={false}
        />
        <button
          className="btn-primary px-5 py-2.5"
          onClick={() => search()}
          disabled={!query.trim() || status === 'searching'}
        >
          {status === 'searching' ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          search
        </button>
      </motion.div>

      {/* Service picker */}
      <div className="mt-3 flex items-center justify-between gap-3">
        <Segmented
          layoutId="search-service"
          fill={false}
          value={service}
          onChange={(v) => changeService(v as SearchScope)}
          options={services}
        />
        {results && (
          <span className="mono text-xs text-white/35">
            {results.length} result{results.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {/* Results */}
      <div className="mt-4">
        <AnimatePresence mode="wait">
          {status === 'searching' && (
            <motion.div
              key="skeleton"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="grid grid-cols-2 gap-3 xl:grid-cols-3"
            >
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="card overflow-hidden">
                  <div className="relative aspect-video bg-white/[0.04]">
                    <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                  </div>
                  <div className="space-y-2 p-3">
                    <div className="h-3.5 w-5/6 rounded bg-white/[0.05]" />
                    <div className="h-3 w-1/2 rounded bg-white/[0.05]" />
                    <div className="h-8 w-full rounded-xl bg-white/[0.04]" />
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
              <AlertCircle className="mt-0.5 shrink-0 text-red-400/80" size={18} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-cream">search failed</p>
                <p className="mt-0.5 text-xs text-white/45">{error}</p>
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
              <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-white/[0.03] text-white/20">
                <SearchX size={28} />
              </div>
              <p className="mt-4 text-sm font-medium text-white/55">nothing found</p>
              <p className="mono mt-1 text-xs text-white/30">try different keywords</p>
            </motion.div>
          )}

          {status === 'idle' && results && results.length > 0 && (
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="grid grid-cols-2 gap-3 pb-4 xl:grid-cols-3"
            >
              {results.map((r, i) => (
                <ResultCard
                  key={r.url}
                  result={r}
                  index={i}
                  probe={probes[r.url]}
                  added={added.has(r.url)}
                  onDownload={() => download(r)}
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
              <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-white/[0.03] text-white/20">
                <Search size={28} />
              </div>
              <p className="mt-4 text-sm font-medium text-white/55">search across video services</p>
              <p className="mono mt-1 text-xs text-white/30">type a title and press enter</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function qualityBadge(probe: QualityProbe | undefined, service: SearchService): JSX.Element | null {
  if (service === 'soundcloud') {
    return (
      <span className="chip bg-black/70 text-[10px] text-white/85">
        <Music size={9} /> audio
      </span>
    )
  }
  if (!probe || probe.status === 'loading') {
    return (
      <span className="chip bg-black/70 text-[10px] text-white/60">
        <Loader2 size={9} className="animate-spin" /> quality…
      </span>
    )
  }
  if (probe.status === 'done' && probe.maxHeight > 0) {
    return <span className="chip bg-black/70 text-[10px] font-semibold text-white/90">{probe.maxHeight}p</span>
  }
  if (probe.status === 'done') {
    return (
      <span className="chip bg-black/70 text-[10px] text-white/85">
        <Music size={9} /> audio
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
  onDownload
}: {
  result: SearchResult
  index: number
  probe?: QualityProbe
  added: boolean
  onDownload: () => Promise<void>
}): JSX.Element {
  const [busy, setBusy] = useState(false)

  const handleDownload = async (): Promise<void> => {
    setBusy(true)
    await onDownload()
    setBusy(false)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.4) }}
      className="card group flex flex-col overflow-hidden transition-colors hover:border-white/[0.16]"
    >
      <button
        className="relative block aspect-video w-full cursor-pointer overflow-hidden bg-ink-950 text-left"
        title="Open in browser"
        onClick={() => window.api.openExternal(result.url)}
      >
        {result.thumbnail ? (
          <img
            src={result.thumbnail}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-white/15">
            <Search size={26} />
          </div>
        )}
        <div className="absolute left-1.5 top-1.5">{qualityBadge(probe, result.service)}</div>
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
        <div className="mono mt-1.5 flex items-center gap-2 text-[11px] text-white/35">
          {result.uploader && <span className="truncate">{result.uploader}</span>}
          {result.viewCount != null && (
            <span className="flex shrink-0 items-center gap-1">
              <Eye size={10} /> {formatCount(result.viewCount)}
            </span>
          )}
        </div>

        <div className="mt-auto flex items-center gap-1.5 pt-3">
          <button
            className={`btn flex-1 py-2 text-xs ${
              added ? 'bg-emerald-400/15 text-emerald-300' : 'btn-primary'
            }`}
            onClick={handleDownload}
            disabled={busy || added}
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : added ? (
              <Check size={14} />
            ) : (
              <Download size={14} />
            )}
            {added ? 'queued' : 'download'}
          </button>
          <button
            className="btn-icon shrink-0"
            title="Open in browser"
            onClick={() => window.api.openExternal(result.url)}
          >
            <ExternalLink size={15} />
          </button>
        </div>
      </div>
    </motion.div>
  )
}
