import { useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence, m } from 'framer-motion'
import { staggerChild, staggerParent } from '../lib/motion'
import { AlertTriangle, ArrowRight, Check, ChevronDown, Download, Loader2, RotateCw, Search, SearchX, X } from '../ui/icons'
import { EmptyState, Icon, Spinner, ToggleGroup } from '../ui'
import HeaderSlot from '../shell/HeaderSlot'
import type {
  AppErrorCode,
  AppSettings,
  MediaInfo,
  SearchResponse,
  SearchResult,
  SearchScope,
  SearchService
} from '@shared/types'
import { ADULT_SEARCH_SERVICES, allowedSearchServices } from '@shared/types'
import StreamingCard from '../components/StreamingCard'
import Modal from '../components/Modal'
import Thumbnail from '../components/Thumbnail'
import { formatCount, formatDuration } from '../lib/format'
import { initialMode, initialQuality, maxHeightOf } from '../lib/quality'
import { toast } from '../lib/toast'
import { queueDownload } from '../lib/queue'
import { describeError, errorText } from '../lib/errors'
import { useT, type TranslateFn } from '../i18n'
import { serviceLabel } from '../lib/services'
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
const SERVICES: SearchScope[] = [
  'all',
  'youtube',
  'soundcloud',
  'dailymotion',
  'yummyani',
  'bilibili',
  'niconico',
  'pornhub'
]

// Services whose results carry real thumbnails + a probe-able quality.
const PROBE_SERVICES: SearchService[] = ['youtube', 'pornhub', 'dailymotion']

function queryFromHash(): string {
  const m = window.location.hash.match(/[?&]q=([^&]*)/)
  return m ? decodeURIComponent(m[1]) : ''
}

