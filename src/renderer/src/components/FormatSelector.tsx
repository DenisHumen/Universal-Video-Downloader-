import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { collapse, enter } from '../lib/motion'
import { ChevronDown } from 'lucide-react'
import type { AppSettings, DownloadMode, MediaInfo, QualityPreset, VideoFormat } from '@shared/types'
import { formatBytes } from '../lib/format'
import { availableHeights, heightLabel, QUALITY_HEIGHTS } from '../lib/quality'
import { useT } from '../i18n'
import Choice from './Choice'

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

/** Never advertise more presets than a video plausibly has. */
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
        <p className="label mb-2">{t('common.format')}</p>
        <Choice
          label={t('common.format')}
          value={mode}
          onChange={(v) => selectMode(v as DownloadMode)}
          options={[
            { value: 'video', label: t('common.video') },
            { value: 'audio', label: t('common.audioOnly') }
          ]}
        />
      </div>

      {mode === 'video' ? (
        <>
          <div>
            <p className="label mb-2">{t('common.quality')}</p>
            <Choice
              label={t('common.quality')}
              value={formatId ? '' : quality}
              onChange={(v) => selectPreset(v as QualityPreset)}
              options={availablePresets.map((p) => ({ value: p.q, label: p.label }))}
            />
          </div>

          {videoFormats.length > 1 && (
            <div>
              <button
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex w-full items-center justify-between py-1 text-[13px] font-medium text-ink-2 transition-colors duration-fast ease-ease hover:text-ink"
              >
                {t('format.exactStream', { count: videoFormats.length })}
                <motion.span animate={{ rotate: showAdvanced ? 180 : 0 }} transition={enter}>
                  <ChevronDown size={15} />
                </motion.span>
              </button>
              <AnimatePresence initial={false}>
                {showAdvanced && (
                  <motion.div {...collapse} className="overflow-hidden">
                    {/* A table, because these rows are data: one column per
                        fact, aligned down the list so resolutions and sizes can
                        actually be compared. */}
                    <div className="mt-3 max-h-56 overflow-y-auto border-t border-edge">
                      {videoFormats.map((f) => {
                        const on = formatId === f.id
                        return (
                          <button
                            key={f.id}
                            onClick={() => selectFormat(f)}
                            className={`flex w-full items-center gap-3 border-b border-edge px-2 py-2 text-left transition-colors duration-fast ease-ease ${
                              on ? 'bg-accent/10' : 'hover:bg-sink'
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                on ? 'bg-accent' : 'bg-edge-strong'
                              }`}
                            />
                            <span className="mono w-16 shrink-0 text-[12px] text-ink">
                              {f.resolution}
                            </span>
                            <span className="mono w-12 shrink-0 text-[12px] uppercase text-ink-2">
                              {f.ext}
                            </span>
                            <span className="mono min-w-0 flex-1 truncate text-[12px] text-ink-2">
                              {f.vcodec?.split('.')[0]}
                              {f.kind === 'video' ? ` ${t('format.plusAudio')}` : ''}
                            </span>
                            <span className="mono shrink-0 text-[12px] text-ink-2">
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
          <p className="label mb-2">{t('format.audioFormat')}</p>
          <Choice
            label={t('format.audioFormat')}
            value={settings.audioFormat}
            onChange={onChangeAudioFormat}
            options={AUDIO_FORMATS.map((fmt) => ({
              value: fmt,
              label: <span className="uppercase">{fmt}</span>
            }))}
          />
        </div>
      )}
    </div>
  )
}
