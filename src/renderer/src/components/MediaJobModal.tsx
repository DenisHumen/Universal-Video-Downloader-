import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { modalSpring } from '../lib/motion'
import { FileVideo, Loader2, Scissors, X, Zap } from 'lucide-react'
import {
  AUDIO_CONTAINERS,
  VIDEO_CONTAINERS,
  hasTrim,
  type ConvertTarget,
  type DownloadItem,
  type TrimRange
} from '@shared/types'
import { useT } from '../i18n'
import { toast } from '../lib/toast'
import { useStore } from '../store'
import TrimEditor from './TrimEditor'
import Segmented from './Segmented'

export type JobMode = 'trim' | 'convert'

interface Props {
  item: DownloadItem
  mode: JobMode
  onClose: () => void
}

const RESOLUTIONS = ['keep', '1080', '720', '480', '360'] as const

/** Trim or convert a file that's already downloaded. */
export default function MediaJobModal({ item, mode, onClose }: Props): JSX.Element {
  const t = useT()
  const setView = useStore((s) => s.setView)
  const [duration, setDuration] = useState<number | undefined>(item.duration)
  const [hasAudio, setHasAudio] = useState(true)
  const [hasVideo, setHasVideo] = useState(item.mode !== 'audio')
  const [probing, setProbing] = useState(true)
  const [range, setRange] = useState<TrimRange>({ start: 0 })
  const [precise, setPrecise] = useState(true)
  const [container, setContainer] = useState(item.mode === 'audio' ? 'mp3' : 'mp4')
  const [audioOnly, setAudioOnly] = useState(item.mode === 'audio')
  const [resolution, setResolution] = useState<(typeof RESOLUTIONS)[number]>('keep')
  const [busy, setBusy] = useState(false)

  // Always ask ffmpeg what's actually in the file: the duration seeds the trim
  // slider, and which tracks exist decides what we're even allowed to offer.
  useEffect(() => {
    if (!item.filepath) {
      setProbing(false)
      return
    }
    let cancelled = false
    void window.api
      .probeMedia(item.filepath)
      .then((probe) => {
        if (cancelled) return
        setDuration(probe.duration ?? item.duration)
        setHasAudio(probe.hasAudio)
        setHasVideo(probe.hasVideo)
        if (!probe.hasVideo) {
          setAudioOnly(true)
          setContainer('mp3')
        }
      })
      .finally(() => !cancelled && setProbing(false))
    return () => {
      cancelled = true
    }
  }, [item.filepath, item.duration])

  const invalid = mode === 'trim' && range.end != null && range.end <= (range.start ?? 0)
  const nothingToDo = mode === 'trim' && !hasTrim(range)

  const submit = async (): Promise<void> => {
    if (!item.filepath) return
    setBusy(true)
    try {
      if (mode === 'trim') {
        await window.api.startMediaJob({
          kind: 'trim',
          sourcePath: item.filepath,
          title: item.title,
          thumbnail: item.thumbnail,
          range,
          precise
        })
      } else {
        const target: ConvertTarget = {
          mode: audioOnly ? 'audio' : 'video',
          container,
          height: resolution === 'keep' ? undefined : Number(resolution)
        }
        await window.api.startMediaJob({
          kind: 'convert',
          sourcePath: item.filepath,
          title: item.title,
          thumbnail: item.thumbnail,
          target
        })
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : t('home.startFailed'), 'error')
      setBusy(false)
      return
    }
    setBusy(false)
    toast(t('home.addedToQueue'), 'success')
    onClose()
    setView('downloads')
  }

  const containers = audioOnly ? AUDIO_CONTAINERS : VIDEO_CONTAINERS

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 12 }}
          transition={modalSpring}
          className="card w-full max-w-lg overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-3 border-b border-fg/[0.06] px-5 py-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-fg/[0.06] text-cream">
              {mode === 'trim' ? <Scissors size={17} /> : <FileVideo size={17} />}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-cream">
                {mode === 'trim' ? t('trim.title') : t('convert.title')}
              </h2>
              <p className="mono truncate text-[11px] text-fg/55" title={item.title}>
                {item.title}
              </p>
            </div>
            <button className="btn-icon" onClick={onClose} aria-label={t('common.close')}>
              <X size={16} />
            </button>
          </div>

          <div className="space-y-5 p-5">
            {mode === 'trim' ? (
              <>
                {probing ? (
                  <div className="flex items-center gap-2 text-xs text-fg/60">
                    <Loader2 size={14} className="animate-spin" /> …
                  </div>
                ) : (
                  <TrimEditor duration={duration} value={range} onChange={setRange} />
                )}
                <div>
                  <p className="group-title">{t('trim.precise')}</p>
                  <Segmented
                    layoutId="trim-precise"
                    value={precise ? 'precise' : 'fast'}
                    onChange={(v) => setPrecise(v === 'precise')}
                    options={[
                      { value: 'precise', label: t('trim.precise'), icon: <Scissors size={13} /> },
                      { value: 'fast', label: 'fast', icon: <Zap size={13} /> }
                    ]}
                  />
                  <p className="mono mt-1.5 text-[11px] leading-relaxed text-fg/50">
                    {precise ? t('trim.preciseHint') : t('trim.fastHint')}
                  </p>
                </div>
              </>
            ) : (
              <>
                {hasVideo && hasAudio && (
                  <div>
                    <p className="group-title">{t('common.format')}</p>
                    <Segmented
                      layoutId="convert-mode"
                      value={audioOnly ? 'audio' : 'video'}
                      onChange={(v) => {
                        const next = v === 'audio'
                        setAudioOnly(next)
                        setContainer(next ? 'mp3' : 'mp4')
                      }}
                      options={[
                        { value: 'video', label: t('common.video') },
                        { value: 'audio', label: t('common.audioOnly') }
                      ]}
                    />
                  </div>
                )}
                {hasVideo && !hasAudio && (
                  <p className="mono text-[11px] text-fg/50">{t('convert.noAudio')}</p>
                )}
                <div>
                  <p className="group-title">{t('convert.format')}</p>
                  <Segmented
                    layoutId="convert-container"
                    value={container}
                    onChange={setContainer}
                    options={containers.map((c) => ({
                      value: c,
                      label: <span className="uppercase">{c}</span>
                    }))}
                  />
                  {container === 'gif' && (
                    <p className="mono mt-1.5 text-[11px] text-warn">{t('convert.gifHint')}</p>
                  )}
                </div>
                {!audioOnly && container !== 'gif' && (
                  <div>
                    <p className="group-title">{t('convert.resolution')}</p>
                    <Segmented
                      layoutId="convert-resolution"
                      value={resolution}
                      onChange={(v) => setResolution(v as (typeof RESOLUTIONS)[number])}
                      options={RESOLUTIONS.map((r) => ({
                        value: r,
                        label: r === 'keep' ? t('convert.keepResolution') : `${r}p`
                      }))}
                    />
                  </div>
                )}
              </>
            )}

            <button
              className="btn-primary w-full py-3 text-[15px]"
              onClick={submit}
              disabled={busy || invalid || nothingToDo}
            >
              {busy ? (
                <Loader2 size={17} className="animate-spin" />
              ) : mode === 'trim' ? (
                <Scissors size={17} />
              ) : (
                <FileVideo size={17} />
              )}
              {mode === 'trim' ? t('trim.apply') : t('convert.apply')}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
