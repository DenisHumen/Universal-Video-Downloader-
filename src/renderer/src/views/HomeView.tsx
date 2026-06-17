import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle,
  ClipboardPaste,
  Clock,
  Download,
  Eye,
  Link2,
  Loader2,
  Radio,
  Search,
  User
} from 'lucide-react'
import type { DownloadMode, MediaInfo, QualityPreset } from '@shared/types'
import { useStore } from '../store'
import { formatCount, formatDuration, isProbablyUrl } from '../lib/format'
import FormatSelector from '../components/FormatSelector'

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

  const detect = async (value?: string): Promise<void> => {
    const target = (value ?? url).trim()
    if (!target) return
    setStatus('detecting')
    setError('')
    setInfo(null)
    const res = await window.api.detect(target)
    if (res.ok && res.info) {
      setInfo(res.info)
      setSelection({ mode: 'video', quality: 'best' })
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
    await window.api.startDownload({
      url: info.webpageUrl || url,
      title: info.title,
      thumbnail: info.thumbnail,
      mode: selection.mode,
      quality: selection.quality,
      formatId: selection.formatId
    })
    setStarting(false)
    setInfo(null)
    setUrl('')
    setStatus('idle')
    setView('downloads')
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-8 py-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-7 text-center"
      >
        <h1 className="bg-gradient-to-r from-white via-white to-accent-200 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
          Download video from anywhere
        </h1>
        <p className="mt-2 text-sm text-white/45">
          Paste a link and we&apos;ll automatically detect the stream. Thousands of sites supported.
        </p>
      </motion.div>

      {/* URL input */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.05 }}
        className="relative"
      >
        <div className="group relative">
          <div className="pointer-events-none absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-accent-500/40 via-teal-500/30 to-accent-500/40 opacity-0 blur transition-opacity duration-300 group-focus-within:opacity-100" />
          <div className="relative flex items-center gap-2 rounded-2xl border border-white/10 bg-base-900/80 p-2 backdrop-blur-xl">
            <Link2 className="ml-2 shrink-0 text-white/30" size={20} />
            <input
              ref={inputRef}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && detect()}
              placeholder="https://… paste a video link"
              className="no-drag min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-white placeholder-white/30 outline-none"
              spellCheck={false}
            />
            <button className="btn-ghost px-3 py-2" onClick={paste} title="Paste from clipboard">
              <ClipboardPaste size={16} />
            </button>
            <button
              className="btn-primary px-5"
              onClick={() => detect()}
              disabled={!url.trim() || status === 'detecting'}
            >
              {status === 'detecting' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Search size={16} />
              )}
              Detect
            </button>
          </div>
        </div>
      </motion.div>

      {/* Results */}
      <div className="mt-6">
        <AnimatePresence mode="wait">
          {status === 'detecting' && <DetectingSkeleton key="skeleton" />}

          {status === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="card flex items-start gap-3 border-red-500/20 bg-red-500/5 p-4"
            >
              <AlertCircle className="mt-0.5 shrink-0 text-red-400" size={18} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-red-200">Detection failed</p>
                <p className="mt-0.5 text-xs text-white/50">{error}</p>
                {/Settings/.test(error) && (
                  <button
                    className="btn-ghost mt-2 py-1.5 text-xs"
                    onClick={() => setView('settings')}
                  >
                    Open Settings → Access
                  </button>
                )}
              </div>
            </motion.div>
          )}

          {info && status === 'idle' && settings && (
            <motion.div
              key="info"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ type: 'spring', stiffness: 260, damping: 28 }}
              className="card overflow-hidden"
            >
              <div className="grid gap-0 md:grid-cols-[1.1fr_1fr]">
                {/* Media preview */}
                <div className="relative border-b border-white/5 p-5 md:border-b-0 md:border-r">
                  <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-base-950">
                    {info.thumbnail ? (
                      <img
                        src={info.thumbnail}
                        alt=""
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-white/20">
                        <Download size={40} />
                      </div>
                    )}
                    {info.isLive && (
                      <span className="absolute left-2 top-2 chip bg-red-500/90 text-white">
                        <Radio size={11} /> LIVE
                      </span>
                    )}
                    {info.durationString && (
                      <span className="absolute bottom-2 right-2 chip bg-black/70 text-white/90">
                        {info.durationString || formatDuration(info.duration)}
                      </span>
                    )}
                  </div>
                  <h2 className="mt-3 line-clamp-2 text-sm font-semibold text-white" title={info.title}>
                    {info.title}
                  </h2>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/45">
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
                    <span className="rounded bg-accent-500/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-200">
                      {info.extractor}
                    </span>
                  </div>
                </div>

                {/* Format selection + CTA */}
                <div className="flex flex-col p-5">
                  <FormatSelector
                    info={info}
                    settings={settings}
                    onChangeAudioFormat={(fmt) => saveSettings({ audioFormat: fmt })}
                    onSelectionChange={setSelection}
                  />
                  <button
                    className="btn-primary mt-5 w-full py-3 text-base"
                    onClick={start}
                    disabled={starting}
                  >
                    {starting ? (
                      <Loader2 size={18} className="animate-spin" />
                    ) : (
                      <Download size={18} />
                    )}
                    Download
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {status === 'idle' && !info && (
            <motion.div
              key="hint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="mt-2 flex flex-wrap justify-center gap-2"
            >
              {['YouTube', 'Vimeo', 'TikTok', 'Twitter / X', 'Instagram', 'Twitch', 'and 1800+ more'].map(
                (site) => (
                  <span
                    key={site}
                    className="rounded-full border border-white/5 bg-white/[0.03] px-3 py-1 text-xs text-white/40"
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
      className="card grid gap-0 overflow-hidden md:grid-cols-[1.1fr_1fr]"
    >
      <div className="border-b border-white/5 p-5 md:border-b-0 md:border-r">
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-white/5">
          <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        </div>
        <div className="mt-3 h-4 w-3/4 rounded bg-white/5" />
        <div className="mt-2 h-3 w-1/2 rounded bg-white/5" />
      </div>
      <div className="space-y-3 p-5">
        <div className="h-10 w-full rounded-xl bg-white/5" />
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 rounded-xl bg-white/5" />
          ))}
        </div>
        <div className="h-12 w-full rounded-xl bg-white/5" />
      </div>
    </motion.div>
  )
}
