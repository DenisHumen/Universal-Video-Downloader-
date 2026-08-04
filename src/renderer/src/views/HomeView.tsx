import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { enter } from '../lib/motion'
import {
  AlertCircle,
  ChevronDown,
  ClipboardPaste,
  Clock,
  Download,
  Eye,
  Globe,
  Layers,
  Loader2,
  Radio,
  Scissors,
  Search,
  Sparkles,
  User,
  X
} from 'lucide-react'
import { hasTrim, type DetectStage, type DownloadMode, type MediaInfo, type QualityPreset, type TrimRange } from '@shared/types'
import { useStore } from '../store'
import { formatCount, formatDuration, isProbablyUrl } from '../lib/format'
import { availableHeights, initialMode, initialQuality, maxHeightOf } from '../lib/quality'
import { toast } from '../lib/toast'
import { toClock } from '../lib/time'
import { useT, type TranslationKey } from '../i18n'
import FormatSelector from '../components/FormatSelector'
import PlaylistCard from '../components/PlaylistCard'
import StreamingCard from '../components/StreamingCard'
import TrimEditor from '../components/TrimEditor'
import CapabilitiesPanel from '../components/CapabilitiesPanel'
import Thumbnail from '../components/Thumbnail'

type Status = 'idle' | 'detecting' | 'error'

interface Selection {
  mode: DownloadMode
  quality?: QualityPreset
  formatId?: string
}

const STAGE_LABEL: Record<DetectStage, TranslationKey> = {
  idle: 'detect.resolving',
  resolving: 'detect.resolving',
  engine: 'detect.engine',
  scraping: 'detect.scraping',
  browsing: 'detect.browsing',
  probing: 'detect.probing',
  done: 'detect.probing'
}

const SITE_HINTS = ['youtube', 'vimeo', 'tiktok', 'twitter / x', 'instagram', 'twitch', 'reddit']

