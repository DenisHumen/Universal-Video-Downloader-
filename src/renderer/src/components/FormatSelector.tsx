import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Film, Music, Sparkles, Video } from 'lucide-react'
import type { AppSettings, DownloadMode, MediaInfo, QualityPreset, VideoFormat } from '@shared/types'
import { formatBytes } from '../lib/format'
import Segmented from './Segmented'

interface Props {
  info: MediaInfo
  settings: AppSettings
  onChangeAudioFormat: (fmt: string) => void
  onSelectionChange: (sel: { mode: DownloadMode; quality?: QualityPreset; formatId?: string }) => void
}

const PRESETS: { q: QualityPreset; label: string }[] = [
  { q: 'best', label: 'best' },
  { q: '2160', label: '4K' },
  { q: '1440', label: '1440p' },
  { q: '1080', label: '1080p' },
  { q: '720', label: '720p' },
  { q: '480', label: '480p' }
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
    if (m === 'audio') setFormatId(undefined)
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
    <div className="space-y-5">
      <div>
        <p className="group-title">format</p>
        <Segmented
          layoutId="seg-mode"
          value={mode}
          onChange={(v) => selectMode(v as DownloadMode)}
          options={[
            { value: 'video', label: 'video', icon: <Video size={15} /> },
            { value: 'audio', label: 'audio only', icon: <Music size={15} /> }
          ]}
        />
      </div>

      {mode === 'video' ? (
        <>
          <div>
            <p className="group-title">quality</p>
            <div className="seg w-full">
              {availablePresets.map((p) => {
                const active = !formatId && quality === p.q
                return (
                  <button
                    key={p.q}
                    onClick={() => selectPreset(p.q)}
                    className={`seg-item min-w-[68px] flex-1 ${active ? 'seg-item-active' : ''}`}
                  >
                    {active && (
                      <motion.span
                        layoutId="seg-quality"
                        className="absolute inset-0 rounded-xl bg-cream"
                        transition={{ type: 'spring', stiffness: 480, damping: 40 }}
                      />
                    )}
                    <span className="relative z-10 flex items-center gap-1">
                      {p.q === 'best' && <Sparkles size={12} />}
                      {p.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {videoFormats.length > 0 && (
            <div>
              <button
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex w-full items-center justify-between rounded-xl px-1 py-1 text-xs font-medium text-white/45 transition-colors hover:text-cream"
              >
                <span className="flex items-center gap-1.5">
                  <Film size={13} /> choose exact stream ({videoFormats.length})
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
                    <div className="mt-2 max-h-52 space-y-1 overflow-y-auto pr-1">
                      {videoFormats.map((f) => {
                        const active = formatId === f.id
                        return (
                          <button
                            key={f.id}
                            onClick={() => selectFormat(f)}
                            className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-xs transition-all ${
                              active
                                ? 'border-white/30 bg-white/[0.08]'
                                : 'border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.05]'
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <span className="w-14 font-semibold text-cream">{f.resolution}</span>
                              <span className="mono rounded bg-white/[0.06] px-1.5 py-0.5 uppercase text-white/45">
                                {f.ext}
                              </span>
                              <span className="text-white/30">{f.vcodec?.split('.')[0]}</span>
                              {f.kind === 'video' && (
                                <span className="text-[10px] text-white/30">+ audio</span>
                              )}
                            </span>
                            <span className="mono text-white/35">
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
          <p className="group-title">audio format</p>
          <div className="seg w-full">
            {AUDIO_FORMATS.map((fmt) => {
              const active = settings.audioFormat === fmt
              return (
                <button
                  key={fmt}
                  onClick={() => onChangeAudioFormat(fmt)}
                  className={`seg-item flex-1 uppercase ${active ? 'seg-item-active' : ''}`}
                >
                  {active && (
                    <motion.span
                      layoutId="seg-audio"
                      className="absolute inset-0 rounded-xl bg-cream"
                      transition={{ type: 'spring', stiffness: 480, damping: 40 }}
                    />
                  )}
                  <span className="relative z-10">{fmt}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
