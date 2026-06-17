import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Film, Music, Sparkles, Video } from 'lucide-react'
import type { AppSettings, DownloadMode, MediaInfo, QualityPreset, VideoFormat } from '@shared/types'
import { formatBytes } from '../lib/format'

interface Props {
  info: MediaInfo
  settings: AppSettings
  onChangeAudioFormat: (fmt: string) => void
  onSelectionChange: (sel: {
    mode: DownloadMode
    quality?: QualityPreset
    formatId?: string
  }) => void
}

const PRESETS: { q: QualityPreset; label: string; sub: string }[] = [
  { q: 'best', label: 'Best', sub: 'Highest available' },
  { q: '2160', label: '4K', sub: '2160p' },
  { q: '1440', label: '2K', sub: '1440p' },
  { q: '1080', label: 'Full HD', sub: '1080p' },
  { q: '720', label: 'HD', sub: '720p' },
  { q: '480', label: 'SD', sub: '480p' }
]

const AUDIO_FORMATS = ['mp3', 'm4a', 'opus', 'flac', 'wav', 'aac']

export default function FormatSelector({
  info,
  settings,
  onChangeAudioFormat,
  onSelectionChange
}: Props): JSX.Element {
  const [mode, setMode] = useState<DownloadMode>('video')
  const [quality, setQuality] = useState<QualityPreset>('best')
  const [formatId, setFormatId] = useState<string | undefined>(undefined)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const maxHeight = useMemo(
    () => info.formats.reduce((m, f) => Math.max(m, f.height || 0), 0),
    [info.formats]
  )

  const availablePresets = PRESETS.filter(
    (p) => p.q === 'best' || (maxHeight ? Number(p.q) <= maxHeight : true)
  )

  const videoFormats = info.formats.filter((f) => f.kind !== 'audio')
  const audioStreams = info.formats.filter((f) => f.kind === 'audio')

  const emit = (next: Partial<{ mode: DownloadMode; quality: QualityPreset; formatId?: string }>): void => {
    const m = next.mode ?? mode
    onSelectionChange({
      mode: m,
      quality: m === 'audio' ? 'audio' : next.quality ?? quality,
      formatId: m === 'audio' ? undefined : 'formatId' in next ? next.formatId : formatId
    })
  }

  const selectMode = (m: DownloadMode): void => {
    setMode(m)
    if (m === 'audio') {
      setFormatId(undefined)
    }
    emit({ mode: m })
  }

  const selectPreset = (q: QualityPreset): void => {
    setQuality(q)
    setFormatId(undefined)
    emit({ quality: q, formatId: undefined })
  }

  const selectFormat = (f: VideoFormat): void => {
    setFormatId(f.id)
    emit({ formatId: f.id })
  }

  return (
    <div className="space-y-4">
      {/* Mode switch */}
      <div className="flex rounded-xl bg-base-900/60 p-1">
        {(
          [
            { m: 'video' as const, icon: <Video size={16} />, label: 'Video' },
            { m: 'audio' as const, icon: <Music size={16} />, label: 'Audio only' }
          ]
        ).map((opt) => (
          <button
            key={opt.m}
            onClick={() => selectMode(opt.m)}
            className={`relative flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              mode === opt.m ? 'text-white' : 'text-white/45 hover:text-white/70'
            }`}
          >
            {mode === opt.m && (
              <motion.span
                layoutId="mode-pill"
                className="absolute inset-0 rounded-lg bg-gradient-to-br from-accent-500/90 to-accent-600 shadow-glow"
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              />
            )}
            <span className="relative flex items-center gap-2">
              {opt.icon}
              {opt.label}
            </span>
          </button>
        ))}
      </div>

      {mode === 'video' ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            {availablePresets.map((p) => {
              const selected = !formatId && quality === p.q
              return (
                <button
                  key={p.q}
                  onClick={() => selectPreset(p.q)}
                  className={`relative overflow-hidden rounded-xl border px-3 py-2.5 text-left transition-all ${
                    selected
                      ? 'border-accent-500/60 bg-accent-500/10 shadow-glow'
                      : 'border-white/8 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {p.q === 'best' && <Sparkles size={13} className="text-accent-300" />}
                    <span className="text-sm font-semibold text-white">{p.label}</span>
                  </div>
                  <span className="text-[11px] text-white/40">{p.sub}</span>
                </button>
              )
            })}
          </div>

          {videoFormats.length > 0 && (
            <div>
              <button
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex w-full items-center justify-between rounded-lg px-1 py-1.5 text-xs font-medium text-white/50 transition-colors hover:text-white/80"
              >
                <span className="flex items-center gap-1.5">
                  <Film size={13} /> Choose exact stream ({videoFormats.length})
                </span>
                <motion.span animate={{ rotate: showAdvanced ? 180 : 0 }}>
                  <ChevronDown size={15} />
                </motion.span>
              </button>
              <AnimatePresence initial={false}>
                {showAdvanced && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-1 max-h-52 space-y-1 overflow-y-auto pr-1">
                      {videoFormats.map((f) => {
                        const selected = formatId === f.id
                        return (
                          <button
                            key={f.id}
                            onClick={() => selectFormat(f)}
                            className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-all ${
                              selected
                                ? 'border-accent-500/60 bg-accent-500/10'
                                : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.05]'
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <span className="w-14 font-semibold text-white">{f.resolution}</span>
                              <span className="rounded bg-white/5 px-1.5 py-0.5 uppercase text-white/50">
                                {f.ext}
                              </span>
                              <span className="text-white/35">{f.vcodec?.split('.')[0]}</span>
                              {f.kind === 'video' && (
                                <span className="text-[10px] text-teal-400/70">+ audio auto</span>
                              )}
                            </span>
                            <span className="text-white/40">
                              {formatBytes(f.filesize || f.filesizeApprox)}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </>
      ) : (
        <div>
          <p className="mb-2 text-xs font-medium text-white/50">Audio format</p>
          <div className="grid grid-cols-3 gap-2">
            {AUDIO_FORMATS.map((fmt) => {
              const selected = settings.audioFormat === fmt
              return (
                <button
                  key={fmt}
                  onClick={() => onChangeAudioFormat(fmt)}
                  className={`rounded-xl border px-3 py-2.5 text-center text-sm font-semibold uppercase transition-all ${
                    selected
                      ? 'border-accent-500/60 bg-accent-500/10 text-white shadow-glow'
                      : 'border-white/8 bg-white/[0.03] text-white/60 hover:border-white/20'
                  }`}
                >
                  {fmt}
                </button>
              )
            })}
          </div>
          {audioStreams.length > 0 && (
            <p className="mt-3 text-[11px] text-white/35">
              {audioStreams.length} source audio stream{audioStreams.length > 1 ? 's' : ''} detected —
              best quality will be extracted and converted.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