export default function HomeView(): JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const setView = useStore((s) => s.setView)
  const saveSettings = useStore((s) => s.saveSettings)
  const detectStatus = useStore((s) => s.detect)

  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [error, setError] = useState('')
  const [selection, setSelection] = useState<Selection>({ mode: 'video', quality: 'best' })
  const [starting, setStarting] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchText, setBatchText] = useState('')
  const [trimOpen, setTrimOpen] = useState(false)
  const [section, setSection] = useState<TrimRange>({ start: 0 })
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef<string | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const detect = async (value?: string): Promise<void> => {
    const target = (value ?? url).trim()
    if (!target) return
    // Plain text (not a link) → search video services by title.
    if (!isProbablyUrl(target)) {
      setView('search')
      window.dispatchEvent(new CustomEvent<string>('uvd:search-query', { detail: target }))
      return
    }
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    requestRef.current = requestId
    setStatus('detecting')
    setError('')
    setInfo(null)
    const res = await window.api.detect(target, requestId)
    if (requestRef.current !== requestId) return
    requestRef.current = null
    if (res.ok && res.info) {
      setInfo(res.info)
      // Preselect the user's defaults, falling back to automatic "best" when
      // their default quality isn't available for this particular video.
      setSelection({
        mode: initialMode(settings),
        quality: initialQuality(settings, availableHeights(res.info.formats))
      })
      setTrimOpen(false)
      setSection({ start: 0 })
      setStatus('idle')
    } else {
      setError(res.error || t('home.errorTitle'))
      setStatus('error')
    }
  }

  const cancelDetect = (): void => {
    if (requestRef.current) void window.api.cancelDetect(requestRef.current)
    requestRef.current = null
    setStatus('idle')
  }

  const reset = (): void => {
    setInfo(null)
    setError('')
    setStatus('idle')
    setUrl('')
  }

  // Paste a link anywhere to auto-detect; Esc clears; drop a link onto the window.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      const text = e.clipboardData?.getData('text')?.trim()
      if (text && isProbablyUrl(text)) {
        setUrl(text)
        void detect(text)
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') reset()
    }
    const onDrop = (e: DragEvent): void => {
      e.preventDefault()
      const text = e.dataTransfer?.getData('text')?.trim()
      if (text && isProbablyUrl(text)) {
        setUrl(text)
        void detect(text)
      }
    }
    const onExternalUrl = (e: Event): void => {
      const link = (e as CustomEvent<string>).detail
      if (!link) return
      setUrl(link)
      void detect(link)
    }
    const prevent = (e: DragEvent): void => e.preventDefault()
    window.addEventListener('paste', onPaste)
    window.addEventListener('keydown', onKey)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragover', prevent)
    window.addEventListener('uvd:detect-url', onExternalUrl)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('uvd:detect-url', onExternalUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const paste = async (): Promise<void> => {
    const text = await window.api.readClipboard().catch(() => '')
    if (!text) return
    setUrl(text)
    if (isProbablyUrl(text)) void detect(text)
  }

  const start = async (): Promise<void> => {
    if (!info) return
    setStarting(true)
    try {
      await window.api.startDownload({
        url: info.downloadUrl || info.webpageUrl || url,
        title: info.title,
        thumbnail: info.thumbnail,
        mode: selection.mode,
        quality: selection.quality,
        formatId: selection.formatId,
        section: trimOpen && hasTrim(section) ? section : undefined
      })
    } catch (err) {
      toast(err instanceof Error ? err.message : t('home.startFailed'), 'error')
      return
    } finally {
      setStarting(false)
    }
    reset()
    toast(t('home.addedToQueue'), 'success')
    setView('downloads')
  }

  const batchLinks = useMemo(
    () =>
      batchText
        .split(/[\n\s]+/)
        .map((line) => line.trim())
        .filter((line) => isProbablyUrl(line)),
    [batchText]
  )

  const queueBatch = async (): Promise<void> => {
    if (!batchLinks.length) return
    setStarting(true)
    const mode = initialMode(settings)
    try {
      for (const link of batchLinks) {
        await window.api.startDownload({
          url: link,
          title: link,
          mode,
          quality: mode === 'audio' ? 'audio' : initialQuality(settings)
        })
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : t('home.startFailed'), 'error')
      return
    } finally {
      setStarting(false)
    }
    toast(t('playlist.added', { count: batchLinks.length }), 'success')
    setBatchText('')
    setBatchOpen(false)
    setView('downloads')
  }

  const isSearchQuery = url.trim().length > 0 && !isProbablyUrl(url)

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col px-8 py-12">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={enter}
        className="mb-8 text-center"
      >
        <h1
          className="text-[34px] font-semibold leading-[1.1] tracking-[-0.02em]"
          style={{
            background:
              'linear-gradient(180deg, rgb(var(--cream)) 30%, rgb(var(--cream) / 0.62) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}
        >
          {t('home.title')}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-fg/60">
          {t('home.subtitle')}
        </p>
      </motion.div>

      {/* URL input — the one thing on this screen that must catch the eye. */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...enter, delay: 0.06 }}
        className="flex items-center gap-2 rounded-panel border border-fg/[0.1] bg-ink-900/70 p-2 shadow-soft backdrop-blur-xl transition-all duration-200 ease-expo focus-within:border-accent/50 focus-within:shadow-glow"
      >
        <Search className="ml-2.5 shrink-0 text-fg/50" size={19} />
        <input
          ref={inputRef}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && detect()}
          placeholder={t('home.placeholder')}
          className="no-drag min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-cream placeholder:text-fg/50 outline-none"
          spellCheck={false}
        />
        <button className="btn-ghost px-3 py-2.5" onClick={paste} title={t('common.paste')}>
          <ClipboardPaste size={16} />
        </button>
        <button
          className="btn-primary px-5 py-2.5"
          onClick={() => detect()}
          disabled={!url.trim() || status === 'detecting'}
        >
          {status === 'detecting' ? (
            <Loader2 size={16} className="animate-spin" />
          ) : isSearchQuery ? (
            <Search size={16} />
          ) : (
            <Download size={16} />
          )}
          {isSearchQuery ? t('common.search') : t('home.get')}
        </button>
      </motion.div>

      {/* Batch links */}
      <div className="mt-2 flex justify-center">
        <button
          onClick={() => setBatchOpen((v) => !v)}
          className="mono flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] text-fg/50 transition-colors hover:text-fg/70"
        >
          <Layers size={12} /> {t('home.batchOpen')}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {batchOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="card mt-2 space-y-3 p-4">
              <div>
                <p className="group-title mb-1.5">{t('home.batch')}</p>
                <p className="mono mb-2 text-[11px] text-fg/50">{t('home.batchHint')}</p>
                <textarea
                  value={batchText}
                  onChange={(e) => setBatchText(e.target.value)}
                  rows={5}
                  spellCheck={false}
                  className="input mono resize-none text-xs"
                  placeholder={'https://…\nhttps://…'}
                />
              </div>
              <button
                className="btn-primary w-full py-2.5"
                disabled={!batchLinks.length || starting}
                onClick={queueBatch}
              >
                {starting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                {t('home.batchAdd', { count: batchLinks.length })}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results */}
      <div className="mt-5">
        {/* popLayout, not "wait": the incoming state (skeleton, result, error)
            must appear the moment it exists, without waiting for the previous
            one's exit animation to report back. */}
        <AnimatePresence mode="popLayout">
          {status === 'detecting' && (
            <DetectingCard
              key="skeleton"
              stage={detectStatus?.stage ?? 'resolving'}
              label={t(STAGE_LABEL[detectStatus?.stage ?? 'resolving'])}
              slowHint={t('detect.slowHint')}
              cancelLabel={t('common.cancel')}
              onCancel={cancelDetect}
            />
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
                <p className="text-sm font-medium text-cream">{t('home.errorTitle')}</p>
                <p className="mt-0.5 text-xs text-fg/60">{error}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {/* The honest escape hatch: let the user find it by hand. */}
                  <button
                    className="btn-primary py-1.5 text-xs"
                    onClick={() => window.api.openBrowser(url || undefined)}
                  >
                    <Globe size={13} /> {t('browser.open')}
                  </button>
                  {/Settings|настрой/i.test(error) && (
                    <button className="btn-ghost py-1.5 text-xs" onClick={() => setView('settings')}>
                      {t('home.openAccessSettings')}
                    </button>
                  )}
                </div>
                <p className="mono mt-2 text-[11px] text-fg/50">{t('browser.openHint')}</p>
              </div>
            </motion.div>
          )}

          {info && info.streaming && status === 'idle' && (
            <motion.div
              key="streaming"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={enter}
            >
              <StreamingCard info={info} onDone={() => setInfo(null)} />
            </motion.div>
          )}

          {info && info.isPlaylist && !info.streaming && status === 'idle' && (
            <motion.div
              key="playlist"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={enter}
            >
              <PlaylistCard info={info} onDone={() => setInfo(null)} />
            </motion.div>
          )}

          {info && !info.isPlaylist && !info.streaming && status === 'idle' && settings && (
            <motion.div
              key="info"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={enter}
              className="card overflow-hidden"
            >
              {/* Preview header */}
              <div className="flex gap-4 border-b border-fg/[0.06] p-4">
                <div className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-2xl bg-ink-950">
                  <Thumbnail
                    src={info.thumbnail}
                    pageUrl={info.webpageUrl}
                    className="h-full w-full object-cover"
                    loading="eager"
                    fallback={
                      <div className="flex h-full items-center justify-center text-fg/35">
                        <Download size={28} />
                      </div>
                    }
                  />
                  {info.isLive && (
                    <span className="chip absolute left-1.5 top-1.5 bg-red-500/90 text-white">
                      <Radio size={10} /> LIVE
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="line-clamp-2 text-sm font-semibold text-cream" title={info.title}>
                    {info.title}
                  </h2>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg/55">
                    {info.uploader && (
                      <span className="flex items-center gap-1">
                        <User size={12} /> {info.uploader}
                      </span>
                    )}
                    {info.viewCount != null && (
                      <span className="flex items-center gap-1">
                        <Eye size={12} /> {formatCount(info.viewCount)}
                      </span>
                    )}
                    {info.duration != null && (
                      <span className="flex items-center gap-1">
                        <Clock size={12} /> {formatDuration(info.duration)}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="mono rounded-lg bg-fg/[0.06] px-2 py-0.5 text-[10px] text-fg/50">
                      {info.extractor}
                    </span>
                    {maxHeightOf(info.formats) > 0 && (
                      <span className="mono rounded-lg bg-fg/[0.06] px-2 py-0.5 text-[10px] text-fg/50">
                        {t('format.upTo', { height: maxHeightOf(info.formats) })}
                      </span>
                    )}
                    {info.subtitleLanguages && info.subtitleLanguages.length > 0 && (
                      <span className="mono rounded-lg bg-fg/[0.06] px-2 py-0.5 text-[10px] text-fg/50">
                        {t('format.subtitles', { count: info.subtitleLanguages.length })}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {info.viaUniversal && (
                <div className="flex items-start gap-2.5 border-b border-fg/[0.06] bg-accent/[0.06] px-4 py-2.5">
                  <Sparkles size={14} className="mt-0.5 shrink-0 text-accent" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-cream">{t('home.universal')}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-fg/60">
                      {t('home.universalHint')}
                    </p>
                  </div>
                </div>
              )}

              {/* Format selection + CTA */}
              <div className="p-4">
                <FormatSelector
                  info={info}
                  settings={settings}
                  initialMode={selection.mode}
                  initialQuality={selection.quality ?? 'best'}
                  onChangeAudioFormat={(fmt) => saveSettings({ audioFormat: fmt })}
                  onSelectionChange={setSelection}
                />
                {/* Trim before downloading: the engine fetches only this
                    section, so clipping a highlight out of a long stream costs
                    seconds instead of the whole file. */}
                {selection.mode === 'video' && (
                  <div className="mt-5 border-t border-fg/[0.06] pt-4">
                    <button
                      onClick={() => setTrimOpen((v) => !v)}
                      className="flex w-full items-center justify-between rounded-xl px-1 py-1 text-xs font-medium text-fg/60 transition-colors hover:text-cream"
                    >
                      <span className="flex items-center gap-1.5">
                        <Scissors size={13} /> {t('trim.enable')}
                        {trimOpen && hasTrim(section) && (
                          <span className="mono rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">
                            {toClock(section.start ?? 0)}
                            {section.end != null ? ` → ${toClock(section.end)}` : ' →'}
                          </span>
                        )}
                      </span>
                      <motion.span animate={{ rotate: trimOpen ? 180 : 0 }}>
                        <ChevronDown size={15} />
                      </motion.span>
                    </button>
                    <AnimatePresence initial={false}>
                      {trimOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="pt-3">
                            <TrimEditor
                              duration={info.duration}
                              value={section}
                              onChange={setSection}
                              hint={t('trim.downloadHint')}
                            />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                <button
                  className="btn-primary mt-5 w-full py-3 text-[15px]"
                  onClick={start}
                  disabled={starting}
                >
                  {starting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                  {trimOpen && hasTrim(section) ? t('trim.apply') : t('common.download')}
                </button>
              </div>
            </motion.div>
          )}

          {status === 'idle' && !info && (
            <motion.div
              key="hint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="flex flex-wrap justify-center gap-2">
                {[...SITE_HINTS, t('home.moreSites')].map((site) => (
                  <span
                    key={site}
                    className="mono rounded-full border border-fg/[0.06] bg-fg/[0.02] px-3 py-1 text-xs text-fg/50"
                  >
                    {site}
                  </span>
                ))}
              </div>
              <CapabilitiesPanel />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function DetectingCard({
  stage,
  label,
  slowHint,
  cancelLabel,
  onCancel
}: {
  stage: DetectStage
  label: string
  slowHint: string
  cancelLabel: string
  onCancel: () => void
}): JSX.Element {
  const slow = stage === 'scraping' || stage === 'browsing'
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="card overflow-hidden"
    >
      <div className="flex items-center gap-3 border-b border-fg/[0.06] px-4 py-3">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inset-0 rounded-full bg-accent/60 animate-pulse-ring" />
          <span className="relative h-2.5 w-2.5 rounded-full bg-accent" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-cream">{label}</p>
          {slow && <p className="mono mt-0.5 truncate text-[11px] text-fg/50">{slowHint}</p>}
        </div>
        <button className="btn-ghost shrink-0 px-3 py-1.5 text-xs" onClick={onCancel}>
          <X size={13} /> {cancelLabel}
        </button>
      </div>
      <div className="flex gap-4 p-4">
        <div className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-2xl bg-fg/[0.04]">
          <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-fg/[0.08] to-transparent" />
        </div>
        <div className="flex-1 space-y-2 py-1">
          <div className="h-4 w-3/4 rounded bg-fg/[0.05]" />
          <div className="h-3 w-1/2 rounded bg-fg/[0.05]" />
          <div className="h-5 w-20 rounded-lg bg-fg/[0.05]" />
        </div>
      </div>
      <div className="space-y-3 px-4 pb-4">
        <div className="h-10 w-full rounded-2xl bg-fg/[0.04]" />
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-12 rounded-xl bg-fg/[0.04]" />
          ))}
        </div>
      </div>
    </motion.div>
  )
}