export default function SearchView({ settings, embedded = false }: Props): JSX.Element {
  const t = useT()
  const pendingQuery = useStore((s) => s.pendingQuery)
  const takePendingQuery = useStore((s) => s.takePendingQuery)
  const [query, setQuery] = useState(embedded ? '' : queryFromHash)
  const [service, setService] = useState<SearchScope>('all')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState<AppErrorCode | undefined>()
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [probes, setProbes] = useState<Record<string, QualityProbe>>({})
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [picker, setPicker] = useState<MediaInfo | null>(null)
  const pickerTitleId = useId()
  const [pickerBusy, setPickerBusy] = useState<string | null>(null)
  /*
    The series picker shows a save folder and sends it, as it does on Home.
    Its own, and started afresh for each series opened: the plain results
    above queue to the Settings folder, and say nothing to the contrary.
  */
  const [pickerDir, setPickerDir] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // Bumped on every new search so stale probe results are discarded.
  const generation = useRef(0)
  /*
    Probes still running in the main process.

    Discarding their *results* was never enough: each one is a yt-dlp process,
    and switching service pill three times left three grids' worth of them
    still extracting in the background — competing with the search the user is
    now waiting on. Bumping the generation stops us listening; this stops them
    working.
  */
  const probeRequests = useRef(new Set<string>())

  const cancelProbes = (): void => {
    for (const id of probeRequests.current) void window.api.cancelDetect(id)
    probeRequests.current.clear()
  }

  const search = async (value?: string, svc?: SearchScope): Promise<void> => {
    const q = (value ?? query).trim()
    const s = svc ?? service
    if (!q) return
    generation.current++
    cancelProbes()
    setStatus('searching')
    setError('')
    setErrorCode(undefined)
    setResults(null)
    setProbes({})
    setAdded(new Set())
    setPicker(null)
    /*
      `searchVideos` waits on the engine, and that used to rethrow when it
      couldn't be installed — offline on first run, say. A rejected invoke
      skipped the error branch entirely, so the screen sat in its loading
      skeleton forever with the search button disabled: no result, no message,
      no way back. Main now answers that case with a code; this catch stays for
      whatever else might still reject.
    */
    const res: SearchResponse = await window.api
      .searchVideos(q, s, s === 'all' ? 6 : 12)
      .catch((err: unknown) => ({ ok: false, error: describeError(err) }))
    if (res.ok && res.results) {
      setResults(res.results)
      setStatus('idle')
      void probeQualities(res.results, generation.current)
    } else {
      setError(res.error || t('search.failed'))
      setErrorCode(res.errorCode)
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
        const requestId = `probe-${gen}-${item.url}`
        probeRequests.current.add(requestId)
        try {
          const res = await window.api.detect(item.url, requestId)
          probeRequests.current.delete(requestId)
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
          probeRequests.current.delete(requestId)
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
    else inputRef.current?.focus({ preventScroll: true })

    // The standalone search window is handed its query over IPC.
    const offIpc = embedded
      ? undefined
      : window.api.onSearchQuery((q) => {
          setQuery(q)
          void search(q)
        })
    return () => {
      offIpc?.()
      // Leaving the screen ends the probes with it.
      cancelProbes()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /*
    A title typed on the home screen. It arrives as state rather than a DOM
    event because the event was dispatched in the same tick as the view switch,
    before this component had mounted to hear it — so the advertised "or type a
    title to search" always landed here with the text gone.
  */
  useEffect(() => {
    if (!pendingQuery) return
    const q = takePendingQuery()
    if (!q) return
    setQuery(q)
    void search(q)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQuery])

  const changeService = (s: SearchScope): void => {
    setService(s)
    if (results || status === 'error') void search(undefined, s)
  }

  const showAdult = settings?.showAdultServices ?? false
  const services = allowedSearchServices(SERVICES, showAdult)

  /*
    The setting switched off while an adult service was in use: its pill is
    about to vanish, so the scope falls back to everything rather than to a
    selection nothing on screen shows, and the tiles it already put in the grid
    go with it.
  */
  useEffect(() => {
    if (showAdult) return
    setResults((prev) => prev && prev.filter((r) => !ADULT_SEARCH_SERVICES.includes(r.service)))
    if (service !== 'all' && ADULT_SEARCH_SERVICES.includes(service)) changeService('all')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAdult])

  // Regular video/audio: queue straight to the downloads list.
  const download = async (r: SearchResult): Promise<void> => {
    const probe = probes[r.url]
    const mode = r.service === 'soundcloud' ? 'audio' : initialMode(settings)
    const quality = mode === 'audio' ? 'audio' : initialQuality(settings, probe?.maxHeight || 0)
    const ok = await queueDownload({
      url: r.url,
      title: r.title,
      thumbnail: r.thumbnail || probe?.thumbnail,
      mode,
      quality,
      // The probe already asked what this video offers, so the queue row can
      // say which resolution "best" turned out to be instead of just "best".
      targetHeight: quality === 'best' && probe?.maxHeight ? probe.maxHeight : undefined,
      duration: r.duration,
      extractor: r.service
    })
    if (ok) setAdded((prev) => new Set(prev).add(r.url))
  }

  // Anime: open the episode/translator/quality picker (like pasting the link).
  const openPicker = async (r: SearchResult): Promise<void> => {
    if (!r.pickerUrl) return
    setPickerBusy(r.url)
    try {
      const res = await window.api.detect(r.pickerUrl)
      if (res.ok && res.info?.streaming) {
        setPickerDir('')
        setPicker(res.info)
      } else toast(errorText(t, { error: res.error, errorCode: res.errorCode }), 'error')
    } catch (err) {
      toast(describeError(err, t('search.failed')), 'error')
    } finally {
      setPickerBusy(null)
    }
  }

  const activeLabel = serviceLabel(service, t)
  /*
    Inside the main window a result opens in the Download view's own card,
    as a pasted link would (plan 5.5); the standalone search window has no
    Download view, so there it queues or opens the picker as before.
  */
  const requestDetect = useStore((s) => s.requestDetect)
  const open = embedded ? (r: SearchResult) => requestDetect(r.pickerUrl || r.url) : undefined

  const entry = (
    <div className="field flex h-[34px] w-full items-center gap-1 rounded-1 px-1">
      <Search size={16} className="ml-1.5 shrink-0 text-ink-2" />
      <input
        id="uvd-search"
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && search()}
        placeholder={t('search.placeholder')}
        aria-label={t('search.label')}
        className="no-drag min-w-0 flex-1 bg-transparent px-1 text-body text-ink outline-none placeholder:text-ink-2"
        spellCheck={false}
        autoComplete="off"
      />
      {status === 'searching' ? (
        <span className="mr-1.5 flex"><Spinner size={16} label={t('search.searching')} /></span>
      ) : (
        <button
          type="button"
          className="ui-icon-btn ui-icon-btn-sm"
          data-uvd="search"
          onClick={() => search()}
          disabled={!query.trim()}
          aria-label={t('common.search')}
        >
          <ArrowRight size={16} />
        </button>
      )}
    </div>
  )

  return (
    <div className="flex h-full flex-col">
      {/* The entry sits in the header bar (A1 §3); the standalone window has none, so it stays on the page. */}
      {embedded ? <HeaderSlot where="center">{entry}</HeaderSlot> : <div className="mx-auto w-full max-w-[1000px] shrink-0 px-6 pt-4">{entry}</div>}

      <div className="mx-auto min-h-0 w-full max-w-[1000px] flex-1 overflow-y-auto px-6 pb-8 pt-4">
        <div className="mb-5 flex items-center gap-3">
          <ServiceFilter
            label={t('search.services')}
            value={service}
            onChange={(v) => changeService(v)}
            options={services.map((s) => ({ value: s, label: serviceLabel(s, t) }))}
          />
          {results && (
            <span className="numeric ml-auto shrink-0 text-meta text-ink-2">{t('search.results', { count: results.length })}</span>
          )}
        </div>
        {/*
          Enter-only: these states are mutually exclusive, and an exiting child
          that never reports its animation finished (a throttled background
          window) stays in flow underneath the new one.
        */}
        <>
          {status === 'searching' && (
            <div key="skeleton" className={GRID} aria-hidden="true">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="panel overflow-hidden">
                  <div className="skeleton aspect-video w-full" />
                  <div className="space-y-1.5 p-3">
                    <div className="skeleton h-3.5 w-5/6 rounded-1" />
                    <div className="skeleton h-3 w-1/2 rounded-1" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {status === 'error' && (
            <EmptyState
              icon={<Icon icon={AlertTriangle} size="xl" />}
              title={t('search.failed')}
              hint={errorText(t, { error, errorCode })}
              action={
                <button type="button" className="btn-solid rounded-pill px-6" onClick={() => search()} disabled={!query.trim()}>
                  <RotateCw size={14} /> {t('common.retry')}
                </button>
              }
            />
          )}

          {status === 'idle' && results && results.length === 0 && (
            <EmptyState
              icon={<Icon icon={SearchX} size="xl" />}
              title={t('search.nothing')}
              hint={t('search.nothingHint')}
              action={
                // One service had nothing; the others may well have it.
                service !== 'all' ? (
                  <button type="button" className="btn-solid rounded-pill px-6" onClick={() => changeService('all')}>
                    {t('search.tryAll')}
                  </button>
                ) : undefined
              }
            />
          )}

          {status === 'idle' && results && results.length > 0 && (
            <m.div key="results" variants={staggerParent} initial="hidden" animate="show" className={GRID}>
              {results.map((r, i) => (
                <ResultCard
                  key={`${r.service}-${r.id}-${i}`}
                  result={r}
                  probe={probes[r.url]}
                  added={added.has(r.url)}
                  busy={pickerBusy === r.url}
                  t={t}
                  onOpen={open ? () => open(r) : undefined}
                  onDownload={() => download(r)}
                  onOpenPicker={() => openPicker(r)}
                />
              ))}
            </m.div>
          )}

          {status === 'idle' && !results && (
            <EmptyState icon={<Icon icon={Search} size="xl" />} title={t('search.idle', { service: activeLabel })} hint={t('search.idleHint')} />
          )}
        </>
      </div>

      {/* Anime episode/translator/quality picker (the standalone window) */}
      <AnimatePresence>
        {picker && (
          <Modal
            key="picker"
            onClose={() => setPicker(null)}
            labelledBy={pickerTitleId}
            className="surface-dialog relative max-h-[86vh] w-full max-w-lg overflow-y-auto"
          >
            <button
              className="ui-icon-btn ui-icon-btn-md absolute right-2 top-2 z-10"
              onClick={() => setPicker(null)}
              aria-label={t('common.close')}
            >
              <X size={16} />
            </button>
            <StreamingCard
              info={picker}
              onDone={() => {
                setPicker(null)
              }}
              saveDir={pickerDir}
              onSaveDirChange={setPickerDir}
              titleId={pickerTitleId}
            />
          </Modal>
        )}
      </AnimatePresence>
    </div>
  )
}

/** 2 / 3 / 4 columns of poster cards; the gaps do the separating. */
const GRID = 'grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4'

/**
 * The service filter: a GNOME toggle group, or a drop-down when the group
 * would not fit (eight services, Russian labels, a 720 px window). The group
 * is always laid out, invisibly, so a wider window brings it back.
 */
function ServiceFilter({
  label,
  value,
  onChange,
  options
}: {
  label: string
  value: SearchScope
  onChange: (v: SearchScope) => void
  options: { value: SearchScope; label: string }[]
}): JSX.Element {
  const wrap = useRef<HTMLDivElement>(null)
  const probe = useRef<HTMLDivElement>(null)
  const [fits, setFits] = useState(true)
  useEffect(() => {
    const host = wrap.current
    const group = probe.current
    if (!host || !group) return
    const check = (): void => setFits(group.scrollWidth <= host.clientWidth)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(host)
    return () => ro.disconnect()
  }, [options.length])
  return (
    <div ref={wrap} className="relative min-w-0 flex-1">
      <div ref={probe} className={fits ? 'w-max' : 'pointer-events-none invisible absolute left-0 top-0 w-max'} aria-hidden={!fits || undefined}>
        <ToggleGroup label={label} value={value} onChange={onChange} options={options} />
      </div>
      {!fits && (
        <span className="relative inline-flex items-center">
          <select aria-label={label} className="ui-combo btn-quiet pr-8" value={value} onChange={(e) => onChange(e.target.value as SearchScope)}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown size={16} className="pointer-events-none absolute right-2 text-ink" />
        </span>
      )}
    </div>
  )
}

/** The quality/kind marker in the thumbnail's corner. */
function marker(probe: QualityProbe | undefined, service: SearchService, t: TranslateFn): string | null {
  if (service === 'yummyani') return t('search.anime')
  if (service === 'soundcloud') return t('search.audio')
  // Only some services are probed at all. Treating "never asked" as "asking"
  // left a permanent "quality…" on every Bilibili and Niconico tile.
  if (!PROBE_SERVICES.includes(service)) return null
  if (!probe || probe.status === 'loading') return t('search.qualityProbe')
  if (probe.status === 'done' && probe.maxHeight > 0) return `${probe.maxHeight}p`
  if (probe.status === 'done') return t('search.audio')
  return null
}

/**
 * A poster card (A1 §3): the poster with OSD badges — what it is in one
 * corner, how long in the other — then the title, who made it, and the one
 * action. In the main window the poster opens the result in the Download
 * view's card; in the standalone window it opens the page in the browser.
 */
function ResultCard({
  result,
  probe,
  added,
  busy,
  t,
  onOpen,
  onDownload,
  onOpenPicker
}: {
  result: SearchResult
  probe?: QualityProbe
  added: boolean
  busy: boolean
  t: TranslateFn
  onOpen?: () => void
  onDownload: () => Promise<void>
  onOpenPicker: () => Promise<void>
}): JSX.Element {
  const [downloading, setDownloading] = useState(false)
  const isAnime = result.service === 'yummyani'
  const thumb = result.thumbnail || probe?.thumbnail
  const badge = marker(probe, result.service, t)

  const handle = async (): Promise<void> => {
    if (isAnime) {
      if (onOpen) onOpen()
      else await onOpenPicker()
      return
    }
    setDownloading(true)
    await onDownload()
    setDownloading(false)
  }

  const meta = [serviceLabel(result.service, t), result.uploader, result.viewCount != null ? formatCount(result.viewCount) : null]
    .filter(Boolean)
    .join(' · ')
  const openLabel = onOpen ? t('search.openResult') : t('common.openInBrowser')

  return (
    <m.div variants={staggerChild} className="panel flex flex-col overflow-hidden">
      <button
        type="button"
        className="relative block aspect-video w-full cursor-pointer overflow-hidden bg-sink text-left"
        aria-label={`${openLabel}: ${result.title}`}
        onClick={() => (onOpen ? onOpen() : window.api.openExternal(result.url))}
      >
        <Thumbnail src={thumb} pageUrl={result.url} className="h-full w-full object-cover" fallback={<div className="h-full w-full bg-sink" />} />
        {badge && (
          <span className="absolute left-2 top-2 rounded-1 bg-osd px-1.5 py-0.5 text-caption font-bold leading-tight text-osd-fg">{badge}</span>
        )}
        {result.duration != null && result.duration > 0 && (
          <span className="numeric absolute bottom-2 right-2 rounded-1 bg-osd px-1.5 py-0.5 text-caption leading-tight text-osd-fg">
            {formatDuration(result.duration)}
          </span>
        )}
      </button>
      <div className="flex flex-1 flex-col p-3">
        <p className="line-clamp-2 text-body font-bold leading-snug text-ink" title={result.title}>
          {result.title}
        </p>
        <p className="numeric mt-1 truncate text-meta text-ink-2">{meta}</p>
        <div className="mt-auto pt-3">
          <button
            type="button"
            className={`w-full ${added ? 'btn-base bg-good/12 text-good' : 'btn-quiet'}`}
            onClick={handle}
            disabled={downloading || busy || added}
          >
            {downloading || busy ? <Loader2 size={14} className="animate-spin" /> : added ? <Check size={14} /> : <Download size={14} />}
            {added ? t('search.queued') : isAnime ? t('search.episodes') : t('common.download')}
          </button>
        </div>
      </div>
    </m.div>
  )
}
