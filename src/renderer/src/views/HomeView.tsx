import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle,
  ClipboardPaste,
  Clock,
  Download,
  Eye,
  Loader2,
  Radio,
  Search,
  User
} from 'lucide-react'
import type { DownloadMode, MediaInfo, QualityPreset } from '@shared/types'
import { useStore } from '../store'
import { formatCount, formatDuration, isProbablyUrl } from '../lib/format'
import { initialMode, initialQuality, maxHeightOf } from '../lib/quality'
import { toast } from '../lib/toast'
import FormatSelector from '../components/FormatSelector'
import PlaylistCard from '../components/PlaylistCard'
import StreamingCard from '../components/StreamingCard'

type Status = 'idle' | 'detecting' | 'error'

interface Selection {
  mode: DownloadMode
  quality?: QualityPreset
  formatId?: string
}

export default function HomeView(): JSX.Element {
  const settings = useStore((s) => s.settings)
  const setView = useStore((s) => s.setView)
  const saveSettings = useStore((s) => s.saveSettings)

  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [error, setError] = useState('')
  const [selection, setSelection] = useState<Selection>({ mode: 'video', quality: 'best' })
  const [starting, setStarting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

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
      if (e.key === 'Escape') {
        setInfo(null)
        setError('')
        setStatus('idle')
        setUrl('')
      }
    }
    const onDrop = (e: DragEvent): void => {
      e.preventDefault()
      const text = e.dataTransfer?.getData('text')?.trim()
      if (text && isProbablyUrl(text)) {
        setUrl(text)
        void detect(text)
      }
    }
    const prevent = (e: DragEvent): void => e.preventDefault()
    window.addEventListener('paste', onPaste)
    window.addEventListener('keydown', onKey)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragover', prevent)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragover', prevent)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const detect = async (value?: string): Promise<void> => {
    const target = (value ?? url).trim()
    if (!target) return
    // Plain text (not a link) → search video services by title in a new window.
    if (!isProbablyUrl(target)) {
      void window.api.openSearchWindow(target)
      return
    }
    setStatus('detecting')
    setError('')
    setInfo(null)
    const res = await window.api.detect(target)
    if (res.ok && res.info) {
      setInfo(res.info)
      // Preselect the user's defaults, falling back to automatic "best" when
      // their default quality isn't available for this particular video.
      setSelection({
        mode: initialMode(settings),
        quality: initialQuality(settings, maxHeightOf(res.info.formats))
      })
      setStatus('idle')
    } else {
      setError(res.error || 'Could not detect a video at this link.')
      setStatus('error')
    }
  }

  const paste = async (): Promise<void> => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        setUrl(text)
        if (isProbablyUrl(text)) void detect(text)
      }
    } catch {
      /* clipboard unavailable */
    }
  }

  const start = async (): Promise<void> => {
    if (!info) return
    setStarting(true)
    try {
      await window.api.startDownload({
        url: info.webpageUrl || url,
        title: info.title,
        thumbnail: info.thumbnail,
        mode: selection.mode,
        quality: selection.quality,
        formatId: selection.formatId
      })
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not start the download', 'error')
      return
    } finally {
      setStarting(false)
    }
    setInfo(null)
    setUrl('')
    setStatus('idle')
    toast('Added to the queue', 'success')
    setView('downloads')
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col px-8 py-12">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="mb-8 text-center"
      >
        <h1 className="text-[28px] font-semibold tracking-tight text-cream">
          paste a link, get the video
        </h1>
        <p className="mt-2 text-sm text-white/40">
          automatic stream detection for thousands of sites — or type a title to search.
        </p>
      </motion.div>

      {/* URL input */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.05 }}
        className="flex items-center gap-2 rounded-3xl border border-white/[0.08] bg-ink-900 p-2 transition-colors focus-within:border-white/25"
      >
        <Search className="ml-2.5 shrink-0 text-white/30" size={19} />
        <input
          ref={inputRef}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && detect()}
          placeholder="paste a video link — or search by title"
          className="no-drag min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-cream placeholder-white/25 outline-none"
          spellCheck={false}
        />
        <button className="btn-ghost px-3 py-2.5" onClick={paste} title="Paste from clipboard">
          <ClipboardPaste size={16} />
        </button>
        <button
          className="btn-primary px-5 py-2.5"
          onClick={() => detect()}
          disabled={!url.trim() || status === 'detecting'}
        >
          {status === 'detecting' ? (
            <Loader2 size={16} className="animate-spin" />
          ) : url.trim() && !isProbablyUrl(url) ? (
            <Search size={16} />
          ) : (
            <Download size={16} />
          )}
          {url.trim() && !isProbablyUrl(url) ? 'search' : 'get'}
        </button>
      </motion.div>

      {/* Results */}
      <div className="mt-5">
        <AnimatePresence mode="wait">
          {status === 'detecting' && <DetectingSkeleton key="skeleton" />}

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
                <p className="text-sm font-medium text-cream">couldn&apos;t detect a video</p>
                <p className="mt-0.5 text-xs text-white/45">{error}</p>
                {/Settings/.test(error) && (
                  <button className="btn-ghost mt-2.5 py-1.5 text-xs" onClick={() => setView('settings')}>
                    open settings → access
                  </button>
                )}
              </div>
            </motion.div>
          )}

          {info && info.streaming && status === 'idle' && (
            <motion.div
              key="streaming"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ type: 'spring', stiffness: 280, damping: 28 }}
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
              transition={{ type: 'spring', stiffness: 280, damping: 28 }}
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
              transition={{ type: 'spring', stiffness: 280, damping: 28 }}
              className="card overflow-hidden"
            >
              {/* Preview header */}
              <div className="flex gap-4 border-b border-white/[0.06] p-4">
                <div className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-2xl bg-ink-950">
                  {info.thumbnail ? (
                    <img
                      src={info.thumbnail}
                      alt=""
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-white/20">
                      <Download size={28} />
                    </div>
                  )}
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
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/40">
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
                    <span className="mono rounded-lg bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/50">
                      {info.extractor}
                    </span>
                    {maxHeightOf(info.formats) > 0 && (
                      <span className="mono rounded-lg bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/50">
                        up to {maxHeightOf(info.formats)}p
                      </span>
                    )}
                  </div>
                </div>
              </div>

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
                <button
                  className="btn-primary mt-5 w-full py-3 text-[15px]"
                  onClick={start}
                  disabled={starting}
                >
                  {starting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                  download
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
              className="mt-1 flex flex-wrap justify-center gap-2"
            >
              {['youtube', 'vimeo', 'tiktok', 'twitter / x', 'instagram', 'twitch', '+1800 more'].map(
                (site) => (
                  <span
                    key={site}
                    className="mono rounded-full border border-white/[0.06] bg-white/[0.02] px-3 py-1 text-xs text-white/35"
                  >
                    {site}
                  </span>
                )
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function DetectingSkeleton(): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="card overflow-hidden"
    >
      <div className="flex gap-4 border-b border-white/[0.06] p-4">
        <div className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-2xl bg-white/[0.04]">
          <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
        </div>
        <div className="flex-1 space-y-2 py-1">
          <div className="h-4 w-3/4 rounded bg-white/[0.05]" />
          <div className="h-3 w-1/2 rounded bg-white/[0.05]" />
          <div className="h-5 w-20 rounded-lg bg-white/[0.05]" />
        </div>
      </div>
      <div className="space-y-3 p-4">
        <div className="h-10 w-full rounded-2xl bg-white/[0.04]" />
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-12 rounded-xl bg-white/[0.04]" />
          ))}
        </div>
        <div className="h-12 w-full rounded-2xl bg-white/[0.04]" />
      </div>
    </motion.div>
  )
}
