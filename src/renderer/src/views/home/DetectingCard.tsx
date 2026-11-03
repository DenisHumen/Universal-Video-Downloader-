import { useEffect, useState } from 'react'
import { m } from 'framer-motion'
import { enter } from '../../lib/motion'
import { Loader2, X } from '../../ui/icons'
import type { DetectPreview, DetectStage } from '@shared/types'
import { youtubeIdOf } from '@shared/urls'
import { useT } from '../../i18n'
import Thumbnail from '../../components/Thumbnail'

/** The host a link is on, for the card's site tag while the extractor is not known yet. */
function hostLabel(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * The waiting state, shaped like the result it is waiting for.
 *
 * Blocks pulse in place rather than sweeping a gradient across themselves — a
 * shimmer repaints every frame to communicate nothing the pulse doesn't, and
 * detection can run for half a minute on an unknown site.
 *
 * What is already known is drawn for real: a YouTube video's poster comes
 * straight from its id, and a title, uploader and poster from the site's
 * oEmbed answer replace their skeletons when it lands, usually well before
 * the engine is done. After a few seconds a counter says how long it has
 * been, so a slow site reads as working rather than stuck. The counter is a
 * one-second interval, not a frame loop: it has to keep counting in a window
 * the compositor has throttled.
 */
export default function DetectingCard({
  stage,
  label,
  url,
  preview,
  slowHint,
  cancelLabel,
  onCancel,
  onDownloadNow,
  starting
}: {
  stage: DetectStage
  label: string
  url: string
  preview: DetectPreview | null
  slowHint: string
  cancelLabel: string
  onCancel: () => void
  /** Absent for a link that has to be detected first - a playlist or channel. */
  onDownloadNow?: () => void
  starting: boolean
}): JSX.Element {
  const t = useT()
  const slow = stage === 'scraping' || stage === 'browsing'
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const started = Date.now()
    setElapsed(0)
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [url])

  const ytId = youtubeIdOf(url)
  const poster = preview?.thumbnail ?? (ytId ? `https://i.ytimg.com/vi/${ytId}/mqdefault.jpg` : undefined)
  const host = hostLabel(url)
  const skeletonThumb = <div className="skeleton h-full w-full" />

  return (
    <m.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={enter}
      className="panel overflow-hidden"
      aria-busy="true"
    >
      <div className="flex items-center gap-2.5 border-b border-edge px-4 py-3">
        <span className="h-1.5 w-1.5 shrink-0 animate-idle-pulse rounded-full bg-accent" />
        <div className="min-w-0 flex-1">
          <p className="h2 truncate">{label}</p>
          {slow && <p className="hint mt-1 truncate">{slowHint}</p>}
        </div>
        {elapsed >= 3 && (
          <span className="mono shrink-0 text-meta tabular-nums text-ink-3" aria-hidden="true">
            {t('detect.elapsed', { seconds: elapsed })}
          </span>
        )}
        <button className="btn-quiet shrink-0 px-3 py-1.5" onClick={onCancel}>
          <X size={13} /> {cancelLabel}
        </button>
      </div>
      <div className="flex gap-4 p-4">
        <div className="relative aspect-video w-36 shrink-0 overflow-hidden rounded-2 bg-sink">
          {poster ? (
            <Thumbnail
              src={poster}
              pageUrl={url}
              className="h-full w-full object-cover"
              loading="eager"
              fallback={skeletonThumb}
            />
          ) : (
            skeletonThumb
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2 py-1">
          {preview?.title ? (
            <p className="h2 line-clamp-2" title={preview.title}>
              {preview.title}
            </p>
          ) : (
            <>
              <div className="skeleton h-3.5 w-3/4 rounded-1" />
              <div className="skeleton h-3 w-1/2 rounded-1" />
            </>
          )}
          {preview?.author && <p className="mono truncate text-meta text-ink-2">{preview.author}</p>}
          {host && <span className="tag">{host}</span>}
        </div>
      </div>
      <div className="space-y-2 px-4 pb-4">
        <div className="skeleton h-9 w-full rounded-2" />
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-8 w-[72px] rounded-2" />
          ))}
        </div>
      </div>
      {onDownloadNow && (
        <div className="border-t border-edge p-4">
          <button
            className="btn-solid w-full rounded-pill py-3 text-body"
            onClick={onDownloadNow}
            disabled={starting}
          >
            {starting ? <Loader2 size={16} className="animate-spin" /> : null}
            {t('home.downloadNow')}
          </button>
          <p className="hint mt-2 text-center">{t('home.downloadNowHint')}</p>
        </div>
      )}
    </m.div>
  )
}
