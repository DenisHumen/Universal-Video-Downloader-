import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TrimRange } from '@shared/types'
import { clampTime, parseClock, toClock } from '../lib/time'
import { useT } from '../i18n'

interface Props {
  /** Total length of the source, when known. Without it the timeline is hidden. */
  duration?: number
  value: TrimRange
  onChange: (range: TrimRange) => void
  /** Extra line under the controls, e.g. "only this part is downloaded". */
  hint?: string
}

type Handle = 'start' | 'end' | null

/**
 * A two-handle range picker over the video's timeline, backed by editable
 * timestamps. Dragging is for "roughly here", typing is for "exactly here" —
 * both write the same range.
 *
 * The track is a flat band with the selection cut out of it in accent, and the
 * handles are square rather than round: they mark an exact frame, and a circle
 * reads as approximate.
 */
export default function TrimEditor({ duration, value, onChange, hint }: Props): JSX.Element {
  const t = useT()
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<Handle>(null)
  const [startText, setStartText] = useState(() => toClock(value.start ?? 0))
  const [endText, setEndText] = useState(() => (value.end != null ? toClock(value.end) : ''))

  const start = value.start ?? 0
  const end = value.end ?? duration
  const total = duration && duration > 0 ? duration : undefined
  const invalid = end != null && end <= start

  // Keep the text fields in sync when the range changes from the outside
  // (dragging a handle, or the "whole video" reset).
  useEffect(() => {
    if (dragging !== 'start') setStartText(toClock(value.start ?? 0))
    if (dragging !== 'end') setEndText(value.end != null ? toClock(value.end) : '')
  }, [value.start, value.end, dragging])

  const percentOf = useCallback(
    (seconds: number): number => (total ? Math.min(100, (seconds / total) * 100) : 0),
    [total]
  )

  const seek = useCallback(
    (clientX: number): number | undefined => {
      const track = trackRef.current
      if (!track || !total) return undefined
      const box = track.getBoundingClientRect()
      const ratio = (clientX - box.left) / Math.max(1, box.width)
      return clampTime(ratio * total, total)
    },
    [total]
  )

  useEffect(() => {
    if (!dragging) return
    const onMove = (event: PointerEvent): void => {
      const seconds = seek(event.clientX)
      if (seconds == null) return
      if (dragging === 'start') {
        const upper = value.end ?? total ?? seconds
        onChange({ ...value, start: Math.min(seconds, Math.max(0, upper - 0.1)) })
      } else {
        onChange({ ...value, end: Math.max(seconds, (value.start ?? 0) + 0.1) })
      }
    }
    const onUp = (): void => setDragging(null)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dragging, seek, onChange, value, total])

  const commitStart = (): void => {
    const parsed = parseClock(startText)
    if (parsed == null) {
      setStartText(toClock(start))
      return
    }
    onChange({ ...value, start: clampTime(parsed, total) })
  }

  const commitEnd = (): void => {
    if (!endText.trim()) {
      onChange({ ...value, end: undefined })
      return
    }
    const parsed = parseClock(endText)
    if (parsed == null) {
      setEndText(value.end != null ? toClock(value.end) : '')
      return
    }
    onChange({ ...value, end: clampTime(parsed, total) })
  }

  const lengthLabel = useMemo(() => {
    if (end == null) return null
    const length = end - start
    return length > 0 ? toClock(length) : null
  }, [start, end])

  return (
    <div className="space-y-3">
      {total != null && (
        <div
          ref={trackRef}
          className="relative h-10 cursor-pointer select-none rounded-2 border border-edge bg-sink"
          onPointerDown={(e) => {
            const seconds = seek(e.clientX)
            if (seconds == null) return
            // Grab whichever handle is nearer to where the user pressed.
            const distStart = Math.abs(seconds - start)
            const distEnd = Math.abs(seconds - (end ?? total))
            if (distStart <= distEnd) {
              onChange({ ...value, start: clampTime(seconds, total) })
              setDragging('start')
            } else {
              onChange({ ...value, end: clampTime(seconds, total) })
              setDragging('end')
            }
          }}
        >
          <div
            className="absolute inset-y-0 bg-accent/20"
            style={{
              left: `${percentOf(start)}%`,
              width: `${Math.max(0, percentOf(end ?? total) - percentOf(start))}%`
            }}
          />
          {(['start', 'end'] as const).map((handle) => {
            const seconds = handle === 'start' ? start : (end ?? total)
            return (
              <div
                key={handle}
                role="slider"
                aria-label={handle === 'start' ? t('trim.start') : t('trim.end')}
                aria-valuenow={Math.round(seconds)}
                aria-valuemin={0}
                aria-valuemax={Math.round(total)}
                tabIndex={0}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  setDragging(handle)
                }}
                onKeyDown={(e) => {
                  const step = e.shiftKey ? 5 : 1
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    e.preventDefault()
                    const delta = e.key === 'ArrowLeft' ? -step : step
                    const next = clampTime(seconds + delta, total)
                    if (handle === 'start') onChange({ ...value, start: next })
                    else onChange({ ...value, end: next })
                  }
                }}
                className="absolute top-1/2 z-10 h-[26px] w-2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full bg-accent outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                style={{ left: `${percentOf(seconds)}%` }}
              />
            )
          })}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[96px] flex-1">
          <span className="label mb-1.5 block">{t('trim.start')}</span>
          <input
            value={startText}
            onChange={(e) => setStartText(e.target.value)}
            onBlur={commitStart}
            onKeyDown={(e) => e.key === 'Enter' && commitStart()}
            onFocus={() => setDragging(null)}
            placeholder="0:00"
            spellCheck={false}
            className="field mono text-[13px]"
          />
        </label>
        <label className="min-w-[96px] flex-1">
          <span className="label mb-1.5 block">{t('trim.end')}</span>
          <input
            value={endText}
            onChange={(e) => setEndText(e.target.value)}
            onBlur={commitEnd}
            onKeyDown={(e) => e.key === 'Enter' && commitEnd()}
            onFocus={() => setDragging(null)}
            placeholder={total != null ? toClock(total) : t('trim.end.full')}
            spellCheck={false}
            className="field mono text-[13px]"
          />
        </label>
        <button className="btn-quiet px-3 py-2" onClick={() => onChange({ start: 0, end: undefined })}>
          {t('trim.reset')}
        </button>
      </div>

      <p className="mono text-[12px] text-ink-2">
        {invalid ? (
          <span className="text-bad">{t('trim.invalid')}</span>
        ) : (
          [lengthLabel ? `${t('trim.length')} ${lengthLabel}` : null, hint].filter(Boolean).join('  ·  ')
        )}
      </p>
    </div>
  )
}
