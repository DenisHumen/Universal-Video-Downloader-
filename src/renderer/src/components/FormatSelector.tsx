import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { pill } from '../lib/motion'
import { ChevronDown, Film, Music, Sparkles, Video } from 'lucide-react'
import type { AppSettings, DownloadMode, MediaInfo, QualityPreset, VideoFormat } from '@shared/types'
import { formatBytes } from '../lib/format'
import { availableHeights, heightLabel, QUALITY_HEIGHTS } from '../lib/quality'
import { useT } from '../i18n'
import Segmented from './Segmented'

interface Props {
  info: MediaInfo
  settings: AppSettings
  /** Preselected mode/quality — the user's defaults, already clamped to what this video offers. */
  initialMode?: DownloadMode
  initialQuality?: QualityPreset
  onChangeAudioFormat: (fmt: string) => void
  onSelectionChange: (sel: { mode: DownloadMode; quality?: QualityPreset; formatId?: string }) => void
}

const AUDIO_FORMATS = ['mp3', 'm4a', 'opus', 'flac', 'wav', 'aac']

/** Never show more preset buttons than fit comfortably on one row. */
const MAX_PRESETS = 6

export default function FormatSelector({
  info,
  settings,
  initialMode = 'video',
  initialQuality = 'best',
  onChangeAudioFormat,
  onSelectionChange
}: Props): JSX.Element {
  const t = useT()
  const [mode, setMode] = useState<DownloadMode>(initialMode)
  const [quality, setQuality] = useState<QualityPreset>(initialQuality)
  const [formatId, setFormatId] = useState<string | undefined>(undefined)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const videoFormats = info.formats.filter((f) => f.kind !== 'audio')

  /**
   * Presets come from the heights this video really has. Offering a fixed
   * ladder meant advertising qualities that didn't exist (a 360p button on a
   * 720/480/240 video) while repeating the ones that did, verbatim, in the
   * exact-stream list below.
   */
  const availablePresets = useMemo(() => {
    const heights = availableHeights(info.formats)
    if (!heights.length) {
      // The site didn't report heights (HLS, universal detection): fall back to
      // the standard ladder so the user can still cap the download.
      return [
        { q: 'best' as QualityPreset, label: t('common.best') },
        ...QUALITY_HEIGHTS.map((h) => ({ q: String(h) as QualityPreset, label: heightLabel(h) }))
      ]
    }
    return [
      { q: 'best' as QualityPreset, label: t('common.best') },
      ...heights
        .slice(0, MAX_PRESETS)
        .map((h) => ({ q: String(h) as QualityPreset, label: heightLabel(h) }))
    ]
  }, [info.formats, t])

  const emit = (next: Partial<{ mode: DownloadMode; quality: QualityPreset; formatId?: string }>): void => {
    const m = next.mode ?? mode
    onSelectionChange({
      mode: m,
      quality: m === 'audio' ? 'audio' : (next.quality ?? quality),
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
        <p className="group-title">{t('common.format')}</p>
        <Segmented
          layoutId="seg-mode"
          value={mode}
          onChange={(v) => selectMode(v as DownloadMode)}
          options={[
            { value: 'video', label: t('common.video'), icon: <Video size={15} /> },
            { value: 'audio', label: t('common.audioOnly'), icon: <Music size={15} /> }
          ]}
        />
      </div>

      {mode === 'video' ? (
        <>
          <div>
            <p className="group-title">{t('common.quality')}</p>
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
                        className="absolute inset-0 rounded-xl bg-accent"
                        transition={pill}
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

          {videoFormats.length > 1 && (
            <div>
              <button
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex w-full items-center justify-between rounded-xl px-1 py-1 text-xs font-medium text-fg/60 transition-colors hover:text-cream"
              >
                <span className="flex items-center gap-1.5">
                  <Film size={13} /> {t('format.exactStream', { count: videoFormats.length })}
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
                                ? 'border-accent/50 bg-accent/[0.08]'
                                : 'border-fg/[0.05] bg-fg/[0.02] hover:bg-fg/[0.05]'
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <span className="w-14 font-semibold text-cream">{f.resolution}</span>
                              <span className="mono rounded bg-fg/[0.06] px-1.5 py-0.5 uppercase text-fg/60">
                                {f.ext}
                              </span>
                              <span className="text-fg/50">{f.vcodec?.split('.')[0]}</span>
                              {f.kind === 'video' && (
                                <span className="text-[10px] text-fg/50">{t('format.plusAudio')}</span>
                              )}
                            </span>
                            <span className="mono text-fg/50">
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
          <p className="group-title">{t('format.audioFormat')}</p>
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
                      className="absolute inset-0 rounded-xl bg-accent"
                      transition={pill}
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
